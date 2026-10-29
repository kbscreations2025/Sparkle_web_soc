"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type DragEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ImageOff, Search, Loader2, Sparkles, Upload, Users, ZoomIn, ZoomOut } from "lucide-react";
import { fetchLibrary, fetchLibraryFolders, type LibraryItem, type LibrarySection } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { libraryItemsToFiles } from "@/lib/library";
import { TOOLS, TOOL_LABELS, toolBadgeStyle } from "@/lib/nav";
import { can } from "@/lib/permissions";
import { useEscapeKey } from "@/lib/useEscapeKey";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 48;

/**
 * The most one pick adds to a box that sets no limit of its own. Every pick
 * is a full-size original — results run to 20MB — so a pick is a download,
 * and an unbounded one is a long wait nobody meant to start.
 */
const MAX_PICK = 20;

const SECTIONS: LibrarySection[] = ["results", "uploads"];
const SECTION_LABELS: Record<LibrarySection, string> = { uploads: "Uploaded", results: "Generated" };

/** A half's icon, where there is no room for its name. */
function SectionIcon({ section }: { section: LibrarySection }) {
  return section === "uploads" ? <Upload size={13} /> : <Sparkles size={13} />;
}

/**
 * `people` is whose pictures — teammates' user ids, "me" for the viewer.
 * Empty is the viewer's own, as is just "me"; anyone else makes it a team query.
 */
type View = { section: LibrarySection; tools: string[]; people: string[] };
type Member = { id: string; name: string };

function scopeOf(view: View) {
  const team = view.people.some((id) => id !== "me");
  return { scope: team ? ("team" as const) : ("own" as const), members: team ? view.people : [] };
}

/**
 * Where the library was last left. Module-level, so it reopens on the same
 * folder — from this box, the next one, or the next tool's — until a reload.
 * The case this is for is a chain (clean a photo, then use the result in
 * Lifestyle), which is the same folder twice in a row.
 */
let lastView: View = { section: "results", tools: [], people: [] };

/** The sidebar's draggable width, in px — small by default, kept across openings like `lastView`. */
const SIDEBAR_MIN = 100;
const SIDEBAR_MAX = 160;
let lastSidebarWidth = SIDEBAR_MIN;

/**
 * How many photos to a row from `md` — the tile-size slider, fewer columns
 * being bigger photos. Phones keep their fixed three/four.
 */
const COLUMNS_MIN = 3;
const COLUMNS_MAX = 12;
let lastColumns = 5;
/** Whether the viewport is at Tailwind's `md` or wider — where the slider applies. */
function useIsDesktop() {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia("(min-width: 48rem)");
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () => window.matchMedia("(min-width: 48rem)").matches,
    () => false
  );
}

/** Nav order, so a tool's folder is always in the same place in the list. */
const TOOL_ORDER = TOOLS.map((tool) => tool.id);
function byNavOrder(tools: string[]) {
  const rank = (tool: string) => (TOOL_ORDER.includes(tool) ? TOOL_ORDER.indexOf(tool) : TOOL_ORDER.length);
  return [...tools].sort((a, b) => rank(a) - rank(b));
}

type PickerProps = {
  onClose: () => void;
  /**
   * Whatever was chosen, as files — off the disk, dropped on the dialog, or
   * picked from the library and fetched. One callback for all three, so the
   * box's own upload handler treats a pick exactly as an upload.
   */
  onFiles: (files: File[]) => void;
  /** How many more the box takes. Unset is no limit of its own (one pick still stops at `MAX_PICK`). */
  room?: number;
};

/**
 * "Add photos" for an upload box: upload from the computer — first, and the
 * most prominent — or pick earlier uploads and results back out of the
 * library, in automatic folders by half and by tool.
 *
 * A centred dialog on a desktop, a sheet from the bottom on a phone, like the
 * model builder. Portalled to <body> so a page's scroll containers can't clip
 * it. Mounted only while open, so every opening starts with nothing selected;
 * the folder is remembered across openings (`lastView`).
 */
export function LibraryPicker({ open, ...props }: PickerProps & { open: boolean }) {
  if (!open || typeof document === "undefined") return null;
  return createPortal(<LibraryDialog {...props} />, document.body);
}

