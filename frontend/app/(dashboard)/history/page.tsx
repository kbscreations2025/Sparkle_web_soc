"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import { io } from "socket.io-client";
import {
  ChevronDown,
  Copy,
  Download,
  History,
  Loader2,
  type LucideIcon,
  MessageCircle,
  Newspaper,
  SlidersHorizontal,
  Trash2,
  Users,
} from "lucide-react";
import { BACKEND_URL, deleteHistoryItem, fetchHistory, MODEL_LABELS, type HistoryItem } from "@/lib/api";
import { downloadImage } from "@/lib/image";
import { conversationHref, TOOL_LABELS, TOOLS, workspacePathFor } from "@/lib/nav";
import { usePageToolbar } from "@/lib/page-toolbar-context";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { HistoryLightbox } from "@/components/studio/HistoryLightbox";

const HISTORY_PERMISSION = "result.read.own";

const TOOL_OPTIONS = TOOLS.map((t) => ({ id: t.id, label: t.label }));

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

/**
 * Shared by every round tile action button — continue, download, delete.
 *
 * No `lg` step up. The tiles do not get bigger at wide viewports — the grid
 * just adds a column — so scaling the buttons with the viewport only ever
 * made them cover more of the same-sized picture.
 */
const TILE_ACTION_BUTTON =
  "flex h-5 w-5 items-center justify-center rounded-full border border-white/20 bg-black/55 backdrop-blur-sm transition-colors hover:bg-black/75 md:h-6 md:w-6";
const TILE_ACTION_ICON = "text-white/85 md:h-3 md:w-3";

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

