"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, Building2, CheckCircle2, ChevronDown, ListFilter, Loader2, Search, CalendarRange, SlidersHorizontal, UserRound, X } from "lucide-react";
import {
  listAuditLog,
  getAuditFacets,
  getAuditEntryDetail,
  type AuditEntry,
  type AuditFacets,
  type AuditQuery,
} from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/permissions";
import { useDismissable } from "@/lib/useEscapeKey";
import { HEAD_ROW } from "@/components/admin/table";
import { ToolAccessNotice } from "@/components/studio/ToolAccessNotice";
import { cn } from "@/lib/utils";

const PERMISSION = "org.audit.read";

const FIELD =
  "w-full rounded-lg border border-white/10 bg-white/[0.06] px-2.5 py-1.5 text-[11px] text-cream placeholder:text-faint outline-none focus:border-gold/40";

/**
 * Tighter than the console's shared `CELL`, which is sized for tables of a
 * dozen rows. An audit log is read fifty rows at a time, so the row height
 * decides how much history fits on one screen.
 */
const ROW_CELL = "px-3 py-1.5 text-[12px]";

/**
 * A pinned column header.
 *
 * Sticky sits on each `th`, not on the `thead`: a sticky `thead` is honoured
 * inconsistently and, where it is, its background does not reliably paint â€”
 * rows showed straight through the column names. A cell is a normal box and
 * behaves.
 *
 * The fill must be fully opaque for the same reason, so it deliberately does
 * not reuse HEAD_ROW's translucent `bg-surface-float/60`. The inset shadow is
 * the header's own bottom edge: the frame's border scrolls away underneath it.
 */
const STICKY_HEAD = cn(
  ROW_CELL,
  "sticky top-0 z-10 bg-surface-float shadow-[inset_0_-1px_0_rgba(255,255,255,0.10)]"
);

/** A square icon-only control in the filter bar â€” the mobile form of a field. */
const ICON_BUTTON =
  "relative flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] text-muted transition-colors hover:border-white/[0.18] hover:text-cream";

/** The dot on an icon button saying a hidden filter is set. */
function ActiveDot() {
  return (
    <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-surface-raised bg-gold" />
  );
}

/** How long typing pauses before a search fires, in ms. */
const SEARCH_DEBOUNCE = 350;

/** A row's heavy half, once fetched. `failed` stands in for "we tried and couldn't". */
type AuditDetail = {
  metadata: Record<string, unknown>;
  userAgent: string | null;
  failed?: boolean;
};

/** The two outcomes, as the checklist's option shape. */
const OUTCOMES = [
  { id: "success", name: "Success" },
  { id: "failure", name: "Failure" },
];

/**
 * `auth.login_success` â†’ "Login success". The action strings are a stable
 * wire format and read badly in a table; this makes them readable without a
 * hand-kept label map that would fall behind every action added.
 */
function humanizeAction(action: string) {
  const [, ...rest] = action.split(".");
  const tail = (rest.length ? rest.join(" ") : action).replace(/_/g, " ");
  return tail.charAt(0).toUpperCase() + tail.slice(1);
}

/** The area an action belongs to â€” `auth.login_success` â†’ "auth". */
const areaOf = (action: string) => action.split(".")[0];

/** `jobType` / `job_type` / `before.creditsPerUnit` â†’ "Job type" / "Before Â· credits per unit". */
function humanizeKey(key: string) {
  const words = key
    .split(".")
    .map((part) =>
      part
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/_/g, " ")
        .toLowerCase()
    )
    .join(" Â· ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * One displayable value.
 *
 * `metadata` is a free-form bag whose shape varies per action, so this has to
 * cope with whatever a logging call put there rather than a known schema.
 * Booleans read as Yes/No because "false" in a table is easily misread as a
 * missing value, and an empty array reads as an em dash for the same reason.
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "â€”";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length ? value.map(formatValue).join(", ") : "â€”";
  // A timestamp inside metadata (dataScope.grantedAt, and anything logged
  // later) should read the same way as the When column rather than as a raw
  // ISO string. Matched strictly so an id or a model name that happens to
  // contain digits is never mistaken for a date.
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/.test(value)) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return formatWhen(value);
  }
  return String(value);
}

/**
 * The metadata bag as flat label/value pairs, so it can be laid out as a
 * definition list instead of dumped as JSON.
 *
 * Nested objects are flattened onto dotted keys rather than rendered as
 * nested blocks: the only nesting that actually occurs is one level deep
 * (a pricing rule's `before`/`after`), and "Before Â· credits per unit" reads
 * better in a two-column grid than an indented sub-table would.
 *
 * Nulls are kept rather than dropped â€” for an audit record, "this field was
 * explicitly empty" is information, not noise.
 */
function flattenMetadata(metadata: Record<string, unknown>, prefix = ""): [string, unknown][] {
  return Object.entries(metadata).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    const isPlainObject =
      typeof value === "object" && value !== null && !Array.isArray(value);

    return isPlainObject
      ? flattenMetadata(value as Record<string, unknown>, path)
      : [[path, value] as [string, unknown]];
  });
}