function LibraryDialog({ onClose, onFiles, room }: PickerProps) {
  const { user } = useAuth();
  const limit = Math.max(1, Math.min(room ?? MAX_PICK, MAX_PICK));

  const [view, setView] = useState<View>(lastView);
  // Guessed from the session so the toggle doesn't pop in late; the server's answer then settles it.
  const [canReadTeam, setCanReadTeam] = useState(() => can(user, "result.read.others"));
  const [folders, setFolders] = useState<Record<LibrarySection, string[]> | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [page, setPage] = useState<{ items: LibraryItem[]; cursor: string | null; status: "loading" | "ready" | "failed" }>({
    items: [],
    cursor: null,
    status: "loading",
  });
  const [attempt, setAttempt] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [selected, setSelected] = useState<LibraryItem[]>([]);
  /** How many of the selection have downloaded, while "Use selected" is running. */
  const [adding, setAdding] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);

  const input = useRef<HTMLInputElement>(null);
  const uploadButton = useRef<HTMLButtonElement>(null);
  const sidebarUploadButton = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const downloads = useRef<AbortController | null>(null);

  const { scope, members: scopeMembers } = scopeOf(view);
  const peopleKey = scopeMembers.join(",");
  const teamView = scope === "team" && canReadTeam;

  useEscapeKey(onClose);

  const [columns, setColumns] = useState(lastColumns);
  function changeColumns(next: number) {
    lastColumns = next;
    setColumns(next);
  }
  const isDesktop = useIsDesktop();
  const gridStyle: CSSProperties | undefined = isDesktop
    ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }
    : undefined;

  const [sidebarWidth, setSidebarWidth] = useState(lastSidebarWidth);
  // Too narrow for the words: the upload box and the section toggle go to icons.
  const compactSidebar = sidebarWidth < 136;
  function resizeSidebar(width: number) {
    const next = Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width)));
    lastSidebarWidth = next;
    setSidebarWidth(next);
  }
  function startSidebarResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const onMove = (move: PointerEvent) => resizeSidebar(startWidth + move.clientX - startX);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // The quickest way out is the one most people want — the file dialog — so it has focus.
  useEffect(() => {
    (uploadButton.current?.offsetParent ? uploadButton.current : sidebarUploadButton.current)?.focus();
  }, []);

  // Closing mid-download stops the downloads, and nothing is added.
  useEffect(() => () => downloads.current?.abort(), []);

  /*
   * The view as of the last change, for callbacks that outlive a render — a
   * page landing for a folder since left is dropped rather than appended to
   * the new one. Written where the view changes as well as after render, so
   * two changes in one tick still build on each other.
   */
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  function changeView(patch: Partial<View>) {
    const next = { ...viewRef.current, ...patch };
    viewRef.current = next;
    lastView = next;
    setView(next);
    setPage({ items: [], cursor: null, status: "loading" });
    setMoreFailed(false);
    scrollRef.current?.scrollTo({ top: 0 });
  }

  useEffect(() => {
    let live = true;
    fetchLibraryFolders(scope, scopeMembers)
      .then((res) => {
        if (!live || res.status !== "success") return;
        const next = { uploads: byNavOrder(res.uploads), results: byNavOrder(res.results) };
        setFolders(next);
        setMembers(res.members ?? []);
        setCanReadTeam(res.canReadTeam);
        // A remembered folder that has nothing in it here — the team view
        // was switched, or its pictures were deleted — opens as "All" instead.
        const current = viewRef.current;
        const kept = current.tools.filter((tool) => next[current.section].includes(tool));
        if (kept.length !== current.tools.length) changeView({ tools: kept });
      })
      // Only the folder list is lost — the grid below still loads on its own.
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on who, not on the array's identity
  }, [scope, peopleKey]);

  useEffect(() => {
    let live = true;
    fetchLibrary({
      section: view.section,
      tools: view.tools,
      ...scopeOf(view),
      limit: PAGE_SIZE,
    })
      .then((res) => {
        if (!live) return;
        if (res.status !== "success") {
          setPage({ items: [], cursor: null, status: "failed" });
          return;
        }
        setPage({ items: res.items, cursor: res.nextCursor, status: "ready" });
        setCanReadTeam(res.canReadTeam);
      })
      .catch(() => {
        if (live) setPage({ items: [], cursor: null, status: "failed" });
      });
    return () => {
      live = false;
    };
  }, [view, attempt]);

  /*
   * The next page, when the end of the grid scrolls near. Guarded by a ref
   * as well as state: two intersections can arrive before a re-render, and
   * both would otherwise see `loadingMore` still false.
   */
  const inFlight = useRef(false);

  function loadMore() {
    if (!page.cursor || page.status !== "ready" || moreFailed || inFlight.current) return;
    const asked = view;
    inFlight.current = true;
    setLoadingMore(true);
    fetchLibrary({
      section: asked.section,
      tools: asked.tools,
      ...scopeOf(asked),
      before: page.cursor,
      limit: PAGE_SIZE,
    })
      .then((res) => {
        if (viewRef.current !== asked) return;
        if (res.status !== "success") {
          setMoreFailed(true);
          return;
        }
        setPage((current) => {
          const known = new Set(current.items.map((item) => item.id));
          return {
            items: [...current.items, ...res.items.filter((item) => !known.has(item.id))],
            cursor: res.nextCursor,
            status: "ready",
          };
        });
      })
      .catch(() => {
        if (viewRef.current === asked) setMoreFailed(true);
      })
      .finally(() => {
        inFlight.current = false;
        setLoadingMore(false);
      });
  }

  /*
   * Re-observed after every page: an observer only reports a change in
   * visibility, so a page too short to push the sentinel out of view would
   * otherwise never ask for the next one. A fresh observer reports where
   * the sentinel is now, and loads again while it is still close.
   */
  const loadMoreRef = useRef(loadMore);
  useEffect(() => {
    loadMoreRef.current = loadMore;
  });
  useEffect(() => {
    const root = scrollRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMoreRef.current();
      },
      { root, rootMargin: "0px 0px 600px 0px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [page, loadingMore, moreFailed]);

  /** Month by month, newest first — the order the server sends them in. */
  const months = useMemo(() => {
    const groups = new Map<string, { label: string; items: LibraryItem[] }>();
    for (const item of page.items) {
      const date = new Date(item.createdAt);
      const key = `${date.getFullYear()}-${date.getMonth()}`;
      if (!groups.has(key)) {
        groups.set(key, { label: date.toLocaleDateString(undefined, { month: "long", year: "numeric" }), items: [] });
      }
      groups.get(key)!.items.push(item);
    }
    return [...groups.entries()].map(([key, group]) => ({ key, ...group }));
  }, [page.items]);

  function toggle(item: LibraryItem) {
    setError("");
    setSelected((current) => {
      if (current.some((entry) => entry.id === item.id)) return current.filter((entry) => entry.id !== item.id);
      // A box that takes one: picking another swaps it, rather than refusing.
      if (limit === 1) return [item];
      if (current.length >= limit) return current;
      return [...current, item];
    });
  }

  async function addSelected() {
    if (selected.length === 0 || adding !== null) return;
    const controller = new AbortController();
    downloads.current = controller;
    setAdding(0);
    setError("");
    try {
      const files = await libraryItemsToFiles(selected, { signal: controller.signal, onProgress: setAdding });
      if (controller.signal.aborted) return;
      onFiles(files);
      onClose();
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Could not load those photos — try again.");
      setAdding(null);
    }
  }

  /** Off the disk — through the button, or dropped onto the dialog. */
  function addFromDisk(list: FileList | null | undefined) {
    const images = [...(list ?? [])].filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) return;
    onFiles(images);
    onClose();
  }

  const isFileDrag = (event: DragEvent) => event.dataTransfer.types.includes("Files");

  const full = limit > 1 && selected.length >= limit;
  function statusLine() {
    if (adding !== null) {
      return selected.length > 1 ? `Adding ${selected.length} photos… ${adding} of ${selected.length} ready` : "Adding photo…";
    }
    if (error) return error;
    if (selected.length) return full ? `${selected.length} selected — the most this box takes` : `${selected.length} selected`;
    return limit === 1 ? "Pick one photo" : `Pick up to ${limit}`;
  }

  return (
    <div
      className="fixed inset-0 z-[55] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={(event) => {
        // Not on to whatever the box sits in: React carries portal events up the component tree.
        event.stopPropagation();
        onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={limit === 1 ? "Add a photo" : "Add photos"}
        onClick={(event) => event.stopPropagation()}
        onDragOver={(event) => {
          if (!isFileDrag(event)) return;
          event.preventDefault();
          event.stopPropagation();
          setDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(event) => {
          if (!isFileDrag(event)) return;
          event.preventDefault();
          event.stopPropagation();
          setDragging(false);
          addFromDisk(event.dataTransfer.files);
        }}
        className="animate-drawer-up relative flex h-[88dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-white/[0.08] bg-surface-deep shadow-2xl sm:h-[min(46rem,calc(100dvh-3rem))] sm:max-w-3xl sm:rounded-2xl md:max-w-4xl"
      >
        <input
          ref={input}
          type="file"
          accept="image/*"
          multiple={limit !== 1}
          hidden
          onChange={(event) => {
            addFromDisk(event.target.files);
            event.target.value = "";
          }}
        />

        {/* Phones and narrow windows: the upload box tops the sheet, always in
            view, with the folders as tabs and chips under it. From `md` all of
            this is the sidebar instead. */}
        <div className="shrink-0 space-y-2 border-b border-white/[0.06] px-4 pb-2 pt-3 sm:px-5 md:hidden">
          {/* One slim row on a phone — the tall box would cost a row of photos. */}
          <button
            ref={uploadButton}
            type="button"
            onClick={() => input.current?.click()}
            className="flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-gold/40 bg-gold/[0.06] px-3 text-xs font-semibold text-gold transition-colors active:bg-gold/[0.14]"
          >
            <Upload size={15} />
            Upload from device
          </button>
          {/* One compact row: the half as two icons, then which tools and
              whose — each a checklist, so nothing scrolls sideways. */}
          <div className="flex items-center gap-1.5">
            <div className="grid shrink-0 grid-cols-2 gap-0.5 rounded-lg border border-white/[0.08] bg-white/[0.03] p-0.5">
              {SECTIONS.map((section) => (
                <button
                  key={section}
                  type="button"
                  onClick={() => changeView({ section, tools: [] })}
                  aria-pressed={view.section === section}
                  aria-label={SECTION_LABELS[section]}
                  title={SECTION_LABELS[section]}
                  className={cn(
                    "flex h-7 w-8 items-center justify-center rounded-md transition-colors",
                    view.section === section ? "bg-gold/15 text-gold" : "text-muted hover:text-cream"
                  )}
                >
                  <SectionIcon section={section} />
                </button>
              ))}
            </div>
            <div className="min-w-0 flex-1">
              <ToolSelect
                section={view.section}
                tools={folders?.[view.section] ?? []}
                selected={view.tools}
                onChange={(tools) => changeView({ tools })}
              />
            </div>
            {canReadTeam && (
              <div className="w-28 shrink-0">
                <PersonSelect view={view} members={members} selfName={user?.name} onChange={changeView} />
              </div>
            )}
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* The upload box first, then every folder in both halves — the whole
              library in one column, nothing behind a tab. */}
          <div className="relative hidden shrink-0 md:block" style={{ width: sidebarWidth }}>
          <nav aria-label="Library folders" className="thin-scrollbar h-full w-full overflow-y-auto border-r border-white/[0.06] px-2 pb-2">
            <UploadBox ref={sidebarUploadButton} onClick={() => input.current?.click()} className="mb-3" compact={compactSidebar} />
            <div role="tablist" aria-label="Library section" className="mb-2 grid grid-cols-2 gap-0.5 rounded-lg border border-white/[0.08] bg-white/[0.03] p-0.5">
              {SECTIONS.map((section) => (
                <button
                  key={section}
                  type="button"
                  role="tab"
                  aria-selected={view.section === section}
                  aria-label={SECTION_LABELS[section]}
                  title={SECTION_LABELS[section]}
                  onClick={() => changeView({ section, tools: [] })}
                  className={cn(
                    "flex min-h-7 items-center justify-center rounded-md text-[11px] font-medium transition-colors",
                    view.section === section ? "bg-gold/15 text-gold" : "text-muted hover:text-cream"
                  )}
                >
                  {compactSidebar ? <SectionIcon section={section} /> : SECTION_LABELS[section]}
                </button>
              ))}
            </div>
            <FolderButton active={view.tools.length === 0} onClick={() => changeView({ tools: [] })}>
              All {view.section}
            </FolderButton>
            {folders?.[view.section].map((tool) => (
              <FolderButton key={tool} tool={tool} active={view.tools.length === 1 && view.tools[0] === tool} onClick={() => changeView({ tools: [tool] })}>
                {TOOL_LABELS[tool] ?? tool}
              </FolderButton>
            ))}
            {folders && folders[view.section].length === 0 && <p className="px-2 py-1 text-[11px] text-faint">Nothing yet</p>}
          </nav>
          {/* Drag to widen or narrow the sidebar, between SIDEBAR_MIN and SIDEBAR_MAX. */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            aria-valuemin={SIDEBAR_MIN}
            aria-valuemax={SIDEBAR_MAX}
            aria-valuenow={sidebarWidth}
            tabIndex={0}
            onPointerDown={startSidebarResize}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") resizeSidebar(sidebarWidth - 8);
              if (event.key === "ArrowRight") resizeSidebar(sidebarWidth + 8);
            }}
            className="absolute -right-1 top-0 z-[3] h-full w-2 cursor-col-resize touch-none transition-colors hover:bg-gold/30 focus-visible:bg-gold/30 focus-visible:outline-none"
          />
          </div>

          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {/* From `md`, whose pictures sits on the month heading's line, top
              right of the grid, so it costs the grid no height of its own. */}
          <div className="absolute right-4 top-1 z-[2] hidden items-center gap-2 sm:right-5 md:flex">
            <TileSizeSlider columns={columns} onChange={changeColumns} />
            {canReadTeam && (
              <div className="w-44">
                <PersonSelect view={view} members={members} selfName={user?.name} onChange={changeView} />
              </div>
            )}
          </div>
          <div ref={scrollRef} className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-4 sm:px-5">
            {page.status === "loading" ? (
              <ul className="grid grid-cols-3 gap-1.5 pt-10 sm:grid-cols-4" style={gridStyle} aria-label="Loading">
                {Array.from({ length: 15 }, (_, index) => (
                  <li key={index} className="aspect-square animate-pulse rounded-lg bg-white/[0.04]" />
                ))}
              </ul>
            ) : page.status === "failed" ? (
              <Notice
                title="Couldn't load your library"
                action={
                  <button
                    type="button"
                    onClick={() => {
                      setPage({ items: [], cursor: null, status: "loading" });
                      setAttempt((count) => count + 1);
                    }}
                    className="rounded-lg border border-white/[0.1] px-3 py-1.5 text-[11px] text-cream transition-colors hover:border-gold/40"
                  >
                    Try again
                  </button>
                }
              />
            ) : page.items.length === 0 ? (
              <Notice
                title={view.section === "uploads" ? "No uploads here yet" : "No results here yet"}
                detail={
                  view.section === "uploads"
                    ? "Photos given to Sparkle's tools land here, ready to use again."
                    : "What Sparkle's tools make lands here, ready to be the next tool's photo."
                }
              />
            ) : (
              <>
                {months.map((month) => (
                  <section key={month.key}>
                    <h3 className="sticky top-0 z-[1] flex items-center bg-surface-deep/95 py-2 text-[11px] font-medium text-muted backdrop-blur-sm md:min-h-10 md:py-0">
                      {month.label}
                    </h3>
                    <ul className="grid grid-cols-3 gap-1.5 pb-2 sm:grid-cols-4" style={gridStyle}>
                      {month.items.map((item) => {
                        const order = selected.findIndex((entry) => entry.id === item.id) + 1;
                        return (
                          <Tile
                            key={item.id}
                            item={item}
                            order={order}
                            single={limit === 1}
                            blocked={full && order === 0}
                            showOwner={teamView && !item.isOwn}
                            onToggle={() => toggle(item)}
                          />
                        );
                      })}
                    </ul>
                  </section>
                ))}
                {page.cursor &&
                  (moreFailed ? (
                    <div className="flex justify-center py-4">
                      <button
                        type="button"
                        onClick={() => setMoreFailed(false)}
                        className="rounded-lg border border-white/[0.1] px-3 py-1.5 text-[11px] text-cream transition-colors hover:border-gold/40"
                      >
                        Couldn&apos;t load more — try again
                      </button>
                    </div>
                  ) : (
                    <div ref={sentinelRef} className="flex justify-center py-4">
                      {loadingMore && <Loader2 size={16} className="animate-spin text-faint" />}
                    </div>
                  ))}
              </>
            )}
          </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-white/[0.06] px-4 py-2 sm:px-5">
          <div className="flex min-w-0 items-center gap-2">
            <p className={cn("min-w-0 truncate text-[11px]", error ? "text-error" : "text-muted")}>{statusLine()}</p>
            {selected.length > 1 && adding === null && (
              <button type="button" onClick={() => setSelected([])} className="shrink-0 text-[11px] text-faint hover:text-cream">
                Clear
              </button>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            {/* The ✕ above already does this on a phone, where the row is narrow. */}
            <button
              type="button"
              onClick={onClose}
              className="hidden min-h-7 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 text-xs font-medium text-cream transition-colors hover:border-white/[0.16] sm:block"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={addSelected}
              disabled={selected.length === 0 || adding !== null}
              className="flex min-h-7 items-center gap-1.5 rounded-lg border border-gold/30 bg-gold/15 px-3 text-xs font-semibold text-gold transition-colors hover:bg-gold/25 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {adding !== null ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              Use selected{selected.length > 0 && ` (${selected.length})`}
            </button>
          </div>
        </div>

        {dragging && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[inherit] border-2 border-dashed border-gold/50 bg-surface-deep/85">
            <p className="text-sm font-medium text-gold">Drop to upload</p>
          </div>
        )}
      </div>
    </div>
  );
}

