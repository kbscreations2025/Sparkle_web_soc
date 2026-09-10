"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import { io } from "socket.io-client";
import { ChevronDown, Copy, Download, Loader2, MessageCircle, Trash2, Users } from "lucide-react";
import { BACKEND_URL, deleteHistoryItem, fetchHistory, MODEL_LABELS, type HistoryItem } from "@/lib/api";
import { TOOLS } from "@/lib/nav";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { HistoryLightbox } from "@/components/studio/HistoryLightbox";

const HISTORY_PERMISSION = "result.read.own";

const TOOL_LABELS: Record<string, string> = Object.fromEntries(TOOLS.map((t) => [t.id, t.label]));
const TOOL_FILTERS = [{ id: "all", label: "All tools" }, ...TOOLS.map((t) => ({ id: t.id, label: t.label }))];

/** Where a conversation's tool actually lives — distinct from `TOOLS[].href`, which for Image Cleaning points at its mode picker, not the workspace itself. */
const CONTINUE_PATHS: Record<string, string> = {
  cleaning: "/cleaning/default",
  chat_to_edit: "/chat-to-edit",
};

/**
 * Both cleaning workspaces record their generations under the same `tool:
 * "cleaning"` bucket, so `CONTINUE_PATHS` alone can't tell a GPT-run
 * conversation from a Gemini one apart — only the recorded model label can.
 * Falls back to the Default workspace (Gemini) for anything else, same as
 * before this distinction existed.
 */
function continuePathFor(item: HistoryItem) {
  if (item.tool === "cleaning" && item.model === "Sparkle GPT Image") return "/cleaning/dust-scratches";
  return CONTINUE_PATHS[item.tool];
}

/**
 * One fixed colour per tool, so the same tool always reads the same colour at
 * a glance — a hash would look "random enough" but could coincidentally
 * collide two tools onto near-identical hues.
 */
const TOOL_COLORS: Record<string, string> = {
  cleaning: "142 45% 55%",
  life_style: "95 40% 55%",
  image_to_video: "265 55% 65%",
  text_to_image: "205 65% 60%",
  text_to_sketch: "35 65% 58%",
  sketch_to_image: "175 50% 50%",
  image_to_text: "225 55% 65%",
  image_to_sketch: "350 55% 62%",
  marketing_kit: "20 70% 58%",
  chat_to_edit: "285 50% 62%",
};
const FALLBACK_TOOL_COLOR = "0 0% 60%";

/** Shared by every round tile action button — continue, download, delete. */
const TILE_ACTION_BUTTON =
  "flex h-5 w-5 items-center justify-center rounded-full border border-white/20 bg-black/55 backdrop-blur-sm transition-colors hover:bg-black/75 md:h-7 md:w-7 lg:h-8 lg:w-8";
const TILE_ACTION_ICON = "text-white/85 md:h-3 md:w-3 lg:h-3.5 lg:w-3.5";

/** Row gap between tiles, kept as one constant since both the CSS grid and the row-height estimate must agree. */
const GRID_GAP = 10;

function toolBadgeStyle(tool: string) {
  const hsl = TOOL_COLORS[tool] || FALLBACK_TOOL_COLOR;
  return {
    color: `hsl(${hsl})`,
    background: `hsl(${hsl} / 0.14)`,
    border: `1px solid hsl(${hsl} / 0.28)`,
  };
}

/** The Sparkle label for a model, falling back through the known id map to the raw value the server sent. */
function modelLabelFor(model?: string | null) {
  if (!model) return null;
  return MODEL_LABELS[model] || model;
}

/** 2 columns on mobile, 4 on tablet, 6 on desktop — tracked live so a rotated tablet or a resized window reflows immediately. */
function useResponsiveColumns() {
  const [columns, setColumns] = useState(2);

  useEffect(() => {
    const tablet = window.matchMedia("(min-width: 640px)");
    const desktop = window.matchMedia("(min-width: 1024px)");

    function update() {
      setColumns(desktop.matches ? 6 : tablet.matches ? 4 : 2);
    }
    update();

    tablet.addEventListener("change", update);
    desktop.addEventListener("change", update);
    return () => {
      tablet.removeEventListener("change", update);
      desktop.removeEventListener("change", update);
    };
  }, []);

  return columns;
}

function cacheKeyFor(tool: string, wholeTeam: boolean) {
  return `${tool}:${wholeTeam ? "team" : "own"}`;
}

type CacheEntry = { items: HistoryItem[]; nextCursor: string | null; canReadTeam: boolean };