/** One label-above-value pair in the expanded row. */
function DetailField({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: unknown;
  wide?: boolean;
}) {
  return (
    <div className={cn("min-w-0", wide && "sm:col-span-2 lg:col-span-3")}>
      <dt className="text-[9px] font-semibold uppercase tracking-wide text-faint">{label}</dt>
      <dd className="mt-0.5 break-words text-[11px] text-muted">{formatValue(value)}</dd>
    </div>
  );
}

/**
 * "3m", "2h", "5d", then a date once it is older than a week.
 *
 * The exact stamp is still one hover away (see the row's `title`). Scanning a
 * log is about recency â€” "was that just now or last Tuesday?" â€” and a column
 * of identical-looking full dates answers that far more slowly than this.
 */
function formatRelative(iso: string) {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "â€”";

  const seconds = Math.floor((Date.now() - then) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

  return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

function formatWhen(iso: string) {
  const date = new Date(iso);
  return date.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AuditLogPage() {
  const { user } = useAuth();

  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [facets, setFacets] = useState<AuditFacets | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  // â”€â”€ filters â”€â”€
  /*
   * Seeded from the URL, and written back to it as they change. A filtered
   * audit log is the thing people send each other — "look at what happened
   * here" — and without this the link only ever means "the audit log". It also
   * makes reload and the back button keep the view instead of resetting it.
   *
   * Read once, on mount: the URL is where a view is restored from, not a
   * second copy of the state to keep in step.
   */
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const [search, setSearch] = useState(() => params.get("q") ?? "");
  /** Mobile only: whether the search field has been expanded from its icon. */
  const [searchOpen, setSearchOpen] = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState(() => params.get("q") ?? "");
  const [actions, setActions] = useState<string[]>(() => params.getAll("action"));
  const [statuses, setStatuses] = useState<string[]>(() => params.getAll("status"));
  const [actorUserIds, setActorUserIds] = useState<string[]>(() => params.getAll("actor"));
  const [from, setFrom] = useState(() => params.get("from") ?? "");
  const [to, setTo] = useState(() => params.get("to") ?? "");
  // Super admin only: which organization, or all of them. The backend ignores
  // this from anyone else, so it is a view control here and not a permission.
  const [tenantIds, setTenantIds] = useState<string[]>(() => params.getAll("tenant"));

  const allowed = can(user, PERMISSION);

  // One search request per pause in typing, not one per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE);
    return () => clearTimeout(timer);
  }, [search]);

  /*
   * The filters, back into the address bar.
   *
   * `replace`, not `push`: typing into the search box would otherwise stack a
   * history entry per pause, and Back would walk through them one keystroke
   * at a time instead of leaving the page. `scroll: false` keeps the list
   * where it is — a filter changing is not a navigation to the top.
   *
   * Driven by the debounced search rather than the raw one, so the URL and
   * the request it describes are always the same view.
   */
  useEffect(() => {
    const next = new URLSearchParams();
    if (debouncedSearch.trim()) next.set("q", debouncedSearch.trim());
    actions.forEach((value) => next.append("action", value));
    statuses.forEach((value) => next.append("status", value));
    actorUserIds.forEach((value) => next.append("actor", value));
    tenantIds.forEach((value) => next.append("tenant", value));
    if (from) next.set("from", from);
    if (to) next.set("to", to);

    const query = next.toString();
    // Only when it actually differs, or this writes on every render.
    if (query === params.toString()) return;
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [debouncedSearch, actions, statuses, actorUserIds, tenantIds, from, to, params, pathname, router]);

  const query = useMemo<AuditQuery>(
    () => ({
      q: debouncedSearch.trim() || undefined,
      action: actions.length ? actions : undefined,
      status: statuses.length ? (statuses as ("success" | "failure")[]) : undefined,
      actorUserId: actorUserIds.length ? actorUserIds : undefined,
      from: from || undefined,
      // A bare date means the whole day, so the end of the range runs to the
      // last instant of it — without this, "to = today" would exclude
      // everything that happened today. A value carrying a time is already
      // exactly what was asked for and is sent unchanged.
      to: to ? (to.includes("T") ? to : `${to}T23:59:59.999`) : undefined,
      tenantId: tenantIds.length ? tenantIds : undefined,
    }),
    [debouncedSearch, actions, statuses, actorUserIds, from, to, tenantIds]
  );

  /*
   * Guards against a slow first page landing after a faster later one and
   * overwriting it â€” every filter change fires a new request, and they do not
   * come back in order.
   */
  const requestId = useRef(0);

  useEffect(() => {
    if (!allowed) return;
    const id = ++requestId.current;

    async function run() {
      setLoading(true);
      try {
        const result = await listAuditLog(query);
        // A newer filter already superseded this request.
        if (id !== requestId.current) return;
        if (result.status === "success") {
          setEntries(result.entries ?? []);
          setHasMore(Boolean(result.hasMore));
          setCursor(result.nextCursor ?? null);
          setError("");
        } else {
          setError(result.message || "Could not load the audit log");
        }
      } catch {
        if (id !== requestId.current) return;
        setError("Could not reach the server");
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    }

    run();
  }, [query, allowed]);

  useEffect(() => {
    if (!allowed) return;
    getAuditFacets()
      .then((result) => {
        if (result.status === "success") setFacets(result);
      })
      .catch(() => {
        /* The filters degrade to text search alone; not worth an error banner. */
      });
  }, [allowed]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    const id = requestId.current;
    try {
      const result = await listAuditLog({ ...query, before: cursor });
      // A filter changed while this page was in flight â€” its rows belong to a
      // query nobody is looking at any more.
      if (id !== requestId.current) return;
      if (result.status === "success") {
        setEntries((current) => [...current, ...(result.entries ?? [])]);
        setHasMore(Boolean(result.hasMore));
        setCursor(result.nextCursor ?? null);
      }
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore, query]);

  /*
   * Loads the next page as the end of the list comes into view.
   *
   * `rootMargin` fires it roughly a screen early — enough that the rows are
   * usually there by the time scrolling reaches them, and not so early that
   * someone who stops after the first screen has silently pulled three more.
   * The scroller is the root, not the viewport: the list scrolls inside its
   * own frame, so against the viewport the sentinel would count as visible
   * from the moment the page rendered.
   */
  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) loadMore();
      },
      { root: scrollerRef.current, rootMargin: "400px" }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  /**
   * The phone's one icon stands for every field, so its badge counts them all.
   * From sm up each filter carries its own dot instead.
   */
  const mobileFilterCount =
    (statuses.length ? 1 : 0) +
    (from ? 1 : 0) +
    (to ? 1 : 0) +
    (actorUserIds.length ? 1 : 0) +
    (tenantIds.length ? 1 : 0);

  const activeFilters =
    (debouncedSearch ? 1 : 0) + (actions.length ? 1 : 0) + mobileFilterCount;

  function clearFilters() {
    setSearch("");
    // Collapse the phone's search field too â€” leaving an empty box open
    // after "Clear" reads as though the reset only half-worked.
    setSearchOpen(false);
    setActions([]);
    setStatuses([]);
    setActorUserIds([]);
    setFrom("");
    setTo("");
    setTenantIds([]);
  }

  if (!allowed) return <ToolAccessNotice tool="Audit Log" />;

  /*
   * The page itself does not scroll â€” `overflow-hidden` here and a single
   * scrolling region around the rows further down. That is what lets the
   * filter bar and the column headers stay put while only the data moves;
   * with the page scrolling instead, both would slide away at the first
   * flick and a fifty-row log would spend most of its time headerless.
   *
   * `min-h-0` on the inner column is load-bearing: a flex child defaults to
   * min-height:auto, which refuses to shrink below its content, so the table
   * would grow the page and scroll the whole thing anyway.
   */
  return (
    <div className="flex h-full flex-col overflow-hidden px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto flex min-h-0 w-full max-w-[1400px] flex-1 flex-col gap-3">
        {error && (
          <p className="shrink-0 rounded-lg border border-error/20 bg-error/[0.08] px-3 py-2 text-xs text-error">
            {error}
          </p>
        )}

        {/*
         * One wrapping toolbar rather than a fixed six-column grid: the grid
         * gave every control an equal share, which left the date pair too
         * narrow to show both inputs and pushed the second one off the edge.
         * Here each control takes the width it actually needs and the row
         * wraps when the pane is small.
         */}
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 rounded-xl border border-white/10 bg-surface-raised/60 p-1.5">
          {/* Search is a field from sm up. On a phone it starts as an icon and
              expands on tap: a permanent text box was taking the whole first
              row on its own. */}
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label="Search"
            title="Search"
            className={cn(ICON_BUTTON, "sm:hidden", searchOpen && "hidden")}
          >
            <Search size={13} />
          </button>

          <div
            className={cn(
              "relative min-w-[140px] flex-1",
              !searchOpen && "hidden sm:block"
            )}
          >
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-faint" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search"
              className={cn(FIELD, "pl-7", searchOpen && "pr-7")}
            />
            {searchOpen && (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setSearchOpen(false);
                }}
                aria-label="Close search"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-faint transition-colors hover:text-cream sm:hidden"
              >
                <X size={12} />
              </button>
            )}
          </div>

          <ActionFilter
            options={facets?.actions ?? []}
            selected={actions}
            onChange={setActions}
          />

          {/* From sm up the three remaining filters sit in the bar. Below it
          {/* Every filter sits in the bar from sm up, each reduced to an icon.
              Below it they move behind one icon — six controls across a 375px
              screen wrapped to four rows, which pushed the table off the fold. */}
          <div className="hidden items-center gap-1.5 sm:flex">
            <FilterFields
              actors={facets?.actors ?? []}
              actorUserIds={actorUserIds}
              setActorUserIds={setActorUserIds}
              statuses={statuses}
              setStatuses={setStatuses}
              from={from}
              setFrom={setFrom}
              to={to}
              setTo={setTo}
              tenants={facets?.tenants}
              tenantIds={tenantIds}
              setTenantIds={setTenantIds}
            />
          </div>

          <MoreFilters activeCount={mobileFilterCount} className="sm:hidden">
            <FilterFields
              stacked
              actors={facets?.actors ?? []}
              actorUserIds={actorUserIds}
              setActorUserIds={setActorUserIds}
              statuses={statuses}
              setStatuses={setStatuses}
              from={from}
              setFrom={setFrom}
              to={to}
              setTo={setTo}
              tenants={facets?.tenants}
              tenantIds={tenantIds}
              setTenantIds={setTenantIds}
            />
          </MoreFilters>
          {/* Pushed to the far end, so the count and the reset sit together
              in the bar instead of costing a row of their own. */}
          <span className="ml-auto whitespace-nowrap px-1 text-[11px] text-faint">
            {loading ? "Loading.." : `${entries.length}${hasMore ? "+" : ""} entries`}
          </span>

          {activeFilters > 0 && (
            <button
              onClick={clearFilters}
              aria-label={`Clear ${activeFilters} filter${activeFilters === 1 ? "" : "s"}`}
              title={`Clear ${activeFilters} filter${activeFilters === 1 ? "" : "s"}`}
              className={ICON_BUTTON}
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* â”€â”€ table â”€â”€ */}
        {loading && entries.length === 0 ? (
          <TableSkeleton />
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted">
            {activeFilters > 0 ? "Nothing matches those filters." : "No activity recorded yet."}
          </p>
        ) : (
          <>
            {/* The one scrolling region on the page. */}
            <div
              ref={scrollerRef}
              className="min-h-0 flex-1 overflow-auto rounded-xl border border-white/10 bg-surface-raised/60"
            >
              {/* 460 rather than 900: with the tighter cells and a relative
                  timestamp the columns fit the pane without a horizontal
                  scrollbar, which was hiding the IP column entirely. */}
              <table className="w-full min-w-[460px] border-collapse">
                <thead>
                  <tr className={HEAD_ROW}>
                    {/* Below lg the time moves inside the Action cell rather
                        than holding a column of its own â€” see AuditRow. */}
                    <th className={cn(STICKY_HEAD, "hidden w-[92px] lg:table-cell")}>When</th>
                    <th className={cn(STICKY_HEAD, "w-[150px]")}>Action</th>
                    <th className={cn(STICKY_HEAD, "hidden w-[130px] md:table-cell")}>Who</th>
                    <th className={STICKY_HEAD}>What happened</th>
                    <th className={cn(STICKY_HEAD, "hidden w-[90px] lg:table-cell")}>IP</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <AuditRow
                      key={entry.id}
                      entry={entry}
                      expanded={expanded === entry.id}
                      onToggle={() =>
                        setExpanded((current) => (current === entry.id ? null : entry.id))
                      }
                    />
                  ))}
                </tbody>
              </table>

              {/* Inside the scroller, after the last row â€” it is the end of
                  the list, so it belongs where scrolling actually ends
                  rather than pinned under the frame. */}
              {hasMore && (
                <div
                  ref={sentinelRef}
                  className="flex w-full items-center justify-center gap-1.5 border-t border-white/5 px-3 py-3 text-[11px] text-faint"
                >
                  {loadingMore ? (
                    <>
                      <Loader2 size={12} className="animate-spin" /> Loading more…
                    </>
                  ) : (
                    // Visible when the observer has not fired yet, and the
                    // fallback if it never does.
                    <button onClick={loadMore} className="transition-colors hover:text-cream">
                      Load more
                    </button>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The table's shape while the first page loads.
 *
 * The frame, the column headers and a dozen row-shaped bars, rather than a
 * spinner on an empty pane: every filter change empties this area, and a page
 * that keeps its layout while the rows are replaced reads as the same page
 * responding instead of a new one being built.
 */
function TableSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading the audit log"
      className="min-h-0 flex-1 overflow-hidden rounded-xl border border-white/10 bg-surface-raised/60"
    >
      <table className="w-full min-w-[460px] border-collapse">
        <thead>
          <tr className={HEAD_ROW}>
            <th className={cn(STICKY_HEAD, "hidden w-[92px] lg:table-cell")}>When</th>
            <th className={cn(STICKY_HEAD, "w-[150px]")}>Action</th>
            <th className={cn(STICKY_HEAD, "hidden w-[130px] md:table-cell")}>Who</th>
            <th className={STICKY_HEAD}>What happened</th>
            <th className={cn(STICKY_HEAD, "hidden w-[90px] lg:table-cell")}>IP</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 12 }).map((_, row) => (
            <tr key={row} className="border-t border-white/5">
              {/* Widths vary a little per column so the block reads as text
                  waiting to arrive rather than a loading graphic. */}
              {["hidden w-[92px] lg:table-cell", "w-[150px]", "hidden md:table-cell", "", "hidden lg:table-cell"].map(
                (visibility, column) => (
                  <td key={column} className={cn(ROW_CELL, visibility)}>
                    <span
                      className="block h-3 animate-pulse rounded bg-white/[0.06]"
                      style={{ width: `${[70, 85, 75, 60 + ((row * 7) % 35), 50][column]}%` }}
                    />
                  </td>
                )
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One row, expandable to show the free-form `metadata` bag and user agent.
 *
 * Those two are wide and per-action, so putting them in columns would make
 * every row as tall as the worst case. Hidden until asked for keeps the table
 * scannable while still making the full record reachable.
 */
function AuditRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: AuditEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const failed = entry.status === "failure";
  const hasDetail = entry.hasDetail;

  /*
   * The metadata bag and user agent are not in the list response — they are
   * the widest part of a row and nobody sees them until this opens. Fetched
   * on first expand and kept, so collapsing and reopening costs nothing.
   */
  const [detail, setDetail] = useState<AuditDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  /*
   * Which row this component has already fetched for.
   *
   * A ref, not the `loadingDetail` flag, because "am I already fetching" must
   * not be a dependency of the effect doing the fetching: setting the flag
   * would re-run the effect, whose cleanup cancels the request it had just
   * started, and the panel would sit on "Loading details…" for ever.
   */
  const fetchedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!expanded || fetchedFor.current === entry.id) return;
    fetchedFor.current = entry.id;
    let cancelled = false;
    let landed = false;

    setLoadingDetail(true);
    getAuditEntryDetail(entry.id)
      .then((result) => {
        if (cancelled) return;
        landed = true;
        // A failure leaves the panel saying so rather than looking empty,
        // which would read as "this row has no detail".
        setDetail(
          result.status === "success"
            ? { metadata: result.metadata ?? {}, userAgent: result.userAgent ?? null }
            : { metadata: {}, userAgent: null, failed: true }
        );
      })
      .catch(() => {
        if (cancelled) return;
        landed = true;
        setDetail({ metadata: {}, userAgent: null, failed: true });
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });

    return () => {
      cancelled = true;
      // Abandoned before it landed, so the next expand should try again
      // rather than believing this row has already been fetched. A local
      // flag rather than reading `detail`, which would put state back in the
      // dependency list and start the same loop over again.
      if (!landed) fetchedFor.current = null;
    };
  }, [expanded, entry.id]);

  return (
    <>
      <tr
        onClick={hasDetail ? onToggle : undefined}
        className={cn(
          "border-t border-white/5 transition-colors",
          hasDetail && "cursor-pointer hover:bg-white/[0.03]"
        )}
      >
        {/* Relative by default with the exact stamp on hover: "2h ago" is
            what someone scanning a log actually wants, and it costs a third
            of the width of a full date. */}
        <td
          className={cn(ROW_CELL, "hidden whitespace-nowrap text-muted tabular-nums lg:table-cell")}
          title={formatWhen(entry.createdAt)}
        >
          {formatRelative(entry.createdAt)}
        </td>
        <td className={ROW_CELL}>
          <span className="flex items-center gap-1.5">
            {failed ? (
              <AlertCircle size={12} className="shrink-0 text-error" />
            ) : (
              <CheckCircle2 size={12} className="shrink-0 text-success" />
            )}
            <span className={cn("truncate font-medium", failed ? "text-error" : "text-cream")}>
              {humanizeAction(entry.action)}
            </span>
            <span className="shrink-0 rounded border border-white/10 px-1 py-px text-[9px] uppercase tracking-wide text-faint">
              {areaOf(entry.action)}
            </span>
            {/* Only a super admin is reading more than one organization, and
                only they are sent this â€” for everyone else every row would
                carry the same badge. A badge rather than a column, so the
                shared page keeps one table shape for both readers. */}
            {entry.tenant && (
              <span className="shrink-0 rounded border border-gold/20 bg-gold/[0.06] px-1 py-px text-[9px] uppercase tracking-wide text-gold/80">
                {entry.tenant}
              </span>
            )}
          </span>
          {/* Tablet and below: the When column is dropped and the time sits
              here instead. Stacking it under the action keeps the two facts
              that identify a row together, and buys the message the width
              the date column was using. */}
          <span
            className="mt-0.5 block whitespace-nowrap text-[10px] tabular-nums text-faint lg:hidden"
            title={formatWhen(entry.createdAt)}
          >
            {formatRelative(entry.createdAt)}
          </span>
        </td>
        {/* One line, with the email on hover â€” it was doubling every row's
            height to show something that is almost always redundant with
            the name beside it. */}
        <td
          className={cn(ROW_CELL, "hidden truncate text-muted md:table-cell")}
          title={entry.actor.email ?? undefined}
        >
          {entry.actor.name || entry.actor.email || <span className="text-faint">â€”</span>}
        </td>
        <td className={cn(ROW_CELL, "text-muted")}>
          {entry.message || <span className="text-faint">â€”</span>}
          {hasDetail && (
            <ChevronDown
              size={11}
              className={cn(
                "ml-1 inline shrink-0 text-faint transition-transform",
                expanded && "rotate-180"
              )}
            />
          )}
          {/* The Who column is dropped on a narrow screen to keep the message
              readable, so the actor rides along underneath instead of
              disappearing. */}
          <span className="block truncate text-[10px] text-faint md:hidden">
            {entry.actor.name || entry.actor.email || "â€”"}
          </span>
        </td>
        <td className={cn(ROW_CELL, "hidden whitespace-nowrap text-faint tabular-nums lg:table-cell")}>
          {entry.ip || "â€”"}
        </td>
      </tr>

      {expanded && hasDetail && (
        <tr className="border-t border-white/5">
          <td colSpan={5} className="bg-surface-deep/30 px-3 py-2.5">
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
              {entry.targetType && (
                <DetailField
                  label="Target"
                  value={entry.targetType + (entry.targetId ? ` Â· ${entry.targetId}` : "")}
                />
              )}
              {detail &&
                flattenMetadata(detail.metadata).map(([key, value]) => (
                  <DetailField key={key} label={humanizeKey(key)} value={value} />
                ))}
              {detail?.userAgent && <DetailField label="Agent" value={detail.userAgent} wide />}

              {loadingDetail && (
                <p className="flex items-center gap-1.5 text-[11px] text-faint sm:col-span-2 lg:col-span-3">
                  <Loader2 size={11} className="animate-spin" /> Loading details…
                </p>
              )}
              {detail?.failed && (
                <p className="text-[11px] text-error sm:col-span-2 lg:col-span-3">
                  Could not load the details for this entry.
                </p>
              )}
            </dl>
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * The filter fields, in whichever of the three places they are being shown.
 *
 * One component rather than copies of the markup: the same field renders in
 * the bar on a wide screen and in a popover on a phone, and a second copy
 * would be the thing that drifts when a filter is added. `stacked` is the
 * popover's full-width form.
 *
 * `include` splits them by how often they are reached for. Organization and
 * person are the cuts someone makes constantly, so they stay in the bar;
 * outcome and a date range are occasional, and six controls in one row left
 * the bar too dense to read â€” they moved behind the filter icon, which had
 * only existed on phones.
 */
function FilterFields({
  stacked = false,
  actors,
  actorUserIds,
  setActorUserIds,
  statuses,
  setStatuses,
  from,
  setFrom,
  to,
  setTo,
  tenants,
  tenantIds,
  setTenantIds,
}: {
  stacked?: boolean;
  actors: { id: string; name: string }[];
  actorUserIds: string[];
  setActorUserIds: (value: string[]) => void;
  statuses: string[];
  setStatuses: (value: string[]) => void;
  from: string;
  setFrom: (value: string) => void;
  to: string;
  setTo: (value: string) => void;
  /** Absent for an org user, whose rows are all one organization anyway. */
  tenants?: { id: string; name: string }[];
  tenantIds: string[];
  setTenantIds: (value: string[]) => void;
}) {
  return (
    <>
      {/* First, because it is the widest cut: choosing an organization changes
          what every other filter is choosing from. Rendered only when the
          server offered the list, which it does for a super admin alone. */}
      {tenants && tenants.length > 0 && (
        <ChecklistFilter
          options={tenants}
          selected={tenantIds}
          onChange={setTenantIds}
          name="organization"
          emptyLabel="All organizations"
          plural="organizations"
          icon={<Building2 size={13} />}
          stacked={stacked}
        />
      )}

      <ChecklistFilter
        options={actors}
        selected={actorUserIds}
        onChange={setActorUserIds}
        name="person"
        emptyLabel="Anyone"
        plural="people"
        icon={<UserRound size={13} />}
        stacked={stacked}
      />

      <ChecklistFilter
        options={OUTCOMES}
        selected={statuses}
        onChange={setStatuses}
        name="outcome"
        emptyLabel="Any outcome"
        plural="outcomes"
        icon={<CheckCircle2 size={13} />}
        stacked={stacked}
      />

      <DateRangeFilter from={from} setFrom={setFrom} to={to} setTo={setTo} stacked={stacked} />
    </>
  );
}

/** `2026-09-22T14:05` in the viewer's own clock, which is what the inputs take. */
function toLocalInput(date: Date, withTime: boolean) {
  const pad = (value: number) => String(value).padStart(2, "0");
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return withTime ? `${day}T${pad(date.getHours())}:${pad(date.getMinutes())}` : day;
}

/**
 * The ranges people actually ask for, as offsets back from now.
 *
 * Only a start: "the last 24 hours" has no end worth stating, and leaving `to`
 * empty means the range stays open as time passes rather than freezing at the
 * moment the button was pressed.
 */
const DATE_PRESETS = [
  { label: "24h", title: "The last 24 hours", hours: 24 },
  { label: "7d", title: "The last 7 days", hours: 24 * 7 },
  { label: "30d", title: "The last 30 days", hours: 24 * 30 },
];

/**
 * The date range, as one control.
 *
 * Two date inputs are 260px of bar for a filter that is usually empty, so here
 * it is an icon that opens them — the same trade every other filter in the bar
 * makes. In the phone's popover there is nothing to open into, so the inputs
 * are simply shown, stacked and labelled.
 *
 * Time is opt-in. Most questions asked of an audit log are about days, and a
 * required time field makes the common case slower to answer for the sake of
 * the rare one — so the inputs take dates until someone asks for the hour.
 */
function DateRangeFilter({
  from,
  setFrom,
  to,
  setTo,
  stacked = false,
}: {
  from: string;
  setFrom: (value: string) => void;
  to: string;
  setTo: (value: string) => void;
  stacked?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismissable(rootRef, open, close);

  // Opens showing whatever the current values carry, so reopening a range that
  // was set with times does not silently present itself as a date-only one.
  const [withTime, setWithTime] = useState(from.includes("T") || to.includes("T"));

  /**
   * Switching the inputs between dates and date-times has to rewrite the
   * values as well: `2026-09-22` is not a date-time an input will accept, and
   * `2026-09-22T14:05` is not a date, so either would silently blank itself.
   */
  function toggleTime(next: boolean) {
    setWithTime(next);
    const convert = (value: string) => {
      if (!value) return value;
      return next ? (value.includes("T") ? value : `${value}T00:00`) : value.split("T")[0];
    };
    setFrom(convert(from));
    setTo(convert(to));
  }

  function applyPreset(hours: number) {
    setFrom(toLocalInput(new Date(Date.now() - hours * 3600_000), withTime));
    // Left open rather than pinned to now, so "the last 7 days" keeps meaning
    // that a minute later.
    setTo("");
  }

  const fields = (
    <div className="w-full space-y-1.5">
      <div className="flex items-center gap-1">
        {DATE_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => applyPreset(preset.hours)}
            title={preset.title}
            className="flex-1 rounded-lg border border-white/10 bg-white/[0.03] px-1.5 py-1 text-[10px] font-medium text-muted transition-colors hover:border-white/20 hover:text-cream"
          >
            {preset.label}
          </button>
        ))}
      </div>

      {[
        { label: "From", value: from, onChange: setFrom },
        { label: "To", value: to, onChange: setTo },
      ].map((field) => (
        <label key={field.label} className="block space-y-0.5">
          <span className="text-[10px] uppercase tracking-widest text-faint">{field.label}</span>
          <input
            value={field.value}
            onChange={(event) => field.onChange(event.target.value)}
            type={withTime ? "datetime-local" : "date"}
            aria-label={`${field.label} ${withTime ? "date and time" : "date"}`}
            className={cn(FIELD, "w-full px-1.5")}
          />
        </label>
      ))}

      <label className="flex cursor-pointer items-center gap-1.5 pt-0.5 text-[10px] text-faint transition-colors hover:text-muted">
        <input
          type="checkbox"
          checked={withTime}
          onChange={(event) => toggleTime(event.target.checked)}
          className="accent-[var(--color-gold)]"
        />
        Include time
      </label>
    </div>
  );

  if (stacked) return fields;

  const set = Boolean(from || to);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Filter by date range"
        title={set ? `Dates: ${from || "any"} – ${to || "any"}` : "Filter by date range"}
        className={cn(ICON_BUTTON, open && "border-gold/30 text-cream")}
      >
        <CalendarRange size={13} />
        {set && <ActiveDot />}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-[210px] rounded-lg border border-white/10 bg-surface-raised p-2 shadow-lg">
          {fields}
        </div>
      )}
    </div>
  );
}

/** A filter icon, opening a panel of the fields it stands for. */
function MoreFilters({
  activeCount,
  className,
  align = "left",
  children,
}: {
  activeCount: number;
  className?: string;
  /**
   * Which edge the panel hangs from. The bar's own icon sits at its right
   * end, where a left-anchored panel runs off the screen and takes half the
   * date range with it.
   */
  align?: "left" | "right";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismissable(rootRef, open, close);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="More filters"
        title="More filters"
        className={cn(ICON_BUTTON, open && "border-gold/30 text-cream")}
      >
        <SlidersHorizontal size={13} />
        {activeCount > 0 && <ActiveDot />}
      </button>

      {open && (
        <div
          className={cn(
            "absolute top-full z-30 mt-1.5 w-[230px] space-y-2 rounded-lg border border-white/10 bg-surface-raised p-2 shadow-lg",
            align === "right" ? "right-0" : "left-0"
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * A checkbox list behind one control — person, organization, outcome.
 *
 * These were single `<select>`s, which could only ask about one value at a
 * time; "what did these two do", "how did these two organizations differ" and
 * "show me successes and failures of this action" all needed the filter run
 * twice and the results merged by eye. They are also now one component rather
 * than three near-identical ones, so the bar cannot drift into three slightly
 * different dropdowns again.
 *
 * `icon` is the bar's compact form; `stacked` is the popover's labelled one.
 */
function ChecklistFilter({
  options,
  selected,
  onChange,
  name,
  emptyLabel,
  plural,
  icon,
  stacked = false,
}: {
  options: { id: string; name: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** What this filters, for the accessible name: "person", "organization". */
  name: string;
  /** The label when nothing is picked — "Anyone", "All organizations". */
  emptyLabel: string;
  /** Counting noun for 2+: "people", "organizations". */
  plural: string;
  icon: ReactNode;
  stacked?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismissable(rootRef, open, close);

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]);
  }

  // One name is worth showing; more than one is not worth the width.
  const label =
    selected.length === 0
      ? emptyLabel
      : selected.length === 1
        ? options.find((option) => option.id === selected[0])?.name ?? `1 ${name}`
        : `${selected.length} ${plural}`;

  return (
    <div ref={rootRef} className={cn("relative", stacked && "w-full")}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={options.length === 0}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Filter by ${name}`}
        // Says what is picked, since the icon form shows no label of its own.
        title={selected.length === 0 ? `Filter by ${name}` : `Filter by ${name}: ${label}`}
        className={cn(
          // An icon in the bar, a labelled field in the popover. The bar had
          // four labelled controls competing for its width, and the icons say
          // the same thing in a quarter of it.
          stacked
            ? cn(FIELD, "flex w-full items-center justify-between gap-1 disabled:opacity-50")
            : cn(ICON_BUTTON, "disabled:opacity-50"),
          open && "border-gold/30 text-cream"
        )}
      >
        {stacked ? (
          <>
            <span className="truncate">{label}</span>
            <ChevronDown size={12} className={cn("shrink-0 text-faint transition-transform", open && "rotate-180")} />
          </>
        ) : (
          <>
            {icon}
            {selected.length > 0 && <ActiveDot />}
          </>
        )}
      </button>

      {open && (
        <div
          role="listbox"
          className={cn(
            "absolute top-full z-30 mt-1 max-h-72 w-56 overflow-y-auto rounded-lg border border-white/10 bg-surface-raised py-1 shadow-lg",
            // The bar's icons sit at its right end, where a left-anchored
            // panel runs off the screen. Inside the popover there is nothing
            // to the right to run into.
            stacked ? "left-0" : "right-0"
          )}
        >
          {selected.length > 0 && (
            <button
              onClick={() => onChange([])}
              className="w-full px-2.5 py-1.5 text-left text-[10px] uppercase tracking-wide text-faint transition-colors hover:bg-white/[0.06] hover:text-cream"
            >
              Clear selection
            </button>
          )}
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-selected={selected.includes(option.id)}
              onClick={() => toggle(option.id)}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] text-cream transition-colors hover:bg-white/[0.06]"
            >
              <input
                type="checkbox"
                readOnly
                checked={selected.includes(option.id)}
                className="pointer-events-none accent-[var(--color-gold)]"
              />
              <span className="truncate">{option.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Multi-select for actions, grouped by area.
 *
 * A plain `<select multiple>` is unusable at this length, and a single-select
 * would not answer "show me every auth failure and every forced logout" â€”
 * which is the question this page exists for.
 */
function ActionFilter({
  options,
  selected,
  onChange,
}: {
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismissable(rootRef, open, close);

  const grouped = useMemo(() => {
    const map = new Map<string, string[]>();
    options.forEach((action) => {
      const area = areaOf(action);
      map.set(area, [...(map.get(area) ?? []), action]);
    });
    return [...map.entries()];
  }, [options]);

  function toggle(action: string) {
    onChange(
      selected.includes(action) ? selected.filter((a) => a !== action) : [...selected, action]
    );
  }

  return (
    <div ref={rootRef} className="relative">
      {/* Icon-only on a phone, a labelled field from sm up â€” the same
          control, sized to the space it has. */}
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={options.length === 0}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Filter by action"
        title="Filter by action"
        className={cn(
          ICON_BUTTON,
          "sm:h-auto sm:w-auto sm:justify-between sm:gap-1 sm:px-2.5 sm:py-1.5 sm:text-[11px] sm:text-cream",
          "disabled:opacity-50",
          open && "border-gold/30 text-cream"
        )}
      >
        <ListFilter size={13} className="sm:hidden" />
        {selected.length > 0 && <ActiveDot />}

        <span className="hidden truncate sm:inline">
          {selected.length === 0 ? "Any action" : `${selected.length} action${selected.length === 1 ? "" : "s"}`}
        </span>
        <ChevronDown
          size={12}
          className={cn("hidden shrink-0 text-faint transition-transform sm:block", open && "rotate-180")}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-full z-30 mt-1 max-h-72 w-64 overflow-y-auto rounded-lg border border-white/10 bg-surface-raised py-1 shadow-lg"
        >
          {selected.length > 0 && (
            <button
              onClick={() => onChange([])}
              className="w-full px-2.5 py-1.5 text-left text-[10px] uppercase tracking-wide text-faint transition-colors hover:bg-white/[0.06] hover:text-cream"
            >
              Clear selection
            </button>
          )}
          {grouped.map(([area, list]) => (
            <div key={area}>
              <p className="px-2.5 pb-0.5 pt-1.5 text-[9px] font-semibold uppercase tracking-wide text-faint">
                {area}
              </p>
              {list.map((action) => (
                <button
                  key={action}
                  type="button"
                  role="option"
                  aria-selected={selected.includes(action)}
                  onClick={() => toggle(action)}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] text-cream transition-colors hover:bg-white/[0.06]"
                >
                  <input
                    type="checkbox"
                    readOnly
                    checked={selected.includes(action)}
                    className="pointer-events-none accent-[var(--color-gold)]"
                  />
                  {humanizeAction(action)}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