/** One picture in the grid — the thumbnail alone; what it is lives in its label. */
function Tile({
  item,
  order,
  single,
  blocked,
  showOwner,
  onToggle,
}: {
  item: LibraryItem;
  /** Its place in the selection, from 1 — 0 when it isn't picked. */
  order: number;
  /** A box that takes one shows a tick rather than a number. */
  single: boolean;
  /** The selection is full and this isn't in it. */
  blocked: boolean;
  /** Whose it is, in the team view, when it isn't the viewer's own. */
  showOwner: boolean;
  onToggle: () => void;
}) {
  const label = [
    `${TOOL_LABELS[item.tool] ?? item.tool} ${item.role === "generated" ? "result" : "upload"}`,
    new Date(item.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }),
    item.isOwn ? null : item.userName,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={order > 0}
        aria-disabled={blocked || undefined}
        aria-label={label}
        title={label}
        className={cn(
          "relative block aspect-square w-full overflow-hidden rounded-lg border bg-surface-raised transition",
          order > 0 ? "border-gold ring-2 ring-gold/70" : "border-white/[0.08] hover:border-gold/40",
          blocked && "cursor-not-allowed opacity-40 hover:border-white/[0.08]"
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- small grid tile, lazy-loaded natively; same as AssetThumb */}
        <img
          src={item.thumbnailUrl}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          className="h-full w-full object-cover"
        />
        {order > 0 && (
          <span className="absolute right-1 top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-gold px-1 text-[10px] font-semibold text-surface-deep shadow">
            {single ? <Check size={12} strokeWidth={3} /> : order}
          </span>
        )}
        {showOwner && (
          <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/75 to-transparent px-1.5 pb-1 pt-4 text-left text-[9px] font-medium text-white/90">
            {item.userName}
          </span>
        )}
      </button>
    </li>
  );
}

