"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import { io } from "socket.io-client";
import { ArrowUp, History, Newspaper } from "lucide-react";
import {
  BACKEND_URL,
  deleteHistoryItem,
  deleteMarketingKit,
  fetchHistory,
  fetchHistoryFacets,
  fetchHistoryItem,
  listMarketingKits,
  MODEL_LABELS,
  type HistoryItem,
  type MarketingKitSummary,
} from "@/lib/api";
import { conversationHref, TOOL_LABELS, workspacePathFor } from "@/lib/nav";
import { usePageToolbar } from "@/lib/page-toolbar-context";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/permissions";
import { getPageCache, pageCacheKey, setPageCache } from "@/lib/pageCache";
import { HistoryLightbox } from "@/components/studio/HistoryLightbox";
import { ConfirmDialog } from "@/components/studio/ConfirmDialog";
import { ScrollEnds } from "@/components/admin/ScrollEnds";
import {
  DateFilter,
  KindFilter,
  MemberFilter,
  MoreFilters,
  QualityFilter,
  ToolFilter,
  TypeFilter,
  ViewTab,
  withinRange,
  type DateRange,
} from "./HistoryFilters";
import { GRID_GAP, HistoryTile, KitsGrid, OPENS_AS_RESULT, SkeletonGrid } from "./HistoryTiles";

const HISTORY_PERMISSION = "result.read.own";
/** Opening a colleague's chat, read-only — see grants.js. */
const VIEW_CHATS_PERMISSION = "org.conversations.read";
/** Deleting a colleague's result — see grants.js. */
const DELETE_OTHERS_PERMISSION = "org.results.delete";

/**
 * When the browser last went Back or Forward.
 *
 * The grid is returned to where it was left only on Back — opening History
 * from the nav is a fresh start, at the top — and a `popstate` is the one
 * signal that tells the two apart: a link pushes history, Back pops it. Set
 * at module level because the page is unmounted at the moment it fires and
 * mounts just after, so the stamp has to outlive it.
 */
let poppedAt = 0;
if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    poppedAt = Date.now();
  });
}
/** How soon after a Back the page must mount to count as arriving by it. */
const BACK_WINDOW_MS = 5000;

/**
 * The tile at the top of the grid when it was left. A tile rather than a
 * pixel offset: the column count can change between visits (a resized
 * window), and results can arrive or vanish above it, and either would leave
 * a saved offset pointing at different pictures.
 */
type ScrollAnchor = { id: string };

/** The Sparkle label for a model, falling back through the known id map to the raw value the server sent. */
function modelLabelFor(model?: string | null) {
  if (!model) return null;
  return MODEL_LABELS[model] || model;
}

/** Whether the viewport is at least `px` wide — tracked live, so a rotated tablet or a resized window reacts immediately. */
function useMinWidth(px: number) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(`(min-width: ${px}px)`);
    const update = () => setMatches(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [px]);

  return matches;
}

/**
 * What the server is being asked for. Every filter is in here, because the
 * server applies all of them — the cursor has to walk the filtered set, not
 * the whole collection.
 *
 * `scope: "team"` is always safe to ask for: the server only honours it for
 * someone holding `result.read.others` and quietly falls back to their own
 * work otherwise.
 *
 * A plain function rather than inline in the page, because the page needs it
 * twice: once for the fetch, and once before its first render to look up what
 * it showed last time for the same filters.
 */
function buildHistoryQuery(
  tools: string[],
  members: string[],
  qualities: string[],
  types: string[],
  range: DateRange
) {
  return {
    scope: "team" as const,
    tools: tools.length ? tools : undefined,
    members: members.length ? members : undefined,
    qualities: qualities.length ? qualities : undefined,
    types: types.length ? types : undefined,
    /*
     * Sent as exact instants, not as bare dates.
     *
     * "From the 1st" means from midnight where the person is, and a bare
     * `2026-09-01` is parsed as midnight UTC — which in this timezone is
     * half past six the evening before, quietly pulling in a chunk of the
     * previous day. Resolving the boundary here, where the timezone is
     * known, keeps the range meaning what the picker showed. `to` covers
     * the whole of its day, as the picker implies.
     */
    from: range.from ? new Date(`${range.from}T00:00:00`).toISOString() : undefined,
    to: range.to ? new Date(`${range.to}T23:59:59.999`).toISOString() : undefined,
  };
}

