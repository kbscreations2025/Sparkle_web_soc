"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import { io } from "socket.io-client";
import {
  CalendarRange,
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
import Link from "next/link";
import {
  BACKEND_URL,
  deleteHistoryItem,
  deleteMarketingKit,
  fetchHistory,
  listMarketingKits,
  MODEL_LABELS,
  type HistoryItem,
  type MarketingKitSummary,
} from "@/lib/api";
import { downloadImage, downloadName } from "@/lib/image";
import { conversationHref, toolBadgeStyle, TOOL_LABELS, TOOLS, workspacePathFor } from "@/lib/nav";
import { describeKit, kitHref, KIT_LABEL } from "@/lib/marketingKits";
import { usePageToolbar } from "@/lib/page-toolbar-context";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/permissions";
import { useDismissable } from "@/lib/useEscapeKey";
import { cn } from "@/lib/utils";
import { HistoryLightbox } from "@/components/studio/HistoryLightbox";
import { AssetThumb } from "@/components/studio/AssetThumb";
import { ConfirmDialog } from "@/components/studio/ConfirmDialog";

const HISTORY_PERMISSION = "result.read.own";

const TOOL_OPTIONS = TOOLS.map((t) => ({ id: t.id, label: t.label }));

/**
 * The tile's actions sit in one pill rather than as separate circles.
 *
 * Three buttons each carrying their own border, background and blur cost
 * three times the chrome and two gaps between them, over a picture that is
 * only ~160px wide. Pooling them into a single container pays for that once
 * — the same grouping the lightbox toolbar uses.
 */
const TILE_ACTION_GROUP =
  "flex shrink-0 items-center gap-0.5 rounded-full border border-white/20 bg-black/55 p-0.5 backdrop-blur-sm";

/**
 * One action inside that pill.
 *
 * Larger on a phone than on a desktop, which is the opposite of how these
 * usually scale — and deliberate. A finger needs the target; a cursor does
 * not, and at `md` the grid has more columns of the same-sized tile, so
 * every pixel the buttons take is covering the picture.
 *
 * Still short of the 32px the chips aim for: three of these plus the tool
 * and quality badges have to fit across a ~170px tile, and the tile itself
 * is the primary target — tapping it opens the lightbox, where the same
 * three actions are full size.
 *
 * No `lg` step: tiles do not get bigger at wide viewports, the grid just
 * adds a column.
 */
const TILE_ACTION_BUTTON =
  "flex h-6 w-6 items-center justify-center rounded-full transition-colors hover:bg-white/25 md:h-5 md:w-5";
const TILE_ACTION_ICON = "text-white/85 md:h-3 md:w-3";

/** Row gap between tiles, kept as one constant since both the CSS grid and the row-height estimate must agree. */
const GRID_GAP = 10;

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

  /**
   * Which kit kinds to show. The Kits tab's answer to the Tools filter:
   * every kit is the same tool, so filtering by tool there would do
   * nothing — what distinguishes one kit from another is its kind.
   */
  const [selectedKinds, setSelectedKinds] = useState<string[]>(() => {
    const raw = searchParams.get("kinds");
    return raw ? raw.split(",").filter(Boolean) : [];
  });

  /** When to show results from. Empty strings mean open-ended. */
  const [dateRange, setDateRange] = useState<DateRange>(() => ({
    from: searchParams.get("from") ?? "",
    to: searchParams.get("to") ?? "",
  }));

  /**
   * Which half of the page is showing. In the URL alongside the filters,
   * for the same reasons: shareable, and back/forward returns to what you
   * were looking at rather than snapping to History.
   */
  const [view, setView] = useState<"history" | "kits">(() =>
    searchParams.get("view") === "kits" ? "kits" : "history"
  );

  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [canReadTeam, setCanReadTeam] = useState(false);
  const [selected, setSelected] = useState<HistoryItem | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");
  /** The result the user has asked to delete, waiting on the confirmation. */
  const [pendingDelete, setPendingDelete] = useState<HistoryItem | null>(null);
  const [pendingKitDelete, setPendingKitDelete] = useState<MarketingKitSummary | null>(null);

  /**
   * Saved Marketing Kits, loaded the first time that tab is opened rather
   * than on mount — most visits to History never look at them, and this is
   * a second request against a collection that is nothing to do with the
   * grid.
   */
  const [kits, setKits] = useState<MarketingKitSummary[] | null>(null);
  const [kitsLoading, setKitsLoading] = useState(false);

  const columns = useResponsiveColumns();
  const scrollRef = useRef<HTMLDivElement>(null);

  /** Writes the current view and filters back to the query string. */
  const syncUrl = useCallback(
    (next: { tools?: string[]; members?: string[]; view?: "history" | "kits"; range?: DateRange; kinds?: string[] }) => {
      const params = new URLSearchParams(searchParams.toString());

      if (next.tools) {
        if (next.tools.length === 0) params.delete("tools");
        else params.set("tools", next.tools.join(","));
      }
      if (next.members) {
        if (next.members.length === 0) params.delete("members");
        else params.set("members", next.members.join(","));
      }
      if (next.kinds) {
        if (next.kinds.length === 0) params.delete("kinds");
        else params.set("kinds", next.kinds.join(","));
      }
      if (next.range) {
        for (const key of ["from", "to"] as const) {
          if (next.range[key]) params.set(key, next.range[key]);
          else params.delete(key);
        }
      }
      if (next.view) {
        if (next.view === "history") params.delete("view");
        else params.set("view", next.view);
      }

      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  function updateRange(next: DateRange) {
    setDateRange(next);
    syncUrl({ range: next });
  }

  function updateFilters(nextTools: string[], nextMembers: string[]) {
    setSelectedTools(nextTools);
    setSelectedMembers(nextMembers);
    syncUrl({ tools: nextTools, members: nextMembers });
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
  const knownMembers = useMemo(
    () => Array.from(new Set([...items, ...(kits ?? [])].map((row) => row.userName))).sort(),
    [items, kits]
  );

  const visibleItems = useMemo(
    () =>
      items.filter(
        (item) =>
          /*
           * A run that wrote a Marketing Kit belongs to the Kits tab, and
           * only there. It is the same piece of work either way, and the
           * results grid is the wrong shape for it — a Brand Story shows as
           * a wall of prose and an Affinity deck as the model's raw JSON,
           * because what those runs actually produced is a document, not a
           * picture.
           *
           * Keyed on the kit pointer rather than on `tool`, so a Campaign
           * Kit retouch — which edits one shot and writes no kit of its own
           * — still appears here, where it has nowhere else to be.
           */
          !item.kitId &&
          withinRange(item.createdAt, dateRange) &&
          (selectedTools.length === 0 || selectedTools.includes(item.tool)) &&
          (selectedMembers.length === 0 || selectedMembers.includes(item.userName))
      ),
    [items, selectedTools, selectedMembers, dateRange]
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
    // Only while the grid is the thing on screen: the virtualizer's last
    // rendered range survives a switch to the kits tab, and acting on it
    // there would fetch another page nobody is looking at.
    if (view !== "history") return;
    const last = virtualRows[virtualRows.length - 1];
    if (!last || last.index < rows.length - 3) return;
    loadMore();
  }, [view, virtualRows, rows.length, loadMore]);

  const totalImages = useMemo(
    () => visibleItems.reduce((sum, item) => sum + item.outputs.length, 0),
    [visibleItems]
  );

  /**
   * The kits the range allows, by when they were last touched — which is
   * what their caption shows, so the filter and the tile agree.
   */
  const visibleKits = useMemo(
    () =>
      kits === null
        ? null
        : kits.filter(
            (kit) =>
              withinRange(kit.updatedAt, dateRange) &&
              (selectedKinds.length === 0 || selectedKinds.includes(kit.kind)) &&
              (selectedMembers.length === 0 || selectedMembers.includes(kit.userName))
          ),
    [kits, dateRange, selectedKinds, selectedMembers]
  );

  /** What the badge counts — whatever the tab on screen is showing. */
  const badgeCount = view === "kits" ? (visibleKits?.length ?? 0) : totalImages;

  /*
   * The `finally` is the point. Without it a request that rejects — the
   * network dropping, a reply that isn't JSON — left `deletingId` set, and
   * a tile whose Delete button is permanently disabled and spinning is a
   * button that can never be pressed again. A failure has to hand the
   * button back.
   */
  /*
   * The tile's Delete button only *asks*. Nothing is removed until the
   * dialog is confirmed — a grid of near-identical thumbnails, with the
   * delete control a few pixels from the one that opens the result, is
   * exactly where a misclick costs something that cannot be recovered.
   */
  const requestDelete = useCallback((item: HistoryItem) => {
    setDeleteError("");
    setPendingDelete(item);
  }, []);

  const handleDelete = useCallback(async (item: HistoryItem) => {
    setDeletingId(item.id);
    setDeleteError("");
    try {
      const res = await deleteHistoryItem(item.id);
      if (res.status === "success") {
        setItems((current) => current.filter((row) => row.id !== item.id));
        setSelected((current) => (current?.id === item.id ? null : current));
        return;
      }
      setDeleteError(res.message || "Could not delete that result. Please try again.");
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Could not delete that result. Please try again.");
    } finally {
      setDeletingId(null);
      // Closed either way: on success there is nothing left to confirm, and
      // on failure the reason is in the banner behind it, which the dialog
      // would otherwise be covering.
      setPendingDelete(null);
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

  /** Loads the kits the first time that tab is opened, and not again. */
  useEffect(() => {
    if (view !== "kits" || kits !== null) return;
    let cancelled = false;

    setKitsLoading(true);
    // Same reach as the grid, so the Members filter carries across the two
    // tabs — the server narrows `team` back to own work for anyone without
    // the permission for it.
    listMarketingKits({ limit: 50, scope: "team" }).then((res) => {
      if (cancelled) return;
      setKits(res.status === "success" ? (res.kits ?? []) : []);
      setKitsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [view, kits]);

  const showView = useCallback(
    (next: "history" | "kits") => {
      setView(next);
      syncUrl({ view: next });
    },
    [syncUrl]
  );

  /*
   * Kits are deleted from the same grid, by the same gesture, and are just
   * as unrecoverable — so they ask first too. Same failure handling as a
   * result, for the same reason: silence here read as a dead button.
   */
  const removeKit = useCallback(async (kit: MarketingKitSummary) => {
    setDeletingId(kit.id);
    setDeleteError("");
    try {
      const res = await deleteMarketingKit(kit.id);
      if (res.status === "success") {
        setKits((current) => (current ?? []).filter((row) => row.id !== kit.id));
        return;
      }
      setDeleteError(res.message || "Could not delete that kit. Please try again.");
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Could not delete that kit. Please try again.");
    } finally {
      setDeletingId(null);
      setPendingKitDelete(null);
    }
  }, []);

  const hasAccess = can(user, HISTORY_PERMISSION);

  const filterControls = hasAccess ? (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {/* A segmented toggle, not two separate pills — one bordered group,
            squared off, split by a single divider. The count sits on the
            corner of the tab that is showing: images under History, saved
            decks under Marketing Kits. */}
        <div className="flex items-center rounded-md border border-white/10">
          <ViewTab
            icon={History}
            label="History"
            side="left"
            active={view === "history"}
            onClick={() => showView("history")}
            badge={view === "history" ? badgeCount : undefined}
            badgeLabel={`${badgeCount} images`}
          />
          <ViewTab
            icon={Newspaper}
            label="Marketing Kits"
            side="right"
            active={view === "kits"}
            onClick={() => showView("kits")}
            badge={view === "kits" ? badgeCount : undefined}
            badgeLabel={`${badgeCount} kits`}
          />
        </div>
        {/* Unlike the two below, this one shows on both tabs: a date range
            narrows a list of documents exactly as well as a grid of
            pictures. */}
        <DateFilter range={dateRange} onChange={updateRange} />

        {canReadTeam && (
          <MemberFilter
            members={knownMembers}
            selected={selectedMembers}
            onChange={(next) => updateFilters(selectedTools, next)}
          />
        )}
      </div>

      {/* The same control in the same place on both tabs, over whichever
          dimension actually separates the rows there: which tool made a
          result, or which kind a kit is. */}
      {view === "history" ? (
        <ToolFilter selected={selectedTools} onChange={(next) => updateFilters(next, selectedMembers)} />
      ) : (
        <KindFilter
          selected={selectedKinds}
          onChange={(next) => {
            setSelectedKinds(next);
            syncUrl({ kinds: next });
          }}
        />
      )}
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

      {/* A delete that fails has to say so. Silence here was the whole
          problem: the tile stayed, and nothing explained why. */}
      {deleteError && (
        <p className="shrink-0 border-b border-error/20 bg-error/[0.08] px-4 py-2 text-xs text-error sm:px-5">
          {deleteError}
        </p>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 lg:p-4">
        {view === "kits" ? (
          <KitsGrid kits={visibleKits} loading={kitsLoading} columns={columns} onDelete={setPendingKitDelete} />
        ) : loading ? (
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
                  style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: GRID_GAP }}
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
                      onDelete={requestDelete}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {view === "history" && loadingMore && (
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
        onDelete={requestDelete}
        onContinue={() => selected && handleContinue(selected)}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete this result?"
        message={
          pendingDelete ? (
            <>
              <span className="text-cream">
                {TOOL_LABELS[pendingDelete.tool] || pendingDelete.tool}
                {pendingDelete.createdAt ? ` · ${new Date(pendingDelete.createdAt).toLocaleString()}` : ""}
              </span>
              <br />
              This permanently removes the {pendingDelete.outputs.length === 1 ? "file" : "files"} it produced. It
              cannot be undone.
            </>
          ) : null
        }
        confirmLabel="Delete"
        busy={Boolean(pendingDelete && deletingId === pendingDelete.id)}
        onConfirm={() => pendingDelete && handleDelete(pendingDelete)}
        onCancel={() => setPendingDelete(null)}
      />

      <ConfirmDialog
        open={Boolean(pendingKitDelete)}
        title="Delete this kit?"
        message={
          pendingKitDelete ? (
            <>
              <span className="text-cream">{pendingKitDelete.title || "Untitled kit"}</span>
              <br />
              This permanently removes the kit and everything in it. It cannot be undone.
            </>
          ) : null
        }
        confirmLabel="Delete"
        busy={Boolean(pendingKitDelete && deletingId === pendingKitDelete.id)}
        onConfirm={() => pendingKitDelete && removeKit(pendingKitDelete)}
        onCancel={() => setPendingKitDelete(null)}
      />
    </div>
  );
}

/**
 * What a tile shows when the run produced words instead of pictures.
 *
 * An excerpt rather than an icon: these results are told apart by what they
 * say, and a grid of identical document glyphs would make a page of them
 * unreadable.
 *
 * Clipped by `line-clamp` alone. A fade at the bottom would read better,
 * but it has to be painted in the tile's own background colour — and that
 * colour comes from a `bg-white/*` tint that the light theme flips to a
 * black one, so a single hardcoded gradient is a smudge in one theme or
 * the other. The ellipsis says the same thing and cannot be wrong.
 *
 * `text-muted` rather than an explicit tint, unlike the lightbox: this tile
 * sits on the page, whose ground flips with the theme, so the token that
 * flips with it is the right one.
 */
function TextResultCover({ text }: { text?: string | null }) {
  return (
    <div className="h-full w-full bg-white/[0.04] p-2.5 pt-7 md:p-3 md:pt-8">
      <p className="line-clamp-6 text-[9px] leading-relaxed text-muted md:text-[10px]">
        {text?.trim() || "No text was recorded for this run."}
      </p>
    </div>
  );
}

/**
 * One half of the segmented History / Marketing Kits toggle.
 *
 * The count rides on the tab it belongs to rather than on the group, so it
 * is never ambiguous which of the two it is counting. That puts it outside
 * the group's own bounds, which is why the rounded ends are on the buttons
 * here instead of an `overflow-hidden` on the container that would clip it.
 */
function ViewTab({
  icon: Icon,
  label,
  active,
  onClick,
  side,
  badge,
  badgeLabel,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
  side: "left" | "right";
  badge?: number;
  badgeLabel?: string;
}) {
  return (
    <span className="relative">
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors",
          // The divider belongs to the left half, so the group reads as one
          // control however many tabs it grows to.
          side === "left" ? "rounded-l-[5px] border-r border-white/10" : "rounded-r-[5px]",
          active ? "bg-gold/[0.08] text-gold" : "text-faint hover:bg-white/[0.04] hover:text-cream"
        )}
      >
        <Icon size={12} /> {label}
      </button>
      {badge != null && badge > 0 && (
        <span
          aria-label={badgeLabel}
          className="pointer-events-none absolute -right-1.5 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-gold px-1 text-[9px] font-bold text-[#4A3410] shadow-sm"
        >
          {badge}
        </span>
      )}
    </span>
  );
}

/**
 * The saved Marketing Kits, as a list rather than the image grid beside it.
 *
 * A kit is a document — it is found by its name and its date, and a row
 * carries both plus one thumbnail. The grid next door is the right shape
 * for pictures and the wrong one for these.
 */
/**
 * The saved kits, as the same tiles the results grid uses.
 *
 * Same square geometry, same column count, same chrome — badge top-left,
 * actions top-right, caption along the bottom. Switching tabs changes what
 * is in the grid, not what a grid looks like, and a second card style would
 * make the two halves read as two different pages.
 */
function KitsGrid({
  kits,
  loading,
  columns,
  onDelete,
}: {
  kits: MarketingKitSummary[] | null;
  loading: boolean;
  columns: number;
  onDelete: (kit: MarketingKitSummary) => void;
}) {
  if (loading || kits === null) return <SkeletonGrid rows={2} />;

  if (kits.length === 0) {
    return (
      <p className="px-2 py-10 text-center text-sm text-faint">
        No kits yet — a Brand Story, Affinity deck or Campaign Kit is saved here to reopen and edit.
      </p>
    );
  }

  return (
    <div className="grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: GRID_GAP }}>
      {kits.map((kit) => (
        <KitTile key={kit.id} kit={kit} onDelete={onDelete} />
      ))}
    </div>
  );
}

function KitTile({ kit, onDelete }: { kit: MarketingKitSummary; onDelete: (kit: MarketingKitSummary) => void }) {
  return (
    <div
      title={kit.title || "Untitled kit"}
      className="group relative aspect-square overflow-hidden rounded-lg border border-white/[0.06] transition-colors hover:border-white/20 md:rounded-xl"
    >
      <Link href={kitHref(kit)} className="absolute inset-0" aria-label={kit.title || "Untitled kit"}>
        {kit.previewUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element -- small grid tile, lazy-loaded natively; next/image adds no value at this size */
          <img
            src={kit.previewUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.05]"
          />
        ) : (
          /* A kit whose save failed has no picture to show. */
          <span className="flex h-full w-full items-center justify-center bg-white/[0.04]">
            <Newspaper size={22} className="text-faint" />
          </span>
        )}
      </Link>

      <div className="pointer-events-none absolute left-1.5 right-1.5 top-1.5 flex items-start justify-between gap-1 md:left-2 md:right-2 md:top-2">
        {/* The same badge the results tiles carry, in Marketing Kit's own
            colour, so a kit is recognisable at a glance in either tab. */}
        <span
          className="max-w-[60%] truncate rounded-full px-1 py-0.5 text-[7px] font-semibold backdrop-blur-sm md:px-1.5 md:text-[9px] lg:text-[10px]"
          style={toolBadgeStyle("marketing_kit")}
        >
          {describeKit(kit)}
        </span>

        {/* A teammate's kit is readable but not theirs to remove — the
            server refuses it, so the tile doesn't offer it. */}
        {kit.isOwn !== false && (
          <div className={cn(TILE_ACTION_GROUP, "pointer-events-auto")}>
            <button
              type="button"
              onClick={() => onDelete(kit)}
              title="Delete"
              aria-label={`Delete ${kit.title || "this kit"}`}
              className={cn(TILE_ACTION_BUTTON, "hover:bg-error/75")}
            >
              <Trash2 size={10} className={TILE_ACTION_ICON} />
            </button>
          </div>
        )}
      </div>

      <div className="pointer-events-none absolute bottom-1.5 left-1.5 right-1.5 flex items-end justify-between gap-1 md:bottom-2 md:left-2 md:right-2">
        {/* Who made it, in the same corner and the same chip the results
            tiles use for it — the kit's own name is the badge above and the
            tooltip on the tile, so this corner stays the one place you look
            to see whose work a tile is. */}
        <span className="truncate rounded-full bg-black/55 px-1.5 py-0.5 text-[8px] font-medium text-white/85 backdrop-blur-sm md:px-2 md:text-[10px] lg:text-[11px]">
          {kit.userName}
        </span>
        <span className="shrink-0 rounded-full bg-black/55 px-1.5 py-0.5 text-[8px] font-medium text-white/85 backdrop-blur-sm md:px-2 md:text-[10px]">
          {timeAgoShort(kit.updatedAt)}
        </span>
      </div>

      {/* A kit whose save failed is shown rather than hidden — the run
          happened, and the reason is the only thing that explains why there
          is nothing to open. */}
      {kit.status === "failed" && (
        <p className="pointer-events-none absolute inset-x-1.5 bottom-8 truncate rounded bg-error/80 px-1.5 py-0.5 text-[8px] font-medium text-white md:inset-x-2 md:bottom-10 md:text-[10px]">
          {kit.error || "Could not be saved"}
        </p>
      )}
    </div>
  );
}

/** A short relative date for a kit row — the grid's tiles use their own. */
function timeAgoShort(iso: string) {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
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

  const closeMenu = useCallback(() => setOpen(false), []);
  useDismissable(containerRef, open, closeMenu);

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

/** A `from`/`to` pair, each an ISO date (`YYYY-MM-DD`) or empty for open-ended. */
export type DateRange = { from: string; to: string };

export const EMPTY_RANGE: DateRange = { from: "", to: "" };

/** Local `YYYY-MM-DD`, which is what a `<input type="date">` speaks. */
function isoDay(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return isoDay(date);
}

/**
 * The shortcuts, resolved to real dates the moment they are picked.
 *
 * Storing the resolved dates rather than "last 7 days" is what makes a
 * filtered view shareable and stable: a link sent to a colleague shows the
 * same rows tomorrow as it did today.
 */
const DATE_PRESETS: { id: string; label: string; resolve: () => DateRange }[] = [
  { id: "today", label: "Today", resolve: () => ({ from: isoDay(new Date()), to: isoDay(new Date()) }) },
  { id: "7d", label: "Last 7 days", resolve: () => ({ from: daysAgo(6), to: isoDay(new Date()) }) },
  { id: "30d", label: "Last 30 days", resolve: () => ({ from: daysAgo(29), to: isoDay(new Date()) }) },
  {
    id: "month",
    label: "This month",
    resolve: () => {
      const now = new Date();
      return { from: isoDay(new Date(now.getFullYear(), now.getMonth(), 1)), to: isoDay(now) };
    },
  },
];

/**
 * Whether a timestamp falls inside the range.
 *
 * `to` is inclusive of the whole day. Someone picking "1st to 5th" means
 * through the end of the 5th, not up to midnight at its start — the other
 * reading silently drops everything made on the last day they chose.
 */
export function withinRange(iso: string, range: DateRange) {
  if (!range.from && !range.to) return true;
  const at = new Date(iso).getTime();

  if (range.from && at < new Date(`${range.from}T00:00:00`).getTime()) return false;
  if (range.to && at > new Date(`${range.to}T23:59:59.999`).getTime()) return false;
  return true;
}

/** A short label for the trigger, so the active range reads without opening it. */
function describeRange(range: DateRange) {
  const preset = DATE_PRESETS.find((entry) => {
    const resolved = entry.resolve();
    return resolved.from === range.from && resolved.to === range.to;
  });
  if (preset) return preset.label;
  if (range.from && range.to) return `${range.from} → ${range.to}`;
  if (range.from) return `From ${range.from}`;
  if (range.to) return `Until ${range.to}`;
  return "Date";
}

/** When to show results from — presets, or an exact pair of dates. */
function DateFilter({ range, onChange }: { range: DateRange; onChange: (next: DateRange) => void }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const active = Boolean(range.from || range.to);

  const closeMenu = useCallback(() => setOpen(false), []);
  useDismissable(containerRef, open, closeMenu);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-full border border-white/10 bg-surface-raised py-1.5 pl-3 pr-2.5 text-xs font-medium text-cream transition-colors hover:border-white/20"
      >
        <CalendarRange size={12} className="text-faint" />
        <span className="max-w-40 truncate">{describeRange(range)}</span>
        <ChevronDown size={13} className="text-faint" />
      </button>

      {active && (
        <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-gold text-[9px] font-bold text-[#4A3410] shadow-sm">
          1
        </span>
      )}

      {open && (
        <div className="absolute right-0 top-full z-10 mt-2 w-60 overflow-hidden rounded-lg border border-white/10 bg-surface-raised shadow-lg">
          <div className="py-1">
            <button
              type="button"
              onClick={() => onChange(EMPTY_RANGE)}
              className="flex w-full items-center border-b border-white/5 px-3 py-1.5 text-left text-xs font-medium text-cream hover:bg-white/[0.05]"
            >
              Any time
            </button>
            {DATE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => onChange(preset.resolve())}
                className="flex w-full items-center px-3 py-1.5 text-left text-xs text-cream hover:bg-white/[0.05]"
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="space-y-2 border-t border-white/5 px-3 py-2.5">
            <p className="text-[10px] font-medium uppercase tracking-widest text-faint">Custom</p>
            <label className="flex items-center justify-between gap-2 text-[11px] text-muted">
              From
              <input
                type="date"
                value={range.from}
                max={range.to || undefined}
                onChange={(event) => onChange({ ...range, from: event.target.value })}
                className="min-h-8 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 text-[11px] text-cream focus:border-gold/30 focus:outline-none"
              />
            </label>
            <label className="flex items-center justify-between gap-2 text-[11px] text-muted">
              To
              <input
                type="date"
                value={range.to}
                min={range.from || undefined}
                onChange={(event) => onChange({ ...range, to: event.target.value })}
                className="min-h-8 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 text-[11px] text-cream focus:border-gold/30 focus:outline-none"
              />
            </label>
          </div>
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

/** The kit kinds, labelled as the rest of the app labels them. */
const KIND_OPTIONS: FilterOption[] = (["brand_story", "affinity", "campaign"] as const).map((kind) => ({
  id: kind,
  label: KIT_LABEL[kind],
}));

/** Which kinds of kit to show — the Kits tab's counterpart to Tools. */
function KindFilter({ selected, onChange }: { selected: string[]; onChange: (next: string[]) => void }) {
  return (
    <CheckboxFilter
      icon={SlidersHorizontal}
      label="Kind"
      emptyLabel="No kinds to filter by."
      options={KIND_OPTIONS}
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

    return (
      <div
        className="group relative aspect-square cursor-pointer overflow-hidden rounded-lg border border-white/[0.06] transition-colors hover:border-white/20 md:rounded-xl"
        onClick={() => onOpen(item)}
      >
        {/* The small copy, not the original: a full page of results is tens
            of megabytes at full size and under a megabyte here. The original
            is still what the download link and the lightbox below point at.
            A video result is a poster frame rather than a broken image.

            A run that made words rather than pictures — Image to Text, and
            Marketing Kit's writing halves — has no cover at all, and shows
            an excerpt instead. It used to render nothing, which did not
            hide the run so much as punch a hole in the grid: the tile was
            still counted into its row, so the row came up one short. */}
        {cover ? (
          <AssetThumb
            output={cover}
            alt={toolLabel}
            className="transition-transform duration-500 group-hover:scale-[1.05]"
          />
        ) : (
          <TextResultCover text={item.text} />
        )}

        <div className="absolute left-1.5 right-1.5 top-1.5 flex items-start justify-between gap-1 md:left-2 md:right-2 md:top-2">
          <div className="flex min-w-0 items-center gap-1">
            <span
              className="max-w-[55%] truncate rounded-full px-1 py-0.5 text-[7px] font-semibold backdrop-blur-sm md:px-1.5 md:text-[9px] lg:text-[10px]"
              style={toolBadgeStyle(item.tool)}
            >
              {toolLabel}
            </span>

            {/* The output size — "4K", "1K", the video's resolution. Same
                fact the lightbox prints beside the model name, up here too
                so a grid can be scanned for it without opening anything.
                Absent on a text result, which has no size. */}
            {item.quality && (
              <span className="shrink-0 rounded-full bg-black/55 px-1 py-0.5 text-[7px] font-semibold text-white/85 backdrop-blur-sm md:px-1.5 md:text-[9px] lg:text-[10px]">
                {item.quality}
              </span>
            )}
          </div>

          <div className={TILE_ACTION_GROUP}>
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

            {/* Absent on a text result — there is no file to save, and a
                button that does nothing when pressed reads as broken. */}
            {cover && (
              <button
                type="button"
                title="Download"
                onClick={(event) => {
                  // The tile is clickable; downloading must not also open it.
                  event.stopPropagation();
                  // The full-size original, never the grid thumbnail — and
                  // saved under its real extension, so a clip arrives as a
                  // playable .mp4 rather than an .jpg nothing will open.
                  downloadImage(cover.url, downloadName(cover.url, `${item.tool}-${item.id}`, cover.type));
                }}
                className={TILE_ACTION_BUTTON}
              >
                <Download size={10} className={TILE_ACTION_ICON} />
              </button>
            )}

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

        <div className="absolute bottom-1.5 left-1.5 right-1.5 flex items-end justify-between gap-1 md:bottom-2 md:left-2 md:right-2">
          <span className="truncate rounded-full bg-black/55 px-1.5 py-0.5 text-[8px] font-medium text-white/85 backdrop-blur-sm md:px-2 md:text-[10px] lg:text-[11px]">
            {item.userName}
          </span>

          {/* How many images this run produced. Down here rather than up with
              the actions: it is information about the tile, not a control, and
              a long name truncates before it rather than pushing it off. */}
          {item.outputs.length > 1 && (
            <span className="flex h-5 shrink-0 items-center gap-0.5 rounded-full bg-black/55 px-1.5 text-[8px] font-medium text-white/85 backdrop-blur-sm md:h-6 md:text-[10px]">
              <Copy size={9} className="md:h-2.5 md:w-2.5" /> {item.outputs.length}
            </span>
          )}
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