/**
 * The way to the file dialog, shaped like a small version of the page's own
 * dropzone so it reads as "put photos here" rather than as one more button.
 * A drop on it works too — the dialog takes a drop anywhere — so it says so
 * where there is a mouse to drag with.
 */
function UploadBox({
  ref,
  onClick,
  className,
  compact = false,
}: {
  ref?: Ref<HTMLButtonElement>;
  onClick: () => void;
  className?: string;
  /** The narrowest sidebar: the icon and one word, no box ratio. */
  compact?: boolean;
}) {
  if (compact) {
    return (
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        title="Upload from computer — or drop photos here"
        aria-label="Upload from computer"
        className={cn(
          "mt-3 flex w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-gold/40 bg-gold/[0.06] px-1 py-2.5 text-center transition-colors",
          "hover:border-gold/70 hover:bg-gold/[0.12] focus-visible:border-gold/70 focus-visible:bg-gold/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40",
          className
        )}
      >
        <Upload size={18} className="text-gold" />
        <span className="text-[11px] font-semibold text-gold">Upload</span>
      </button>
    );
  }
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-16 w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-gold/40 bg-gold/[0.06] px-3 py-3 text-center transition-colors",
        "hover:border-gold/70 hover:bg-gold/[0.12] focus-visible:border-gold/70 focus-visible:bg-gold/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40",
        "md:mt-3 md:aspect-[4/3]",
        className
      )}
    >
      <Upload size={18} className="text-gold" />
      <span className="text-xs font-semibold text-gold">
        <span className="sm:hidden">Upload from device</span>
        <span className="hidden sm:inline">Upload from computer</span>
      </span>
      <span className="hidden text-[10px] text-faint md:block">or drop photos here</span>
    </button>
  );
}

