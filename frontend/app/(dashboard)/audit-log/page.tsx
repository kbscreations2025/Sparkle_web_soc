"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ListFilter,
  Loader2,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  listAuditLog,
  getAuditFacets,
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
 * inconsistently and, where it is, its background does not reliably paint —
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

/** A square icon-only control in the filter bar — the mobile form of a field. */
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

/**
 * `auth.login_success` → "Login success". The action strings are a stable
 * wire format and read badly in a table; this makes them readable without a
 * hand-kept label map that would fall behind every action added.
 */
function humanizeAction(action: string) {
  const [, ...rest] = action.split(".");
  const tail = (rest.length ? rest.join(" ") : action).replace(/_/g, " ");
  return tail.charAt(0).toUpperCase() + tail.slice(1);
}

/** The area an action belongs to — `auth.login_success` → "auth". */
const areaOf = (action: string) => action.split(".")[0];

/** `jobType` / `job_type` / `before.creditsPerUnit` → "Job type" / "Before · credits per unit". */
function humanizeKey(key: string) {
  const words = key
    .split(".")
    .map((part) =>
      part
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/_/g, " ")
        .toLowerCase()
    )
    .join(" · ");
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
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length ? value.map(formatValue).join(", ") : "—";
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
 * (a pricing rule's `before`/`after`), and "Before · credits per unit" reads
 * better in a two-column grid than an indented sub-table would.
 *
 * Nulls are kept rather than dropped — for an audit record, "this field was
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
 * log is about recency — "was that just now or last Tuesday?" — and a column
 * of identical-looking full dates answers that far more slowly than this.
 */
function formatRelative(iso: string) {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";

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

  // ── filters ──
  const [search, setSearch] = useState("");
  /** Mobile only: whether the search field has been expanded from its icon. */
  const [searchOpen, setSearchOpen] = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [actions, setActions] = useState<string[]>([]);
  const [status, setStatus] = useState<"" | "success" | "failure">("");
  const [actorUserId, setActorUserId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const allowed = can(user, PERMISSION);

  // One search request per pause in typing, not one per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE);
    return () => clearTimeout(timer);
  }, [search]);

  const query = useMemo<AuditQuery>(
    () => ({
      q: debouncedSearch.trim() || undefined,
      action: actions.length ? actions : undefined,
      status: status || undefined,
      actorUserId: actorUserId || undefined,
      from: from || undefined,
      // A date input gives midnight; without this, "to = today" would exclude
      // everything that happened today.
      to: to ? `${to}T23:59:59.999` : undefined,
    }),
    [debouncedSearch, actions, status, actorUserId, from, to]
  );

  /*
   * Guards against a slow first page landing after a faster later one and
   * overwriting it — every filter change fires a new request, and they do not
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
      // A filter changed while this page was in flight — its rows belong to a
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

  /** Only the ones hidden behind the mobile popover, for its badge. */
  const mobileFilterCount =
    (status ? 1 : 0) + (actorUserId ? 1 : 0) + (from ? 1 : 0) + (to ? 1 : 0);

  const activeFilters =
    (debouncedSearch ? 1 : 0) + (actions.length ? 1 : 0) + mobileFilterCount;

  function clearFilters() {
    setSearch("");
    // Collapse the phone's search field too — leaving an empty box open
    // after "Clear" reads as though the reset only half-worked.
    setSearchOpen(false);
    setActions([]);
    setStatus("");
    setActorUserId("");
    setFrom("");
    setTo("");
  }

  if (!allowed) return <ToolAccessNotice tool="Audit Log" />;

  /*
   * The page itself does not scroll — `overflow-hidden` here and a single
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
              placeholder="Search…"
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
              they move behind one icon — six controls across a 375px screen
              wrapped to four rows, which pushed the table off the fold. */}
          <div className="hidden items-center gap-1.5 sm:flex">
            <FilterFields
              actors={facets?.actors ?? []}
              actorUserId={actorUserId}
              setActorUserId={setActorUserId}
              status={status}
              setStatus={setStatus}
              from={from}
              setFrom={setFrom}
              to={to}
              setTo={setTo}
            />
          </div>

          <MoreFilters activeCount={mobileFilterCount} className="sm:hidden">
            <FilterFields
              stacked
              actors={facets?.actors ?? []}
              actorUserId={actorUserId}
              setActorUserId={setActorUserId}
              status={status}
              setStatus={setStatus}
              from={from}
              setFrom={setFrom}
              to={to}
              setTo={setTo}
            />
          </MoreFilters>

          {/* Pushed to the far end, so the count and the reset sit together
              in the bar instead of costing a row of their own. */}
          <span className="ml-auto whitespace-nowrap px-1 text-[11px] text-faint">
            {loading ? "Loading…" : `${entries.length}${hasMore ? "+" : ""} entries`}
          </span>

          {activeFilters > 0 && (
            <button
              onClick={clearFilters}
              title={`Clear ${activeFilters} filter${activeFilters === 1 ? "" : "s"}`}
              className="flex shrink-0 items-center gap-1 rounded-lg border border-white/10 px-2 py-1.5 text-[11px] text-muted transition-colors hover:bg-white/[0.06] hover:text-cream"
            >
              <X size={11} /> Clear
            </button>
          )}
        </div>

        {/* ── table ── */}
        {loading && entries.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-faint">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted">
            {activeFilters > 0 ? "Nothing matches those filters." : "No activity recorded yet."}
          </p>
        ) : (
          <>
            {/* The one scrolling region on the page. */}
            <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-white/10 bg-surface-raised/60">
              {/* 460 rather than 900: with the tighter cells and a relative
                  timestamp the columns fit the pane without a horizontal
                  scrollbar, which was hiding the IP column entirely. */}
              <table className="w-full min-w-[460px] border-collapse">
                <thead>
                  <tr className={HEAD_ROW}>
                    {/* Below lg the time moves inside the Action cell rather
                        than holding a column of its own — see AuditRow. */}
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

              {/* Inside the scroller, after the last row — it is the end of
                  the list, so it belongs where scrolling actually ends
                  rather than pinned under the frame. */}
              {hasMore && (
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="flex w-full items-center justify-center gap-1.5 border-t border-white/5 px-3 py-2 text-[11px] font-medium text-muted transition-colors hover:bg-white/[0.05] hover:text-cream disabled:opacity-50"
                >
                  {loadingMore && <Loader2 size={12} className="animate-spin" />}
                  Load more
                </button>
              )}
            </div>
          </>
        )}
      </div>
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
  const hasDetail = Object.keys(entry.metadata).length > 0 || Boolean(entry.userAgent);

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
        {/* One line, with the email on hover — it was doubling every row's
            height to show something that is almost always redundant with
            the name beside it. */}
        <td
          className={cn(ROW_CELL, "hidden truncate text-muted md:table-cell")}
          title={entry.actor.email ?? undefined}
        >
          {entry.actor.name || entry.actor.email || <span className="text-faint">—</span>}
        </td>
        <td className={cn(ROW_CELL, "text-muted")}>
          {entry.message || <span className="text-faint">—</span>}
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
            {entry.actor.name || entry.actor.email || "—"}
          </span>
        </td>
        <td className={cn(ROW_CELL, "hidden whitespace-nowrap text-faint tabular-nums lg:table-cell")}>
          {entry.ip || "—"}
        </td>
      </tr>

      {expanded && hasDetail && (
        <tr className="border-t border-white/5">
          <td colSpan={5} className="bg-surface-deep/30 px-3 py-2.5">
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
              {entry.targetType && (
                <DetailField
                  label="Target"
                  value={entry.targetType + (entry.targetId ? ` · ${entry.targetId}` : "")}
                />
              )}
              {flattenMetadata(entry.metadata).map(([key, value]) => (
                <DetailField key={key} label={humanizeKey(key)} value={value} />
              ))}
              {entry.userAgent && (
                <DetailField label="Agent" value={entry.userAgent} wide />
              )}
            </dl>
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Person, outcome and date range — the three filters that are inline on a
 * wide screen and inside the popover on a phone.
 *
 * One component used in both places rather than two copies of the markup:
 * they render at different breakpoints, so only one is ever visible, but a
 * second copy would be the thing that drifts when a filter is added.
 * `stacked` is the popover's full-width form.
 */
function FilterFields({
  stacked = false,
  actors,
  actorUserId,
  setActorUserId,
  status,
  setStatus,
  from,
  setFrom,
  to,
  setTo,
}: {
  stacked?: boolean;
  actors: { id: string; name: string }[];
  actorUserId: string;
  setActorUserId: (value: string) => void;
  status: "" | "success" | "failure";
  setStatus: (value: "" | "success" | "failure") => void;
  from: string;
  setFrom: (value: string) => void;
  to: string;
  setTo: (value: string) => void;
}) {
  return (
    <>
      <select
        value={actorUserId}
        onChange={(event) => setActorUserId(event.target.value)}
        aria-label="Filter by person"
        className={cn(FIELD, stacked ? "w-full" : "w-[104px]")}
      >
        <option value="">Anyone</option>
        {actors.map((actor) => (
          <option key={actor.id} value={actor.id}>
            {actor.name}
          </option>
        ))}
      </select>

      <select
        value={status}
        onChange={(event) => setStatus(event.target.value as "" | "success" | "failure")}
        aria-label="Filter by outcome"
        className={cn(FIELD, stacked ? "w-full" : "w-[118px]")}
      >
        <option value="">Any outcome</option>
        <option value="success">Success</option>
        <option value="failure">Failure</option>
      </select>

      <div className={cn("flex items-center gap-1", stacked && "w-full")}>
        <input
          value={from}
          onChange={(event) => setFrom(event.target.value)}
          type="date"
          aria-label="From date"
          className={cn(FIELD, "px-1.5", stacked ? "w-full" : "w-[124px]")}
        />
        <span className="shrink-0 text-[10px] text-faint">–</span>
        <input
          value={to}
          onChange={(event) => setTo(event.target.value)}
          type="date"
          aria-label="To date"
          className={cn(FIELD, "px-1.5", stacked ? "w-full" : "w-[124px]")}
        />
      </div>
    </>
  );
}

/** The phone's one filter icon, opening a panel of the fields it stands for. */
function MoreFilters({
  activeCount,
  className,
  children,
}: {
  activeCount: number;
  className?: string;
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
        <div className="absolute left-0 top-full z-30 mt-1.5 w-[230px] space-y-2 rounded-lg border border-white/10 bg-surface-raised p-2 shadow-lg">
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * Multi-select for actions, grouped by area.
 *
 * A plain `<select multiple>` is unusable at this length, and a single-select
 * would not answer "show me every auth failure and every forced logout" —
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
      {/* Icon-only on a phone, a labelled field from sm up — the same
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
