"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarRange,
  ChevronDown,
  Film,
  Loader2,
  type LucideIcon,
  MoreHorizontal,
  Search,
  SlidersHorizontal,
  Users,
  X,
} from "lucide-react";
import { TOOLS } from "@/lib/nav";
import { KIT_LABEL } from "@/lib/marketingKits";
import { useDismissable } from "@/lib/useEscapeKey";
import { cn } from "@/lib/utils";

/*
 * The History page's header controls: the History / Marketing Kits toggle and
 * every filter beside it.
 */

const TOOL_OPTIONS = TOOLS.map((t) => ({ id: t.id, label: t.label }));

/**
 * One half of the segmented History / Marketing Kits toggle.
 *
 * The count rides on the tab it belongs to rather than on the group, so it
 * is never ambiguous which of the two it is counting. That puts it outside
 * the group's own bounds, which is why the rounded ends are on the buttons
 * here instead of an `overflow-hidden` on the container that would clip it.
 */
export function ViewTab({
  icon: Icon,
  label,
  active,
  onClick,
  side,
  badge,
  badgeLabel,
  compact = false,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
  side: "left" | "right";
  badge?: number;
  badgeLabel?: string;
  /** Icon only — the phone's form. */
  compact?: boolean;
}) {
  return (
    <span className="relative">
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        aria-label={label}
        title={label}
        className={cn(
          "flex items-center justify-center text-xs font-medium transition-colors",
          compact ? "h-7 w-8 md:h-8 md:w-8" : "gap-1.5 px-3 py-1.5",
          // The divider belongs to the left half, so the group reads as one
          // control however many tabs it grows to.
          side === "left" ? "rounded-l-[5px] border-r border-white/10" : "rounded-r-[5px]",
          active ? "bg-gold/[0.08] text-gold" : "text-faint hover:bg-white/[0.04] hover:text-cream"
        )}
      >
        <Icon size={compact ? 14 : 12} />
        {!compact && label}
      </button>
      <CountBadge count={badge ?? 0} label={badgeLabel} />
    </span>
  );
}

type FilterOption = { id: string; label: string };

/**
 * Shared shape for both filters here: an icon+label trigger carrying a
 * selection-count badge, and a panel with one checkbox per option. Nothing
 * checked means no filter — everything — so there is no "All" to tick: "Clear"
 * empties the selection and that is all. Checking one or more narrows the grid
 * down to just those.
 */