export default function HistoryPage() {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Filters live in the URL — shareable, and survive back/forward — hydrated
  // once from whatever query string this page was opened with.
  const [tool, setTool] = useState(() => searchParams.get("tool") || "all");
  const [wholeTeam, setWholeTeam] = useState(() => searchParams.get("scope") === "team");

  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [canReadTeam, setCanReadTeam] = useState(false);
  const [selected, setSelected] = useState<HistoryItem | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Every (tool, scope) combination already fetched this session, so flipping
  // a filter back and forth never re-hits the network for pages already seen.
  const cacheRef = useRef(new Map<string, CacheEntry>());
  // Mirrors `tool`/`wholeTeam` for the socket handler below, which is set up
  // once and must not reconnect every time a filter changes.
  const filterRef = useRef({ tool, wholeTeam });
  filterRef.current = { tool, wholeTeam };

  const columns = useResponsiveColumns();
  const scrollRef = useRef<HTMLDivElement>(null);

  function updateFilters(nextTool: string, nextWholeTeam: boolean) {
    setTool(nextTool);
    setWholeTeam(nextWholeTeam);
    const params = new URLSearchParams(searchParams.toString());
    if (nextTool === "all") params.delete("tool");
    else params.set("tool", nextTool);
    if (nextWholeTeam) params.set("scope", "team");
    else params.delete("scope");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  // Serves from the in-memory cache instantly when this (tool, scope) has
  // already been fetched; otherwise fetches page one. Guarded by `cancelled`
  // so a fast filter switch can't have an older response clobber a newer one.
  useEffect(() => {
    const key = cacheKeyFor(tool, wholeTeam);
    const cached = cacheRef.current.get(key);
    if (cached) {
      setItems(cached.items);
      setNextCursor(cached.nextCursor);
      setCanReadTeam(cached.canReadTeam);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    (async () => {
      const res = await fetchHistory({ tool, scope: wholeTeam ? "team" : "own" });
      if (cancelled) return;
      if (res.status === "success") {
        const nextItems = res.items ?? [];
        const cursor = res.nextCursor ?? null;
        const team = Boolean(res.canReadTeam);
        setItems(nextItems);
        setNextCursor(cursor);
        setCanReadTeam(team);
        cacheRef.current.set(key, { items: nextItems, nextCursor: cursor, canReadTeam: team });
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [tool, wholeTeam]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    const res = await fetchHistory({ tool, before: nextCursor, scope: wholeTeam ? "team" : "own" });
    if (res.status === "success") {
      const key = cacheKeyFor(tool, wholeTeam);
      setItems((current) => {
        const merged = [...current, ...(res.items ?? [])];
        const existing = cacheRef.current.get(key);
        cacheRef.current.set(key, {
          items: merged,
          nextCursor: res.nextCursor ?? null,
          canReadTeam: existing?.canReadTeam ?? canReadTeam,
        });
        return merged;
      });
      setNextCursor(res.nextCursor ?? null);
    }
    setLoadingMore(false);
  }, [tool, wholeTeam, nextCursor, loadingMore, canReadTeam]);

  // Rows of `columns` items each — virtualized by row, not by card, so a grid
  // (not a single-column list) still only mounts what's on screen.
  const rows = useMemo(() => {
    const chunks: HistoryItem[][] = [];
    for (let i = 0; i < items.length; i += columns) chunks.push(items.slice(i, i + columns));
    return chunks;
  }, [items, columns]);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 200,
    overscan: 6,
    gap: GRID_GAP,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();

  // Infinite scroll driven by the virtualizer's own rendered range, rather
  // than a separate sentinel/IntersectionObserver — the moment scrolling
  // brings the last few rows into range, the next page is already loading.
  useEffect(() => {
    const last = virtualRows[virtualRows.length - 1];
    if (!last || last.index < rows.length - 3) return;
    loadMore();
  }, [virtualRows, rows.length, loadMore]);

  const totalImages = useMemo(() => items.reduce((sum, item) => sum + item.outputs.length, 0), [items]);

  /** Removes one id from every cached filter view, not just the one on screen — so deleting in "All tools" doesn't resurrect it if the user later switches to "Image Cleaning". */
  function purgeFromAllCaches(id: string) {
    for (const [key, entry] of cacheRef.current) {
      if (entry.items.some((row) => row.id === id)) {
        cacheRef.current.set(key, { ...entry, items: entry.items.filter((row) => row.id !== id) });
      }
    }
  }

  const handleDelete = useCallback(async (item: HistoryItem) => {
    setDeletingId(item.id);
    const res = await deleteHistoryItem(item.id);
    setDeletingId(null);
    if (res.status === "success") {
      setItems((current) => current.filter((row) => row.id !== item.id));
      purgeFromAllCaches(item.id);
      setSelected((current) => (current?.id === item.id ? null : current));
    }
  }, []);

  const handleContinue = useCallback(
    (item: HistoryItem) => {
      const path = continuePathFor(item);
      if (!path) return;
      router.push(`${path}?conversationId=${item.conversationId}`);
    },
    [router]
  );

  const openItem = useCallback((item: HistoryItem) => setSelected(item), []);

  // Live updates: the same generation-complete event that lets a tool page
  // skip a manual refresh also lets History prepend a brand-new result the
  // instant it's ready, with no poll and no page reload.
  useEffect(() => {
    const userId = user?.user_id;
    if (!userId) return;

    const socket = io(BACKEND_URL, { withCredentials: true });
    socket.on("history:generation", (item: HistoryItem) => {
      const matchesTool = (t: string) => t === "all" || t === item.tool;

      for (const [key, entry] of cacheRef.current) {
        const [keyTool, keyScope] = key.split(":");
        if (keyScope !== "own" || !matchesTool(keyTool)) continue;
        if (entry.items.some((row) => row.id === item.id)) continue;
        cacheRef.current.set(key, { ...entry, items: [item, ...entry.items] });
      }

      const current = filterRef.current;
      if (!current.wholeTeam && matchesTool(current.tool)) {
        setItems((rows) => (rows.some((row) => row.id === item.id) ? rows : [item, ...rows]));
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [user?.user_id]);

  if (!can(user, HISTORY_PERMISSION)) {
    return (
      <div className="flex-1 overflow-y-auto px-8 py-8">
        <p className="text-sm text-muted">History isn&apos;t enabled for your account. Ask an admin to grant you access.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] px-3 py-3 md:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-gold/20 bg-gold/[0.08] px-3 py-1.5 text-xs font-medium text-gold">History</span>
          <span className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-faint">{totalImages} images</span>
          {canReadTeam && (
            <button
              type="button"
              onClick={() => updateFilters(tool, !wholeTeam)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                wholeTeam ? "border-gold/30 bg-gold/10 text-gold" : "border-white/10 text-faint hover:text-cream"
              )}
            >
              <Users size={12} /> Whole team
            </button>
          )}
        </div>
        <ToolFilter value={tool} onChange={(next) => updateFilters(next, wholeTeam)} />
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4 md:px-5 md:py-5 lg:px-6">
        {loading ? (
          <SkeletonGrid columns={columns} rows={3} />
        ) : items.length === 0 ? (
          <p className="px-2 py-10 text-center text-sm text-faint">Nothing generated yet.</p>
        ) : (
          <div style={{ position: "relative", height: rowVirtualizer.getTotalSize() }}>
            {virtualRows.map((virtualRow) => (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${virtualRow.start}px)` }}
              >
                <div
                  className="grid"
                  style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: GRID_GAP, paddingBottom: GRID_GAP }}
                >
                  {rows[virtualRow.index].map((item) => (
                    <HistoryTile
                      key={item.id}
                      item={item}
                      toolLabel={TOOL_LABELS[item.tool] || item.tool}
                      canContinue={item.isOwn && Boolean(CONTINUE_PATHS[item.tool])}
                      deleting={deletingId === item.id}
                      onOpen={openItem}
                      onContinue={handleContinue}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {loadingMore && (
          <div className="pt-1">
            <SkeletonGrid columns={columns} rows={1} />
          </div>
        )}
      </div>

      <HistoryLightbox
        item={selected}
        toolLabel={selected ? TOOL_LABELS[selected.tool] || selected.tool : ""}
        modelLabel={modelLabelFor(selected?.model)}
        canContinue={Boolean(selected && selected.isOwn && CONTINUE_PATHS[selected.tool])}
        deleting={Boolean(selected && deletingId === selected.id)}
        onClose={() => setSelected(null)}
        onDelete={handleDelete}
        onContinue={() => selected && handleContinue(selected)}
      />
    </div>
  );
}

function ToolFilter({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="appearance-none rounded-full border border-white/10 bg-surface-raised py-1.5 pl-3 pr-8 text-xs font-medium text-cream outline-none transition-colors hover:border-white/20"
      >
        {TOOL_FILTERS.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.label}
          </option>
        ))}
      </select>
      <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-faint" />
    </div>
  );
}

/** Same shape as a real tile, so the grid doesn't jump when results replace it. */
function SkeletonGrid({ columns, rows }: { columns: number; rows: number }) {
  return (
    <div className="grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: GRID_GAP }}>
      {Array.from({ length: columns * rows }).map((_, i) => (
        <div key={i} className="aspect-square animate-pulse rounded-lg bg-white/[0.04] md:rounded-xl" />
      ))}
    </div>
  );
}

type HistoryTileProps = {
  item: HistoryItem;
  toolLabel: string;
  canContinue: boolean;
  deleting: boolean;
  onOpen: (item: HistoryItem) => void;
  onContinue: (item: HistoryItem) => void;
  onDelete: (item: HistoryItem) => void;
};

/**
 * Memoized so a page full of tiles doesn't all re-render every time one
 * unrelated tile's `deleting` state flips, or a new page of results appends —
 * `onOpen`/`onContinue`/`onDelete` are stable across renders (see the parent's
 * `useCallback`s), and `item` keeps its object identity for every row that
 * hasn't itself changed, so the comparator below bails out on those tiles.
 */
const HistoryTile = memo(
  function HistoryTile({ item, toolLabel, canContinue, deleting, onOpen, onContinue, onDelete }: HistoryTileProps) {
    const cover = item.outputs[0];
    if (!cover) return null;

    return (
      <div
        className="group relative aspect-square cursor-pointer overflow-hidden rounded-lg border border-white/[0.06] transition-colors hover:border-white/20 md:rounded-xl"
        onClick={() => onOpen(item)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- small grid tile, lazy-loaded natively; next/image adds no value at this size */}
        <img
          src={cover.url}
          alt={toolLabel}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.05]"
        />

        {item.outputs.length > 1 && (
          <span className="absolute bottom-1.5 right-1.5 flex items-center gap-0.5 rounded-full bg-black/55 px-1.5 py-0.5 text-[8px] font-medium text-white/85 backdrop-blur-sm md:bottom-2 md:right-2 md:text-[10px]">
            <Copy size={9} className="md:h-2.5 md:w-2.5" /> {item.outputs.length}
          </span>
        )}

        <div className="absolute left-1.5 right-1.5 top-1.5 flex items-start justify-between gap-1 md:left-2 md:right-2 md:top-2">
          <span
            className="max-w-[55%] truncate rounded-full px-1 py-0.5 text-[7px] font-semibold backdrop-blur-sm md:px-1.5 md:text-[9px] lg:text-[10px]"
            style={toolBadgeStyle(item.tool)}
          >
            {toolLabel}
          </span>
          <div className="flex gap-1 md:gap-1.5">
            {canContinue && (
              <button
                type="button"
                title="Continue this conversation"
                onClick={(event) => {
                  event.stopPropagation();
                  onContinue(item);
                }}
                className={TILE_ACTION_BUTTON}
              >
                <MessageCircle size={10} className={TILE_ACTION_ICON} />
              </button>
            )}
            <a
              href={cover.url}
              download={`${item.tool}-${item.id}.jpg`}
              title="Download"
              onClick={(event) => event.stopPropagation()}
              className={TILE_ACTION_BUTTON}
            >
              <Download size={10} className={TILE_ACTION_ICON} />
            </a>
            <button
              type="button"
              title="Delete"
              disabled={deleting}
              onClick={(event) => {
                event.stopPropagation();
                onDelete(item);
              }}
              className={cn(TILE_ACTION_BUTTON, "hover:bg-error/75 disabled:opacity-50")}
            >
              {deleting ? (
                <Loader2 size={10} className={cn(TILE_ACTION_ICON, "animate-spin")} />
              ) : (
                <Trash2 size={10} className={TILE_ACTION_ICON} />
              )}
            </button>
          </div>
        </div>

        <div className="absolute bottom-1.5 left-1.5 md:bottom-2 md:left-2">
          <span className="rounded-full bg-black/55 px-1.5 py-0.5 text-[8px] font-medium text-white/85 backdrop-blur-sm md:px-2 md:text-[10px] lg:text-[11px]">
            {item.userName}
          </span>
        </div>
      </div>
    );
  },
  (prev, next) =>
    prev.item === next.item &&
    prev.toolLabel === next.toolLabel &&
    prev.canContinue === next.canContinue &&
    prev.deleting === next.deleting
);