/** Photo size: drag right for bigger photos (fewer to a row), left for smaller. */
function TileSizeSlider({ columns, onChange }: { columns: number; onChange: (columns: number) => void }) {
  // The slider runs small → big, columns the other way.
  const size = COLUMNS_MAX + COLUMNS_MIN - columns;
  const percent = ((size - COLUMNS_MIN) / (COLUMNS_MAX - COLUMNS_MIN)) * 100;
  const step =(delta: number) => onChange(Math.min(COLUMNS_MAX, Math.max(COLUMNS_MIN, columns - delta)));
  return (
    <div className="flex h-7 items-center gap-1 rounded-md border border-white/[0.1] bg-white/[0.03] px-1.5 text-muted">
      <button type="button" onClick={() => step(-1)} aria-label="Smaller photos" title="Smaller photos" className="hover:text-cream">
        <ZoomOut size={11} />
      </button>
      {/* Drawn by hand — a thin line with a dot per stop and a round knob —
          over a transparent native range that does the dragging and keys. */}
      <div className="relative mx-1 flex h-4 w-16 items-center">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-faint/50" />
        <div
          aria-hidden
          className="pointer-events-none absolute left-0 top-1/2 h-px -translate-y-1/2 bg-gold"
          style={{ width: `${percent}%` }}
        />
        {Array.from({ length: COLUMNS_MAX - COLUMNS_MIN + 1 }, (_, index) => (
          <span
            key={index}
            aria-hidden
            className={cn(
              "pointer-events-none absolute top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full",
              index + COLUMNS_MIN <= size ? "bg-gold" : "bg-faint/70"
            )}
            style={{ left: `${(index / (COLUMNS_MAX - COLUMNS_MIN)) * 100}%` }}
          />
        ))}
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-gold bg-surface-raised shadow-sm"
          style={{ left: `${percent}%` }}
        />
        <input
          type="range"
          min={COLUMNS_MIN}
          max={COLUMNS_MAX}
          step={1}
          value={size}
          onChange={(event) => onChange(COLUMNS_MAX + COLUMNS_MIN - Number(event.target.value))}
          aria-label="Photo size"
          title={`${columns} per row`}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </div>
      <button type="button" onClick={() => step(1)} aria-label="Bigger photos" title="Bigger photos" className="hover:text-cream">
        <ZoomIn size={11} />
      </button>
    </div>
  );
}