export default function HistoryPage() {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Filters live in the URL — shareable, and survive back/forward — hydrated
  // once from whatever query string this page was opened with. Both are
  // client-side filters over one fetched dataset (see below): empty means no
  // filter, checking one or more narrows the grid down to just those.
  const [selectedTools, setSelectedTools] = useState<string[]>(() => {
    const raw = searchParams.get("tools");
    return raw ? raw.split(",").filter(Boolean) : [];
  });
  const [selectedMembers, setSelectedMembers] = useState<string[]>(() => {
    const raw = searchParams.get("members");
    return raw ? raw.split(",").filter(Boolean) : [];
  });

  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [canReadTeam, setCanReadTeam] = useState(false);
  const [selected, setSelected] = useState<HistoryItem | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const columns = useResponsiveColumns();
  const scrollRef = useRef<HTMLDivElement>(null);

  function updateFilters(nextTools: string[], nextMembers: string[]) {
    setSelectedTools(nextTools);
    setSelectedMembers(nextMembers);
    const params = new URLSearchParams(searchParams.toString());
    if (nextTools.length === 0) params.delete("tools");
    else params.set("tools", nextTools.join(","));
    if (nextMembers.length === 0) params.delete("members");
    else params.set("members", nextMembers.join(","));
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  // One fetch, once — every tool, every teammate the server will give us
  // (the server only honours `scope: "team"` for someone who actually holds
  // `result.read.others`, falling back to their own results otherwise, so
  // it's always safe to ask). Which tool and which people show up is a
  // client-side filter over this one dataset, not a re-fetch.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const res = await fetchHistory({ scope: "team" });
      if (cancelled) return;
      if (res.status === "success") {
        setItems(res.items ?? []);
        setNextCursor(res.nextCursor ?? null);
        setCanReadTeam(Boolean(res.canReadTeam));
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    const res = await fetchHistory({ before: nextCursor, scope: "team" });
    if (res.status === "success") {
      setItems((current) => [...current, ...(res.items ?? [])]);
      setNextCursor(res.nextCursor ?? null);
    }
    setLoadingMore(false);
  }, [nextCursor, loadingMore]);

  // Everyone who has shown up in a fetch so far — what the checkbox list
  // offers. Grows as more pages load; never shrinks when a filter narrows.
  const knownMembers = useMemo(() => Array.from(new Set(items.map((item) => item.userName))).sort(), [items]);

  const visibleItems = useMemo(
    () =>
      items.filter(
        (item) =>
          (selectedTools.length === 0 || selectedTools.includes(item.tool)) &&
          (selectedMembers.length === 0 || selectedMembers.includes(item.userName))
      ),
    [items, selectedTools, selectedMembers]
  );

  // Rows of `columns` items each — virtualized by row, not by card, so a grid
  // (not a single-column list) still only mounts what's on screen.
  const rows = useMemo(() => {
    const chunks: HistoryItem[][] = [];
    for (let i = 0; i < visibleItems.length; i += columns) chunks.push(visibleItems.slice(i, i + columns));
    return chunks;
  }, [visibleItems, columns]);

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

  const totalImages = useMemo(
    () => visibleItems.reduce((sum, item) => sum + item.outputs.length, 0),
    [visibleItems]
  );

  const handleDelete = useCallback(async (item: HistoryItem) => {
    setDeletingId(item.id);
    const res = await deleteHistoryItem(item.id);
    setDeletingId(null);
    if (res.status === "success") {
      setItems((current) => current.filter((row) => row.id !== item.id));
      setSelected((current) => (current?.id === item.id ? null : current));
    }
  }, []);

  const handleContinue = useCallback(
    (item: HistoryItem) => {
      // `item.model` carries the recorded model label, which is the only
      // thing that distinguishes the two cleaning workspaces.
      const href = conversationHref(item.tool, item.conversationId, item.model);
      if (href) router.push(href);
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
      // Always prepended to the one dataset — whether it's currently *shown*
      // is up to `visibleItems`, which reacts to it the moment it lands.
      setItems((current) => (current.some((row) => row.id === item.id) ? current : [item, ...current]));
    });

    return () => {
      socket.disconnect();
    };
  }, [user?.user_id]);

  const hasAccess = can(user, HISTORY_PERMISSION);

  const filterControls = hasAccess ? (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {/* A segmented toggle, not two separate pills — one bordered group,
            squared off, split by a single divider. History is the only tab
            wired up; Marketing Kits is a placeholder until it has somewhere
            to go. The image count rides on its corner as a badge instead of
            its own pill. */}
        <div className="relative">
          <div className="flex items-center overflow-hidden rounded-md border border-white/10">
            <button
              type="button"
              aria-pressed="true"
              className="flex items-center gap-1.5 border-r border-white/10 bg-gold/[0.08] px-3 py-1.5 text-xs font-medium text-gold"
            >
              <History size={12} /> History
            </button>
            <button
              type="button"
              disabled
              title="Coming soon"
              aria-pressed="false"
              className="flex cursor-not-allowed items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-faint opacity-60"
            >
              <Newspaper size={12} /> Marketing Kits
            </button>
          </div>
          {totalImages > 0 && (
            <span
              aria-label={`${totalImages} images`}
              className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-gold px-1 text-[9px] font-bold text-[#4A3410] shadow-sm"
            >
              {totalImages}
            </span>
          )}
        </div>
        {canReadTeam && (
          <MemberFilter
            members={knownMembers}
            selected={selectedMembers}
            onChange={(next) => updateFilters(selectedTools, next)}
          />
        )}
      </div>
      <ToolFilter selected={selectedTools} onChange={(next) => updateFilters(next, selectedMembers)} />
    </>
  ) : null;

  // From `md` up these render in the header, replacing the breadcrumb —
  // there's no room for both there, and the filters are the more useful of
  // the two on this page. Below `md` the header has no room for them either,
  // so they stay in the page body instead (see the `md:hidden` bar below).
  usePageToolbar(filterControls);

  if (!hasAccess) {
    return (
      <div className="flex-1 overflow-y-auto px-8 py-8">
        <p className="text-sm text-muted">History isn&apos;t enabled for your account. Ask an admin to grant you access.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] px-3 py-3 md:hidden">
        {filterControls}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4 md:px-5 md:py-5 lg:px-6">
        {loading ? (
          <SkeletonGrid rows={3} />
        ) : visibleItems.length === 0 ? (
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
                      canContinue={item.isOwn && Boolean(workspacePathFor(item.tool, item.model))}
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
            <SkeletonGrid rows={1} />
          </div>
        )}
      </div>

      <HistoryLightbox
        item={selected}
        toolLabel={selected ? TOOL_LABELS[selected.tool] || selected.tool : ""}
        modelLabel={modelLabelFor(selected?.model)}
        canContinue={Boolean(selected?.isOwn && workspacePathFor(selected.tool, selected.model))}
        deleting={Boolean(selected && deletingId === selected.id)}
        onClose={() => setSelected(null)}
        onDelete={handleDelete}
        onContinue={() => selected && handleContinue(selected)}
      />
    </div>
  );
}

type FilterOption = { id: string; label: string };

/**
 * Shared shape for both filters here: an icon+label trigger carrying a
 * selection-count badge, and a panel with an "All" toggle above one checkbox
 * per option. Nothing checked means no filter — everything. Checking one or
 * more narrows the grid down to just those.
 */