/** The grid as last shown for one set of filters — what a revisit opens on. */
type HistorySnapshot = {
  items: HistoryItem[];
  nextCursor: string | null;
  serverTotal: number | null;
  canReadTeam: boolean;
};

/** A comma-separated filter from the query string — empty when it is absent. */
function listParam(params: { get(name: string): string | null }, name: string) {
  const raw = params.get(name);
  return raw ? raw.split(",").filter(Boolean) : [];
}

/** 2 columns on mobile, 4 on tablet, 6 on desktop. */
function useResponsiveColumns() {
  const tablet = useMinWidth(640);
  const desktop = useMinWidth(1024);
  return desktop ? 6 : tablet ? 4 : 2;
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
  const [selectedTools, setSelectedTools] = useState<string[]>(() => listParam(searchParams, "tools"));
  const [selectedMembers, setSelectedMembers] = useState<string[]>(() => listParam(searchParams, "members"));

  /**
   * Which kit kinds to show. The Kits tab's answer to the Tools filter:
   * every kit is the same tool, so filtering by tool there would do
   * nothing — what distinguishes one kit from another is its kind.
   */
  const [selectedKinds, setSelectedKinds] = useState<string[]>(() => listParam(searchParams, "kinds"));

  /** Which resolutions to show — the badge on every tile. Empty means all. */
  const [selectedQualities, setSelectedQualities] = useState<string[]>(() => listParam(searchParams, "quality"));

  /**
   * What the run produced, which is a different question from which tool made
   * it: "find that video" is one filter, not a guess at which tool it was.
   */
  const [selectedTypes, setSelectedTypes] = useState<string[]>(() => listParam(searchParams, "types"));

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

  /** Where this person's grid for one set of filters is kept between visits. */
  const userId = user?.user_id;
  const historyKey = useCallback(
    (query: ReturnType<typeof buildHistoryQuery>) => pageCacheKey(userId, "history", query),
    [userId]
  );

  /*
   * What this page showed last time for the filters it is opening with, if
   * anything. Read once, before the first paint, so a revisit opens straight
   * onto the grid instead of a skeleton; the fetch below then refreshes it.
   */
  const [initialKey] = useState(() =>
    historyKey(buildHistoryQuery(selectedTools, selectedMembers, selectedQualities, selectedTypes, dateRange))
  );
  const [initial] = useState(() => getPageCache<HistorySnapshot>(initialKey));
  /** The query the rows on screen were fetched for — see the cache write below. */
  const dataKeyRef = useRef<string | null>(initial ? initialKey : null);

  const [items, setItems] = useState<HistoryItem[]>(() => initial?.items ?? []);
  /**
   * Colleagues' new results, fetched but held back because the reader is
   * scrolled down the grid — slotting them in above would shove what they
   * are looking at out from under them. Shown as a "N new" pill instead.
   */
  const [pendingNew, setPendingNew] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(!initial);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(initial?.nextCursor ?? null);
  const [serverTotal, setServerTotal] = useState<number | null>(initial?.serverTotal ?? null);
  const [canReadTeam, setCanReadTeam] = useState(initial?.canReadTeam ?? false);
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
  const kitsKey = pageCacheKey(userId, "history-kits");
  const [kits, setKits] = useState<MarketingKitSummary[] | null>(
    () => getPageCache<MarketingKitSummary[]>(kitsKey) ?? null
  );
  const [kitsLoading, setKitsLoading] = useState(false);
  /** Whether this visit has asked the server yet — a cached list is shown, but still refreshed once. */
  const kitsFetchedRef = useRef(false);

  // Kept in step with deletes and refreshes, so the next visit opens on the current list.
  useEffect(() => {
    if (kits) setPageCache(kitsKey, kits);
  }, [kits, kitsKey]);

  const columns = useResponsiveColumns();
  // Which form the filter row takes — see `filterControls`.
  const tabletUp = useMinWidth(768);
  const wide = useMinWidth(1280);
  const scrollRef = useRef<HTMLDivElement>(null);

  /** Writes the current view and filters back to the query string. */
  const syncUrl = useCallback(
    (next: {
      tools?: string[];
      members?: string[];
      view?: "history" | "kits";
      range?: DateRange;
      kinds?: string[];
      qualities?: string[];
      types?: string[];
    }) => {
      const params = new URLSearchParams(searchParams.toString());
      // Untouched when not passed; an empty list drops the key.
      const setList = (name: string, values?: string[]) => {
        if (!values) return;
        if (values.length === 0) params.delete(name);
        else params.set(name, values.join(","));
      };

      setList("tools", next.tools);
      setList("quality", next.qualities);
      setList("types", next.types);
      setList("members", next.members);
      setList("kinds", next.kinds);
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

  const historyQuery = useMemo(
    () => buildHistoryQuery(selectedTools, selectedMembers, selectedQualities, selectedTypes, dateRange),
    [selectedTools, selectedMembers, selectedQualities, selectedTypes, dateRange]
  );

  /*
   * Guards against a slow response for one filter landing after a faster one
   * for the next and overwriting it. Every filter change starts a new page
   * one, and they do not come back in order.
   */
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    const key = historyKey(historyQuery);
    // Seen this exact question before: show that answer now and refresh it
    // quietly, rather than blanking the grid to a skeleton.
    const cached = getPageCache<HistorySnapshot>(key);
    if (cached) {
      dataKeyRef.current = key;
      setItems(cached.items);
      setNextCursor(cached.nextCursor);
      setServerTotal(cached.serverTotal);
      setCanReadTeam(cached.canReadTeam);
      setLoading(false);
    } else {
      setLoading(true);
    }
    // Page one of the new question already includes anything held back.
    setPendingNew([]);

    (async () => {
      const res = await fetchHistory(historyQuery);
      // A newer set of filters already superseded this request.
      if (id !== requestId.current) return;
      if (res.status === "success") {
        dataKeyRef.current = key;
        const fresh = res.items ?? [];
        let next = fresh;
        let cursor = res.nextCursor ?? null;

        /*
         * Refreshing a grid that was already on screen from the cache. Page
         * one is authoritative for its own time range — it brings in anything
         * new and drops anything deleted there — but the older pages the
         * reader had scrolled through are kept below it, cursor and all.
         * Replacing them with page one alone would cut the grid back to the
         * top, and with it the spot a reader coming Back is returned to.
         */
        if (cached?.items.length && fresh.length && res.nextCursor) {
          const freshIds = new Set(fresh.map((row) => row.id));
          const oldestFresh = fresh[fresh.length - 1].createdAt;
          const older = cached.items.filter((row) => row.createdAt < oldestFresh && !freshIds.has(row.id));
          if (older.length) {
            next = [...fresh, ...older];
            cursor = cached.nextCursor;
          }
        }

        /*
         * Results that arrived while the reader was elsewhere. At the top of
         * the grid they simply slot in; scrolled down — as a reader returned
         * to their spot is — they wait behind the "N new" pill, exactly as a
         * live arrival would, rather than shoving the grid out from under
         * them.
         */
        if (cached?.items.length && !atTopRef.current) {
          const known = new Set(cached.items.map((row) => row.id));
          const newest = cached.items[0].createdAt;
          const arrived = next.filter((row) => !known.has(row.id) && row.createdAt > newest);
          if (arrived.length) {
            const held = new Set(arrived.map((row) => row.id));
            next = next.filter((row) => !held.has(row.id));
            setPendingNew(arrived);
          }
        }

        setItems(next);
        setNextCursor(cursor);
        setServerTotal(res.totalImages ?? null);
        setCanReadTeam(Boolean(res.canReadTeam));
      }
      setLoading(false);
    })();
  }, [historyQuery, historyKey]);

  /*
   * Mirrors the grid into the cache as it changes — after a fetch, a further
   * page, a live arrival or a delete — so the next visit opens on exactly what
   * was last on screen. Filed under the query the rows were fetched for, which
   * the ref tracks: while a new filter's first page is still in flight, the
   * rows on screen still belong to the old one.
   */
  useEffect(() => {
    if (loading || !dataKeyRef.current) return;
    setPageCache<HistorySnapshot>(dataKeyRef.current, { items, nextCursor, serverTotal, canReadTeam });
  }, [loading, items, nextCursor, serverTotal, canReadTeam]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    const id = requestId.current;
    const res = await fetchHistory({ ...historyQuery, before: nextCursor });
    // The filters changed while this page was in flight — its rows belong to
    // a query nobody is looking at any more.
    if (id === requestId.current && res.status === "success") {
      setItems((current) => [...current, ...(res.items ?? [])]);
      setNextCursor(res.nextCursor ?? null);
    }
    setLoadingMore(false);
  }, [nextCursor, loadingMore, historyQuery]);

  /*
   * Everyone whose work this person can see, from the server — not everyone
   * who happens to have been paged in.
   *
   * Deriving it from loaded rows was wrong in both directions once filtering
   * moved server-side: someone absent from the first page could not be
   * filtered for at all, and the list collapsed to one name the moment a
   * filter was applied.
   */
  const facetsKey = pageCacheKey(userId, "history-facets");
  const [cachedFacets] = useState(() => getPageCache<{ members: string[]; qualities: string[] }>(facetsKey));
  const [facetMembers, setFacetMembers] = useState<string[]>(cachedFacets?.members ?? []);
  const [facetQualities, setFacetQualities] = useState<string[]>(cachedFacets?.qualities ?? []);

  useEffect(() => {
    let cancelled = false;
    fetchHistoryFacets("team").then((res) => {
      if (cancelled || res.status !== "success") return;
      setFacetMembers(res.members ?? []);
      setFacetQualities(res.qualities ?? []);
      setPageCache(facetsKey, { members: res.members ?? [], qualities: res.qualities ?? [] });
    });
    return () => {
      cancelled = true;
    };
  }, [facetsKey]);

  // Kits are still filtered in the browser, so their authors have to be
  // offered too — the facets call only covers generations.
  const knownMembers = useMemo(
    () => Array.from(new Set([...facetMembers, ...(kits ?? []).map((kit) => kit.userName)])).sort(),
    [facetMembers, kits]
  );

  /*
   * The rows, as they came back.
   *
   * There is no filtering left to do here — tool, member, date range and the
   * kit-runs exclusion are all applied by the server now, so what arrives is
   * already the answer. A run that wrote a Marketing Kit is excluded there
   * for the same reason it was excluded here: it belongs to the Kits tab, and
   * the grid is the wrong shape for it — a Brand Story shows as a wall of
   * prose and an Affinity deck as the model's raw JSON.
   */
  const visibleItems = items;

  // Rows of `columns` items each — virtualized by row, not by card, so a grid
  // (not a single-column list) still only mounts what's on screen.
  const rows = useMemo(() => {
    const chunks: HistoryItem[][] = [];
    for (let i = 0; i < visibleItems.length; i += columns) chunks.push(visibleItems.slice(i, i + columns));
    return chunks;
  }, [visibleItems, columns]);

  /** Where to put the grid back to, when this visit arrived by Back — see below. */
  const [restoreAnchor] = useState<ScrollAnchor | null>(() =>
    initial && Date.now() - poppedAt < BACK_WINDOW_MS
      ? (getPageCache<ScrollAnchor | null>(`${initialKey}:anchor`) ?? null)
      : null
  );
  /** Still being applied — cleared once the layout settles or the reader scrolls. */
  const pendingAnchor = useRef(restoreAnchor);
  const [restoring, setRestoring] = useState(Boolean(restoreAnchor));

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 200,
    overscan: 6,
    gap: GRID_GAP,
    // A jump to a row far down mounts and measures that row's tiles inside
    // React's commit, where the virtualizer's synchronous re-render is
    // refused. Off only for the jump; ordinary scrolling keeps it.
    useFlushSync: !restoring,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();

  /*
   * ── Returning to where the reader was ────────────────────────────────────
   *
   * Opening a result's chat leaves this page, and coming Back rebuilt the
   * grid at the top — a reader 200 results down had to scroll all the way
   * back. Now the tile at the top of the screen is remembered as they scroll,
   * and a Back lands on it again. Opening History from the nav still starts
   * at the top.
   */
  // Spent: a later Back to some other page must not count as one here.
  useEffect(() => {
    poppedAt = 0;
  }, []);

  /*
   * Applied on every change to the rows while pending, not once: the column
   * count starts at the narrowest and corrects itself after the first paint,
   * and the background refresh can reshape the rows again — each moves the
   * anchor tile to a different row.
   */
  useEffect(() => {
    const anchor = pendingAnchor.current;
    if (!anchor || view !== "history") return;
    const index = rows.findIndex((row) => row.some((item) => item.id === anchor.id));
    if (index < 0) return;
    // Next frame, not here: the virtualizer re-renders synchronously
    // (`flushSync`) as it scrolls, which React refuses mid-commit.
    const frame = requestAnimationFrame(() => rowVirtualizer.scrollToIndex(index, { align: "start" }));
    return () => cancelAnimationFrame(frame);
  }, [rows, view, rowVirtualizer]);

  // The reader taking over, or a moment passing, ends the restore.
  useEffect(() => {
    if (!pendingAnchor.current) return;
    const el = scrollRef.current;
    const stop = () => {
      pendingAnchor.current = null;
      setRestoring(false);
    };
    const timer = setTimeout(stop, 1500);
    el?.addEventListener("wheel", stop, { passive: true });
    el?.addEventListener("touchstart", stop, { passive: true });
    window.addEventListener("keydown", stop);
    return () => {
      clearTimeout(timer);
      el?.removeEventListener("wheel", stop);
      el?.removeEventListener("touchstart", stop);
      window.removeEventListener("keydown", stop);
    };
  }, []);

  // Read by the scroll handler below, which outlives any one render.
  const rowsRef = useRef(rows);
  const virtualizerRef = useRef(rowVirtualizer);
  useEffect(() => {
    rowsRef.current = rows;
    virtualizerRef.current = rowVirtualizer;
  });

  /*
   * Remembers the top tile as the reader scrolls — once a frame at most —
   * filed beside the rows themselves, so each set of filters keeps its own
   * place and a filter change starts fresh at the top.
   */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let frame = 0;
    const save = () => {
      frame = 0;
      // Mid-restore, the position is ours rather than the reader's.
      if (pendingAnchor.current || !dataKeyRef.current) return;
      const key = `${dataKeyRef.current}:anchor`;
      if (el.scrollTop < 48) {
        setPageCache<ScrollAnchor | null>(key, null);
        return;
      }
      const top = virtualizerRef.current.getVirtualItems().find((row) => row.end > el.scrollTop);
      const tile = top ? rowsRef.current[top.index]?.[0] : undefined;
      if (tile) setPageCache<ScrollAnchor | null>(key, { id: tile.id });
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(save);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

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

  const loadedImages = useMemo(
    () => visibleItems.reduce((sum, item) => sum + item.outputs.length, 0),
    [visibleItems]
  );
  /*
   * The server's count of everything the filters match, not what has been
   * paged in. Never below what is on screen — new runs arriving live, or an
   * older backend that sends no total, fall back to the loaded count.
   */
  const totalImages = Math.max(serverTotal ?? 0, loadedImages);

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

  /**
   * The run behind each Campaign Kit and Festive Poster tile, by kit id —
   * what lets those tiles open the results viewer and the chat, the way an
   * image tile does. Fetched once per kit as the tab shows it; small, and
   * only for those two kinds (the others are decks, opened in their editor).
   */
  const [kitItems, setKitItems] = useState<Record<string, HistoryItem>>({});
  const requestedKitItems = useRef(new Set<string>());
  useEffect(() => {
    if (view !== "kits" || !visibleKits) return;
    for (const kit of visibleKits) {
      if (!OPENS_AS_RESULT.has(kit.kind) || !kit.generationId || requestedKitItems.current.has(kit.id)) continue;
      requestedKitItems.current.add(kit.id);
      fetchHistoryItem(kit.generationId).then((res) => {
        // The kit's kind is the mode: it is what sends "open the chat" to the
        // Campaign Kit or Festive Poster page rather than the Marketing Kit hub.
        if (res.status === "success" && res.item) {
          const item = { ...res.item, mode: kit.kind };
          setKitItems((current) => ({ ...current, [kit.id]: item }));
        }
      });
    }
  }, [view, visibleKits]);
  /** A result opened from a kit tile — deleting it is the kit's own button, not the viewer's. */
  const kitGenerationIds = useMemo(() => new Set(Object.values(kitItems).map((item) => item.id)), [kitItems]);

  /** What the badge counts — whatever the tab on screen is showing. */
  const badgeCount = view === "kits" ? (visibleKits?.length ?? 0) : totalImages;

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

  /*
   * The `finally` is the point. Without it a request that rejects — the
   * network dropping, a reply that isn't JSON — left `deletingId` set, and
   * a tile whose Delete button is permanently disabled and spinning is a
   * button that can never be pressed again. A failure has to hand the
   * button back.
   */
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
      const href = conversationHref(item.tool, item.conversationId, item.model, item.mode);
      if (href) router.push(href);
    },
    [router]
  );

  const openItem = useCallback((item: HistoryItem) => setSelected(item), []);

  // Live updates: the same generation-complete event that lets a tool page
  // skip a manual refresh also lets History prepend a brand-new result the
  // instant it's ready, with no poll and no page reload.
  useEffect(() => {
    if (!userId) return;

    const socket = io(BACKEND_URL, { withCredentials: true });
    socket.on("history:generation", (item: HistoryItem) => {
      // Always prepended to the one dataset — whether it's currently *shown*
      // is up to `visibleItems`, which reacts to it the moment it lands.
      setItems((current) => (current.some((row) => row.id === item.id) ? current : [item, ...current]));
    });

    /*
     * Someone in the organization finished or deleted something. The ping
     * carries no result — whether this reader may see it is for the server
     * to decide — so an addition is fetched through the same scoped,
     * filtered request as the rest of the grid, asking only for what is
     * newer than the newest tile here.
     *
     * Debounced: a batch of ten cleans is ten pings a second or two apart,
     * and one request for all of them is the right answer to that.
     */
    let timer: ReturnType<typeof setTimeout> | null = null;
    socket.on("history:changed", (event: { kind: "added" | "removed"; id?: string }) => {
      if (event.kind === "removed" && event.id) {
        const gone = event.id;
        setItems((current) => current.filter((row) => row.id !== gone));
        setPendingNew((current) => current.filter((row) => row.id !== gone));
        setSelected((current) => (current?.id === gone ? null : current));
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => fetchNewerRef.current(), 800);
    });

    return () => {
      if (timer) clearTimeout(timer);
      socket.disconnect();
    };
  }, [userId]);

  // Current values for the live refresh, which runs from a long-lived socket
  // handler. Written after each render, the only point that is safe to.
  const itemsRef = useRef(items);
  const pendingRef = useRef(pendingNew);
  const queryRef = useRef(historyQuery);
  useEffect(() => {
    itemsRef.current = items;
    pendingRef.current = pendingNew;
    queryRef.current = historyQuery;
  });

  /*
   * Whether the grid is scrolled to (near) its top — the one position where
   * a new result can be slotted in without moving anything the reader is
   * looking at. Read by the live refresh through a ref, since it runs from a
   * socket handler that is not re-created on every scroll.
   */
  const [atTop, setAtTop] = useState(true);
  const atTopRef = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const next = el.scrollTop < 48;
      atTopRef.current = next;
      setAtTop(next);
    };
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  /** Brings held-back results into the grid. */
  const showPending = useCallback((scrollUp: boolean) => {
    const held = pendingRef.current;
    if (held.length) {
      setItems((current) => {
        const known = new Set(current.map((row) => row.id));
        return [...held.filter((row) => !known.has(row.id)), ...current];
      });
      setPendingNew([]);
    }
    if (scrollUp) scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // Scrolling back up to the top by hand counts as asking for them.
  useEffect(() => {
    if (atTop && pendingNew.length) showPending(false);
  }, [atTop, pendingNew.length, showPending]);

  /**
   * Fetches only what is newer than anything on screen or held back, with
   * the grid's own filters — the server applies scope and filters, so what
   * comes back is exactly what a reload would have added.
   */
  const fetchNewerRef = useRef<() => void>(() => {});
  useEffect(() => {
    fetchNewerRef.current = async () => {
      const id = requestId.current;
      const newest = [...pendingRef.current, ...itemsRef.current].reduce<string | undefined>(
        (max, row) => (!max || row.createdAt > max ? row.createdAt : max),
        undefined
      );
      const res = await fetchHistory({ ...queryRef.current, after: newest });
      // Filters changed while this was in flight: page one is being refetched anyway.
      if (id !== requestId.current || res.status !== "success" || !res.items?.length) return;

      const known = new Set([...itemsRef.current, ...pendingRef.current].map((row) => row.id));
      const fresh = res.items.filter((row) => !known.has(row.id));
      if (!fresh.length) return;

      if (atTopRef.current) setItems((current) => [...fresh, ...current]);
      else setPendingNew((current) => [...fresh, ...current]);
    };
  });

  /**
   * Loads the kits the first time that tab is opened on this visit, and not
   * again. A list cached from an earlier visit is already on screen, so it is
   * swapped for the fresh one in a single step rather than shrinking to the
   * first page and growing back.
   */
  useEffect(() => {
    if (view !== "kits" || kitsFetchedRef.current) return;
    kitsFetchedRef.current = true;
    let cancelled = false;
    const hadCache = getPageCache(kitsKey) !== undefined;

    if (!hadCache) setKitsLoading(true);
    // Same reach as the grid, so the Members filter carries across the two
    // tabs — the server narrows `team` back to own work for anyone without
    // the permission for it.
    // Every page, not just the first: kits are filtered here in the browser,
    // so the badge and the filters are only right if all of them are loaded.
    // Each page is shown as it lands, so the first kits appear after one
    // round trip rather than after the last page.
    (async () => {
      let all: MarketingKitSummary[] = [];
      let cursor: string | undefined;
      let failed = false;
      do {
        const res = await listMarketingKits({ limit: 50, scope: "team", cursor });
        if (cancelled) return;
        if (res.status !== "success") {
          failed = true;
          break;
        }
        all = [...all, ...(res.kits ?? [])];
        if (!hadCache) {
          setKits(all);
          setKitsLoading(false);
        }
        cursor = res.nextCursor ?? undefined;
      } while (cursor);
      // A refresh that failed keeps the cached list rather than emptying it.
      if (!(failed && hadCache)) setKits(all);
      setKitsLoading(false);
    })();

    return () => {
      cancelled = true;
      // Interrupted before it finished — let the next visit to the tab try again.
      kitsFetchedRef.current = false;
    };
  }, [view, kitsKey]);

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
  /** Their own result, in a tool that can resume its thread. */
  const continuable = (item: HistoryItem) => item.isOwn && Boolean(workspacePathFor(item.tool, item.model));
  /** May open a colleague's chat to read. The server also checks the data scope. */
  const canViewChats = can(user, VIEW_CHATS_PERMISSION);
  const viewable = (item: HistoryItem) =>
    canViewChats && !item.isOwn && Boolean(item.conversationId && workspacePathFor(item.tool, item.model));
  /** May delete a colleague's result. Own results can always be deleted. */
  const canDeleteOthers = can(user, DELETE_OTHERS_PERMISSION);
  const deletable = (item: HistoryItem) => item.isOwn || canDeleteOthers;

  /**
   * The filter row, in one of its two forms.
   *
   * `compact` drops every label and leaves the icons. On a phone the labelled
   * version wrapped to three rows — a third of the screen spent on controls
   * before a single result — and the icons say the same thing, with the
   * count badge each one already carries to show it is doing something.
   */
  const renderFilters = (compact: boolean) => (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {renderViewTabs(compact)}
        {renderSecondaryFilters(compact)}
      </div>
      {renderToolFilter(compact)}
    </>
  );

  /** How many of the filters folded into the phone's "more" menu are set — its badge. */
  const moreActiveCount =
    selectedMembers.length +
    (view === "history" ? selectedQualities.length + selectedTypes.length : 0) +
    (dateRange.from || dateRange.to ? 1 : 0);

  /*
   * The phone layout, in the header itself: the view toggle and Tools stay
   * out, everything else folds into one "more" menu. A second bar of
   * filters under the header cost a row of a screen that's short already.
   */
  const renderPhoneFilters = () => (
    <div className="flex min-w-0 flex-1 items-center justify-between gap-1.5">
      <div className="flex items-center gap-1.5">
        {renderViewTabs(true)}
        <MoreFilters activeCount={moreActiveCount}>{renderSecondaryFilters(false)}</MoreFilters>
      </div>
      {renderToolFilter(true)}
    </div>
  );

  /* A segmented toggle, not two separate pills — one bordered group,
     squared off, split by a single divider. The count sits on the corner of
     the tab that is showing: images under History, saved decks under
     Marketing Kits. */
  const renderViewTabs = (compact: boolean) => (
    <div className="flex items-center rounded-md border border-white/10">
      <ViewTab
        icon={History}
        label="History"
        side="left"
        compact={compact}
        active={view === "history"}
        onClick={() => showView("history")}
        badge={view === "history" ? badgeCount : undefined}
        badgeLabel={`${badgeCount} images`}
      />
      <ViewTab
        icon={Newspaper}
        label="Marketing Kits"
        side="right"
        compact={compact}
        active={view === "kits"}
        onClick={() => showView("kits")}
        badge={view === "kits" ? badgeCount : undefined}
        badgeLabel={`${badgeCount} kits`}
      />
    </div>
  );

  const renderSecondaryFilters = (compact: boolean) => (
    <>
      {/* Unlike the two below, this one shows on both tabs: a date range
            narrows a list of documents exactly as well as a grid of
            pictures. */}
      <DateFilter range={dateRange} onChange={updateRange} compact={compact} />

      {canReadTeam && (
        <MemberFilter
          members={knownMembers}
          selected={selectedMembers}
          onChange={(next) => updateFilters(selectedTools, next)}
          compact={compact}
          self={user?.name}
        />
      )}

      {/* History only — a kit has no resolution and is never a video. */}
      {view === "history" && (
        <>
          <QualityFilter
            options={facetQualities}
            selected={selectedQualities}
            onChange={(next) => {
              setSelectedQualities(next);
              syncUrl({ qualities: next });
            }}
            compact={compact}
          />
          <TypeFilter
            selected={selectedTypes}
            onChange={(next) => {
              setSelectedTypes(next);
              syncUrl({ types: next });
            }}
            compact={compact}
          />
        </>
      )}
    </>
  );

  /* The same control in the same place on both tabs, over whichever
     dimension actually separates the rows there: which tool made a result,
     or which kind a kit is. */
  const renderToolFilter = (compact: boolean) =>
    view === "history" ? (
      <ToolFilter
        selected={selectedTools}
        onChange={(next) => updateFilters(next, selectedMembers)}
        compact={compact}
      />
    ) : (
      <KindFilter
        selected={selectedKinds}
        onChange={(next) => {
          setSelectedKinds(next);
          syncUrl({ kinds: next });
        }}
        compact={compact}
      />
    );

  /*
   * Icons only on tablets and small laptops, labels from `xl` up. The
   * labelled row is ~700px wide, and between `md` (where it moves into the
   * header) and `xl` the header has less than that once the sidebar and the
   * account menu are counted — it wrapped to a second line the fixed-height
   * header then clipped.
   */
  const filterControls = hasAccess ? (
    <>
      {/* One form at a time — mounting all three and hiding two with CSS
          tripled every filter's state, listeners and re-renders. */}
      {tabletUp ? (
        <div className="flex min-w-0 flex-1 items-center justify-between gap-2">{renderFilters(!wide)}</div>
      ) : (
        renderPhoneFilters()
      )}
    </>
  ) : null;

  // These render in the header at every width, replacing the breadcrumb —
  // there's no room for both there, and the filters are the more useful of
  // the two on this page.
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
      {/* A delete that fails has to say so. Silence here was the whole
          problem: the tile stayed, and nothing explained why. */}
      {deleteError && (
        <p className="shrink-0 border-b border-error/20 bg-error/[0.08] px-4 py-2 text-xs text-error sm:px-5">
          {deleteError}
        </p>
      )}

      {/* The wrapper holds the jump arrows still while the grid scrolls. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* Held-back results, offered rather than forced — see pendingNew. */}
        {view === "history" && pendingNew.length > 0 && (
          <button
            type="button"
            onClick={() => showPending(true)}
            className="absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-gold/30 bg-surface-raised px-3 py-1.5 text-[11px] font-medium text-gold shadow-lg transition-colors hover:bg-gold/10"
          >
            <ArrowUp size={12} />
            {pendingNew.length} new {pendingNew.length === 1 ? "result" : "results"}
          </button>
        )}
        <div ref={scrollRef} className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-3 lg:p-4">
          {view === "kits" ? (
            <KitsGrid
              kits={visibleKits}
              loading={kitsLoading}
              columns={columns}
              onDelete={setPendingKitDelete}
              items={kitItems}
              canContinue={continuable}
              canView={viewable}
              onOpen={openItem}
              onContinue={handleContinue}
            />
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
                        canContinue={continuable(item)}
                        canView={viewable(item)}
                        canDelete={deletable(item)}
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
        <ScrollEnds scrollerRef={scrollRef} />
      </div>

      <HistoryLightbox
        item={selected}
        toolLabel={selected ? TOOL_LABELS[selected.tool] || selected.tool : ""}
        modelLabel={modelLabelFor(selected?.model)}
        canContinue={Boolean(selected && continuable(selected))}
        canView={Boolean(selected && viewable(selected))}
        canDelete={Boolean(selected && deletable(selected) && !kitGenerationIds.has(selected.id))}
        deleting={Boolean(selected && deletingId === selected.id)}
        onClose={() => setSelected(null)}
        onDelete={requestDelete}
        onContinue={() => selected && handleContinue(selected)}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={pendingDelete && !pendingDelete.isOwn ? `Delete ${pendingDelete.userName}'s result?` : "Delete this result?"}
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
              {/* Said out loud, because the owner will not have asked for it. */}
              {!pendingDelete.isOwn && (
                <>
                  {" "}
                  It is gone for {pendingDelete.userName} too, and the deletion is recorded in the audit log.
                </>
              )}
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