/** Which tools' pictures, as a checklist — the phone's form of the sidebar's folders. Nothing ticked is all of them. */
function ToolSelect({
  section,
  tools,
  selected,
  onChange,
}: {
  section: LibrarySection;
  tools: string[];
  selected: string[];
  onChange: (tools: string[]) => void;
}) {
  const toggle = (tool: string) =>
    onChange(selected.includes(tool) ? selected.filter((t) => t !== tool) : [...selected, tool]);
  const summary =
    selected.length === 0
      ? `All ${section}`
      : selected.length === 1
        ? TOOL_LABELS[selected[0]] ?? selected[0]
        : `${selected.length} tools`;

  return (
    <ChecklistDropdown
      label="Which tools"
      icon={selected.length === 1 && <ToolDot tool={selected[0]} />}
      summary={summary}
      triggerClassName="px-2"
      panelClassName="left-0 w-52"
    >
      <div className="flex items-center gap-2 border-b border-white/5 px-3 py-1.5">
        <span className="flex-1 text-[10px] text-faint">{selected.length ? `${selected.length} selected` : "All tools"}</span>
        {selected.length > 0 && (
          <button type="button" onClick={() => onChange([])} className="shrink-0 text-[11px] font-medium text-gold hover:text-cream">
            Clear
          </button>
        )}
      </div>
      <div className="thin-scrollbar max-h-64 overflow-y-auto py-1">
        {tools.length === 0 && <p className="px-3 py-1.5 text-[11px] text-faint">Nothing yet</p>}
        {tools.map((tool) => (
          <label key={tool} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-cream hover:bg-white/[0.05]">
            <input
              type="checkbox"
              checked={selected.includes(tool)}
              onChange={() => toggle(tool)}
              style={{ accentColor: "var(--color-gold)" }}
            />
            <ToolDot tool={tool} />
            <span className="truncate">{TOOL_LABELS[tool] ?? tool}</span>
          </label>
        ))}
      </div>
    </ChecklistDropdown>
  );
}