function CheckboxFilter({
  icon: Icon,
  label,
  emptyLabel,
  options,
  selected,
  onChange,
  compact = false,
  searchable = false,
  pinned,
}: {
  icon: LucideIcon;
  label: string;
  emptyLabel: string;
  options: FilterOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** Icon only — the phone's form, where the labels cost a row each. */
  compact?: boolean;
  /** A search box over the list — for a list long enough to need one. */
  searchable?: boolean;
  /** An option kept first and apart from the rest — the viewer's own "Myself". */
  pinned?: FilterOption;
}) {
  const { open, side, toggle: togglePanel, containerRef } = usePopover();
  const [query, setQuery] = useState("");

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((v) => v !== id) : [...selected, id]);
  }

  const needle = query.trim().toLowerCase();
  const listed = options.filter((option) => option.id !== pinned?.id && (!needle || option.label.toLowerCase().includes(needle)));
  const showPinned = pinned && (!needle || pinned.label.toLowerCase().includes(needle) || "myself".includes(needle));

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={togglePanel}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={label}
        title={label}
        className={cn(
          "flex items-center rounded-full border border-white/10 bg-surface-raised font-medium text-cream transition-colors hover:border-white/20",
          compact ? "h-7 w-7 justify-center md:h-8 md:w-8" : "gap-1.5 py-1.5 pl-3 pr-2.5 text-xs"
        )}
      >
        <Icon size={compact ? 14 : 12} className="text-faint" />
        {!compact && (
          <>
            <span>{label}</span>
            <ChevronDown size={13} className="text-faint" />
          </>
        )}
      </button>

      {/* What's checked, not what they are — the list itself already shows
          every option. */}
      <CountBadge count={selected.length} />

      {open && (
        <div
          role="listbox"
          aria-multiselectable="true"
          className={cn("absolute top-full z-50 mt-2 w-48 overflow-hidden rounded-lg border border-white/10 bg-surface-raised shadow-lg", side)}
        >
          {options.length === 0 && !pinned ? (
            <p className="px-3 py-2.5 text-[11px] text-faint">{emptyLabel}</p>
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-white/5 px-3 py-1.5">
                {searchable ? (
                  <>
                    <Search size={12} className="shrink-0 text-faint" />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder={`Search ${label.toLowerCase()}…`}
                      aria-label={`Search ${label.toLowerCase()}`}
                      className="min-w-0 flex-1 bg-transparent text-xs text-cream outline-none placeholder:text-faint"
                    />
                  </>
                ) : (
                  <span className="flex-1 text-[10px] text-faint">{selected.length ? `${selected.length} selected` : `All ${label.toLowerCase()}`}</span>
                )}
                {selected.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onChange([])}
                    className="shrink-0 text-[11px] font-medium text-gold transition-colors hover:text-cream"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="thin-scrollbar max-h-64 overflow-y-auto py-1">
                {showPinned && (
                  <label className="flex cursor-pointer items-center gap-2 border-b border-white/5 px-3 py-1.5 text-xs font-medium text-cream hover:bg-white/[0.05]">
                    <input
                      type="checkbox"
                      checked={selected.includes(pinned.id)}
                      onChange={() => toggle(pinned.id)}
                      style={{ accentColor: "var(--color-gold)" }}
                    />
                    <span className="truncate">Myself</span>
                    <span className="truncate text-[10px] font-normal text-faint">{pinned.label}</span>
                  </label>
                )}
                {listed.length === 0 && !showPinned && <p className="px-3 py-1.5 text-[11px] text-faint">No matches</p>}
                {listed.map((option) => (
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
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** A `from`/`to` pair, each an ISO date (`YYYY-MM-DD`) or empty for open-ended. */
export type DateRange = { from: string; to: string };

const EMPTY_RANGE: DateRange = { from: "", to: "" };

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

/**
 * The phone header's "more" button: Date, Members, Quality and Type folded
 * behind one icon so the header keeps room for the view toggle and Tools.
 * The badge counts how many of the hidden filters are set, so a narrowed
 * grid never looks unfiltered.
 */
export function MoreFilters({ activeCount, children }: { activeCount: number; children: React.ReactNode }) {
  const { open, side, toggle, containerRef } = usePopover();

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label="More filters"
        title="More filters"
        className={cn(
          "relative flex h-7 w-7 items-center justify-center rounded-full border bg-surface-raised transition-colors",
          open || activeCount > 0 ? "border-gold/30 text-gold" : "border-white/10 text-cream hover:border-white/20"
        )}
      >
        <MoreHorizontal size={15} />
      </button>
      <CountBadge count={activeCount} />

      {open && (
        <div
          className={cn(
            "absolute top-full z-50 mt-2 flex w-max flex-col items-stretch gap-2 rounded-xl border border-white/10 bg-surface-raised p-2 shadow-lg [&>*]:w-full",
            side
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * Which edge a filter's panel hangs from. Right-aligned panels opened
 * leftward, which for the icons near the left of the header put them under
 * the sidebar; a button in the left half of the screen opens rightward.
 */
function panelSide(anchor: HTMLElement | null) {
  if (!anchor) return "right-0";
  const rect = anchor.getBoundingClientRect();
  return rect.left + rect.width / 2 < window.innerWidth / 2 ? "left-0" : "right-0";
}

/**
 * The open/close plumbing every filter popover here shares: its state, the
 * container that counts as "inside", dismissal on Escape or an outside
 * click, and which side the panel opens to — measured once when it opens,
 * not on every render.
 */
function usePopover() {
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState("right-0");
  const containerRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismissable(containerRef, open, close);

  const toggle = useCallback(() => {
    setSide(panelSide(containerRef.current));
    setOpen((wasOpen) => !wasOpen);
  }, []);

  return { open, side, toggle, containerRef };
}

/** The gold count on a filter's corner — how many of its values are set. Renders nothing at zero. */
function CountBadge({ count, label }: { count: number; label?: string }) {
  if (count <= 0) return null;
  return (
    <span
      aria-label={label}
      className="pointer-events-none absolute -right-1.5 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-gold px-1 text-[9px] font-bold text-[#4A3410] shadow-sm"
    >
      {count}
    </span>
  );
}

/**
 * One search over History: a design number ("r-12" finds "R-1203"), or words
 * from what was asked for ("center stone" finds a cleaning request that said
 * "please add center stone diamond") — matched by the server.
 *
 * Asks once typing pauses, so "center stone" is one request rather than
 * twelve; Enter asks straight away, Escape clears. While an answer is on its
 * way the icon turns to a spinner and the results already shown stay put.
 */
export function HistorySearch({
  value,
  onChange,
  busy = false,
  compact = false,
}: {
  value: string;
  onChange: (next: string) => void;
  busy?: boolean;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  // Latest handler for the timer below, which shouldn't restart because the
  // parent re-rendered with a new function.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    const next = draft.trim();
    if (next === value) return;
    const timer = setTimeout(() => onChangeRef.current(next), 350);
    return () => clearTimeout(timer);
  }, [draft, value]);

  const clear = () => {
    setDraft("");
    if (value) onChange("");
  };

  return (
    <div
      title="Search by design number, or by words from the prompt"
      className={cn(
        "flex items-center gap-2 rounded-full border bg-surface-raised pl-3 pr-2 transition-colors focus-within:border-gold/40",
        value ? "border-gold/30" : "border-white/10 hover:border-white/20",
        compact ? "h-7 md:h-8" : "h-8"
      )}
    >
      {busy ? (
        <Loader2 size={14} className="shrink-0 animate-spin text-gold" />
      ) : (
        <Search size={14} className="shrink-0 text-faint" />
      )}
      <input
        type="search"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && draft.trim() !== value) onChange(draft.trim());
          if (event.key === "Escape") clear();
        }}
        maxLength={100}
        placeholder="Search design no. or prompt…"
        aria-label="Search by design number or prompt words"
        className={cn(
          "min-w-0 bg-transparent text-[13px] text-cream outline-none placeholder:text-faint [&::-webkit-search-cancel-button]:hidden",
          compact ? "w-44" : "w-56"
        )}
      />
      {draft && (
        <button
          type="button"
          onClick={clear}
          aria-label="Clear search"
          className="shrink-0 rounded-full p-0.5 text-faint transition-colors hover:text-cream"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}

/** When to show results from — presets, or an exact pair of dates. */
export function DateFilter({
  range,
  onChange,
  compact = false,
}: {
  range: DateRange;
  onChange: (next: DateRange) => void;
  compact?: boolean;
}) {
  const { open, side, toggle, containerRef } = usePopover();
  const active = Boolean(range.from || range.to);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label={active ? `Date range: ${describeRange(range)}` : "Date range"}
        title={active ? describeRange(range) : "Date range"}
        className={cn(
          "flex items-center rounded-full border border-white/10 bg-surface-raised text-xs font-medium text-cream transition-colors hover:border-white/20",
          compact ? "h-7 w-7 justify-center md:h-8 md:w-8" : "gap-1.5 py-1.5 pl-3 pr-2.5"
        )}
      >
        <CalendarRange size={compact ? 14 : 12} className="text-faint" />
        {!compact && (
          <>
            <span className="max-w-40 truncate">{describeRange(range)}</span>
            <ChevronDown size={13} className="text-faint" />
          </>
        )}
      </button>

      <CountBadge count={active ? 1 : 0} />

      {open && (
        <div className={cn("absolute top-full z-50 mt-2 w-60 overflow-hidden rounded-lg border border-white/10 bg-surface-raised shadow-lg", side)}>
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

export function ToolFilter({ selected, onChange, compact }: { selected: string[]; onChange: (next: string[]) => void; compact?: boolean }) {
  return (
    <CheckboxFilter
      icon={SlidersHorizontal}
      label="Tools"
      emptyLabel="No tools to filter by."
      options={TOOL_OPTIONS}
      selected={selected}
      onChange={onChange}
      compact={compact}
      searchable
    />
  );
}

/** The two new cuts: what resolution a run was made at, and what it produced. */
const TYPE_OPTIONS: FilterOption[] = [
  { id: "image", label: "Images" },
  { id: "video", label: "Video" },
  { id: "text", label: "Text" },
];

/**
 * What a run produced and at what size, under one button: Type (images,
 * video, text — not which tool made it: "find that video" is one question,
 * and a text answer comes from several tools) over Quality (the resolution
 * badge on every tile). Two small lists that were two buttons in a crowded
 * header; one panel shows both, each still its own filter, and the badge
 * counts everything ticked across the two.
 */
export function OutputFilter({
  qualities,
  selectedQualities,
  onQualitiesChange,
  selectedTypes,
  onTypesChange,
  compact = false,
}: {
  /** The resolutions the library has, from the facets call. */
  qualities: string[];
  selectedQualities: string[];
  onQualitiesChange: (next: string[]) => void;
  selectedTypes: string[];
  onTypesChange: (next: string[]) => void;
  compact?: boolean;
}) {
  const { open, side, toggle: togglePanel, containerRef } = usePopover();
  const qualityOptions = useMemo(() => qualities.map((value) => ({ id: value, label: value })), [qualities]);
  const count = selectedTypes.length + selectedQualities.length;
  const label = "Type & quality";

  const toggleIn = (list: string[], id: string, onChange: (next: string[]) => void) =>
    onChange(list.includes(id) ? list.filter((value) => value !== id) : [...list, id]);

  const section = (
    heading: string,
    options: FilterOption[],
    selected: string[],
    onChange: (next: string[]) => void,
    emptyLabel: string
  ) => (
    <div className="py-1">
      <p className="px-3 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-faint">{heading}</p>
      {options.length === 0 ? (
        <p className="px-3 py-1.5 text-[11px] text-faint">{emptyLabel}</p>
      ) : (
        options.map((option) => (
          <label
            key={option.id}
            className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-cream hover:bg-white/[0.05]"
          >
            <input
              type="checkbox"
              checked={selected.includes(option.id)}
              onChange={() => toggleIn(selected, option.id, onChange)}
              style={{ accentColor: "var(--color-gold)" }}
            />
            <span className="truncate">{option.label}</span>
          </label>
        ))
      )}
    </div>
  );

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={togglePanel}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={label}
        title={label}
        className={cn(
          "flex items-center rounded-full border border-white/10 bg-surface-raised font-medium text-cream transition-colors hover:border-white/20",
          compact ? "h-7 w-7 justify-center md:h-8 md:w-8" : "gap-1.5 py-1.5 pl-3 pr-2.5 text-xs"
        )}
      >
        <Film size={compact ? 14 : 12} className="text-faint" />
        {!compact && (
          <>
            <span>{label}</span>
            <ChevronDown size={13} className="text-faint" />
          </>
        )}
      </button>

      <CountBadge count={count} />

      {open && (
        <div
          role="listbox"
          aria-multiselectable="true"
          className={cn("absolute top-full z-50 mt-2 w-48 overflow-hidden rounded-lg border border-white/10 bg-surface-raised shadow-lg", side)}
        >
          <div className="flex items-center gap-2 border-b border-white/5 px-3 py-1.5">
            <span className="flex-1 text-[10px] text-faint">{count ? `${count} selected` : "All types & qualities"}</span>
            {count > 0 && (
              <button
                type="button"
                onClick={() => {
                  onTypesChange([]);
                  onQualitiesChange([]);
                }}
                className="shrink-0 text-[11px] font-medium text-gold transition-colors hover:text-cream"
              >
                Clear
              </button>
            )}
          </div>
          <div className="thin-scrollbar max-h-80 divide-y divide-white/5 overflow-y-auto">
            {section("Type", TYPE_OPTIONS, selectedTypes, onTypesChange, "Nothing to filter by.")}
            {section("Quality", qualityOptions, selectedQualities, onQualitiesChange, "No resolutions to filter by yet.")}
          </div>
        </div>
      )}
    </div>
  );
}

/** The kit kinds, labelled as the rest of the app labels them. */
const KIND_OPTIONS: FilterOption[] = (
  ["brand_story", "collection_story", "campaign", "festive"] as const
).map((kind) => ({
  id: kind,
  label: KIT_LABEL[kind],
}));

/** Which kinds of kit to show — the Kits tab's counterpart to Tools. */
export function KindFilter({ selected, onChange, compact }: { selected: string[]; onChange: (next: string[]) => void; compact?: boolean }) {
  return (
    <CheckboxFilter
      icon={SlidersHorizontal}
      label="Kind"
      emptyLabel="No kinds to filter by."
      options={KIND_OPTIONS}
      selected={selected}
      onChange={onChange}
      compact={compact}
    />
  );
}

/** Who to show results for — a checkbox per real name the data has reported, never a generic "Whole team" standing in for actual people. */
export function MemberFilter({
  members,
  selected,
  onChange,
  compact,
  self,
}: {
  members: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  compact?: boolean;
  /** The viewer's own name, offered first as "Myself". */
  self?: string;
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
      compact={compact}
      searchable
      pinned={self ? { id: self, label: self } : undefined}
    />
  );
}