function CheckboxFilter({
  icon: Icon,
  label,
  emptyLabel,
  options,
  selected,
  onChange,
}: {
  icon: LucideIcon;
  label: string;
  emptyLabel: string;
  options: FilterOption[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((v) => v !== id) : [...selected, id]);
  }

  const allIds = options.map((option) => option.id);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex items-center gap-1.5 rounded-full border border-white/10 bg-surface-raised py-1.5 pl-3 pr-2.5 text-xs font-medium text-cream transition-colors hover:border-white/20"
      >
        <Icon size={12} className="text-faint" />
        <span>{label}</span>
        <ChevronDown size={13} className="text-faint" />
      </button>

      {/* What's checked, not what they are — the list itself already shows
          every option. */}
      {selected.length > 0 && (
        <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-gold px-1 text-[9px] font-bold text-[#4A3410] shadow-sm">
          {selected.length}
        </span>
      )}

      {open && (
        <div
          role="listbox"
          aria-multiselectable="true"
          className="absolute right-0 top-full z-10 mt-2 w-48 overflow-hidden rounded-lg border border-white/10 bg-surface-raised shadow-lg"
        >
          {options.length === 0 ? (
            <p className="px-3 py-2.5 text-[11px] text-faint">{emptyLabel}</p>
          ) : (
            <div className="max-h-64 overflow-y-auto py-1">
              <label className="flex cursor-pointer items-center gap-2 border-b border-white/5 px-3 py-1.5 text-xs font-medium text-cream hover:bg-white/[0.05]">
                <input
                  type="checkbox"
                  checked={selected.length === allIds.length}
                  ref={(el) => {
                    if (el) el.indeterminate = selected.length > 0 && selected.length < allIds.length;
                  }}
                  // All checked → clear; anything else (none or some) → all.
                  onChange={() => onChange(selected.length === allIds.length ? [] : allIds)}
                  style={{ accentColor: "var(--color-gold)" }}
                />
                All
              </label>
              {options.map((option) => (
                <label
                  key={option.id}
                  className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-cream hover:bg-white/[0.05]"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(option.id)}
                    onChange={() => toggle(option.id)}
                    style={{ accentColor: "var(--color-gold)" }}
                  />
                  <span className="truncate">{option.label}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ToolFilter({ selected, onChange }: { selected: string[]; onChange: (next: string[]) => void }) {
  return (
    <CheckboxFilter
      icon={SlidersHorizontal}
      label="Tools"
      emptyLabel="No tools to filter by."
      options={TOOL_OPTIONS}
      selected={selected}
      onChange={onChange}
    />
  );
}

/** Who to show results for — a checkbox per real name the data has reported, never a generic "Whole team" standing in for actual people. */
function MemberFilter({
  members,
  selected,
  onChange,
}: {
  members: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const options = useMemo(() => members.map((name) => ({ id: name, label: name })), [members]);
  return (
    <CheckboxFilter
      icon={Users}
      label="Members"
      emptyLabel="No results to filter by yet."
      options={options}
      selected={selected}
      onChange={onChange}
    />
  );
}

/**
 * Same shape as a real tile, so the grid doesn't jump when results replace it.
 *
 * Laid out by CSS breakpoints rather than by `useResponsiveColumns`, and that
 * is the whole point: the hook cannot know the viewport until it has mounted
 * and measured, so it necessarily returns its 2-column default for the first
 * paint. That is precisely the frame the skeleton occupies — which is why the
 * loader used to appear as two oversized boxes and then snap to six small
 * ones. Media queries are resolved before the first paint, so there is no
 * wrong frame to correct.
 *
 * The breakpoints below must stay in step with the hook's, or the skeleton
 * would hand over to a grid of a different shape.
 */
const SKELETON_GRID_COLUMNS = "grid-cols-2 sm:grid-cols-4 lg:grid-cols-6";

function SkeletonGrid({ rows }: { rows: number }) {
  // Enough tiles for the widest layout; the surplus is hidden at narrower
  // ones so every breakpoint shows the same number of *rows* rather than the
  // same number of tiles.
  const perRowWide = 6;
  const total = perRowWide * rows;

  return (
    <div className={cn("grid", SKELETON_GRID_COLUMNS)} style={{ gap: GRID_GAP }}>
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "aspect-square animate-pulse rounded-lg bg-white/[0.04] md:rounded-xl",
            // Beyond what fits in two columns, then in four.
            i >= 2 * rows && i < 4 * rows && "hidden sm:block",
            i >= 4 * rows && "hidden lg:block"
          )}
        />
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
          // The small copy, not the original: a full page of results is tens
          // of megabytes at full size and under a megabyte here. The original
          // is still what the download link and the lightbox below point at.
          src={cover.thumbnailUrl}
          alt={toolLabel}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.05]"
        />

        <div className="absolute left-1.5 right-1.5 top-1.5 flex items-start justify-between gap-1 md:left-2 md:right-2 md:top-2">
          <span
            className="max-w-[55%] truncate rounded-full px-1 py-0.5 text-[7px] font-semibold backdrop-blur-sm md:px-1.5 md:text-[9px] lg:text-[10px]"
            style={toolBadgeStyle(item.tool)}
          >
            {toolLabel}
          </span>
          <div className="flex items-center gap-1 md:gap-1.5">
            {item.outputs.length > 1 && (
              <span className="flex h-5 items-center gap-0.5 rounded-full bg-black/55 px-1.5 text-[8px] font-medium text-white/85 backdrop-blur-sm md:h-6 md:text-[10px]">
                <Copy size={9} className="md:h-2.5 md:w-2.5" /> {item.outputs.length}
              </span>
            )}
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
            <button
              type="button"
              title="Download"
              onClick={(event) => {
                // The tile is clickable; downloading must not also open it.
                event.stopPropagation();
                // The full-size original, never the grid thumbnail.
                downloadImage(cover.url, `${item.tool}-${item.id}.jpg`);
              }}
              className={TILE_ACTION_BUTTON}
            >
              <Download size={10} className={TILE_ACTION_ICON} />
            </button>
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