/**
 * What ToolSelect and PersonSelect share: a trigger summing up what is ticked,
 * and the checklist panel under it.
 *
 * Closes on `pointerdown` outside rather than through `useDismissable`, which
 * listens for `mousedown`: on a phone — where these two live — a touch that
 * starts a scroll elsewhere fires no `mousedown`, and would leave it open.
 * Escape needs nothing here: it closes the whole dialog.
 */
function ChecklistDropdown({
  label,
  icon,
  summary,
  triggerClassName,
  panelClassName,
  children,
}: {
  /** The trigger's accessible name. */
  label: string;
  icon: ReactNode;
  summary: string;
  /** The trigger's horizontal padding. */
  triggerClassName: string;
  /** Which edge the panel hangs from, and its width. */
  panelClassName: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Closes on a click anywhere outside it.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={label}
        className={cn(
          "flex min-h-8 w-full items-center gap-1.5 rounded-lg border border-white/[0.1] bg-white/[0.03] text-xs text-muted transition-colors hover:border-white/20",
          triggerClassName
        )}
      >
        {icon}
        <span className="min-w-0 flex-1 truncate text-left font-medium text-cream">{summary}</span>
        <ChevronDown size={12} className="shrink-0" />
      </button>

      {open && (
        <div
          role="listbox"
          aria-multiselectable="true"
          className={cn(
            "absolute top-full z-50 mt-1.5 overflow-hidden rounded-lg border border-white/10 bg-surface-raised shadow-lg",
            panelClassName
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function ToolDot({ tool }: { tool: string }) {
  return <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: toolBadgeStyle(tool).color }} />;
}

function FolderButton({
  active,
  tool,
  onClick,
  children,
}: {
  active: boolean;
  tool?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active || undefined}
      className={cn(
        "flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1.5 text-left text-[11px] transition-colors",
        active ? "bg-gold/10 font-medium text-gold" : "text-muted hover:bg-white/[0.05] hover:text-cream"
      )}
    >
      {tool && <ToolDot tool={tool} />}
      <span className="min-w-0 truncate">{children}</span>
    </button>
  );
}

/**
 * Whose pictures, as History's member filter does it: a searchable checklist
 * with the viewer pinned first as "Myself". Nothing ticked is the viewer's own.
 */
function PersonSelect({
  view,
  members,
  selfName,
  onChange,
}: {
  view: View;
  members: Member[];
  selfName?: string;
  onChange: (patch: Partial<View>) => void;
}) {
  const [query, setQuery] = useState("");

  const selected = view.people;
  const set = (people: string[]) => onChange({ people, tools: [] });
  const toggle = (id: string) => set(selected.includes(id) ? selected.filter((v) => v !== id) : [...selected, id]);

  const others = selected.filter((id) => id !== "me");
  const summary =
    others.length === 0
      ? "Just me"
      : selected.length === 1
        ? members.find((member) => member.id === others[0])?.name ?? "1 person"
        : `${selected.length} people`;

  const needle = query.trim().toLowerCase();
  const listed = members.filter((member) => !needle || member.name.toLowerCase().includes(needle));
  const showSelf = !needle || "myself".includes(needle) || (selfName ?? "").toLowerCase().includes(needle);
  const allIds = ["me", ...members.map((member) => member.id)];

  return (
    <ChecklistDropdown
      label="Whose pictures"
      icon={<Users size={12} className="shrink-0" />}
      summary={summary}
      triggerClassName="px-2.5"
      panelClassName="right-0 w-56"
    >
      <div className="flex items-center gap-2 border-b border-white/5 px-3 py-1.5">
        <Search size={12} className="shrink-0 text-faint" />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search members…"
          aria-label="Search members"
          className="min-w-0 flex-1 bg-transparent text-xs text-cream outline-none placeholder:text-faint"
        />
        {selected.length > 0 ? (
          <button type="button" onClick={() => set([])} className="shrink-0 text-[11px] font-medium text-gold hover:text-cream">
            Clear
          </button>
        ) : (
          members.length > 0 && (
            <button type="button" onClick={() => set(allIds)} className="shrink-0 text-[11px] font-medium text-gold hover:text-cream">
              All
            </button>
          )
        )}
      </div>
      <div className="thin-scrollbar max-h-64 overflow-y-auto py-1">
        {showSelf && (
          <label className="flex cursor-pointer items-center gap-2 border-b border-white/5 px-3 py-1.5 text-xs font-medium text-cream hover:bg-white/[0.05]">
            <input
              type="checkbox"
              checked={selected.includes("me")}
              onChange={() => toggle("me")}
              style={{ accentColor: "var(--color-gold)" }}
            />
            <span className="truncate">Myself</span>
            {selfName && <span className="truncate text-[10px] font-normal text-faint">{selfName}</span>}
          </label>
        )}
        {listed.length === 0 && !showSelf && <p className="px-3 py-1.5 text-[11px] text-faint">No matches</p>}
        {listed.map((member) => (
          <label
            key={member.id}
            className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-cream hover:bg-white/[0.05]"
          >
            <input
              type="checkbox"
              checked={selected.includes(member.id)}
              onChange={() => toggle(member.id)}
              style={{ accentColor: "var(--color-gold)" }}
            />
            <span className="truncate">{member.name}</span>
          </label>
        ))}
      </div>
    </ChecklistDropdown>
  );
}

function Notice({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) {
  return (
    <div className="flex h-full min-h-48 flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <ImageOff size={20} className="text-faint" />
      <p className="text-xs font-medium text-cream">{title}</p>
      {detail && <p className="max-w-xs text-[11px] text-faint">{detail}</p>}
      {action}
    </div>
  );
}
