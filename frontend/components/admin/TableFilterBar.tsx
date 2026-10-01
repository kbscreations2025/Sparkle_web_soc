"use client";

import type { ReactNode } from "react";
import { RotateCcw, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { MultiSelect } from "@/components/ui/Select";

/** The fields inside a filter bar — search box, checklist triggers, small buttons. */
export const FILTER_FIELD =
  "h-[30px] rounded-lg border border-white/10 bg-white/[0.06] px-2.5 text-[11px] text-cream placeholder:text-faint outline-none focus:border-gold/40";

/** A checklist in the filter bar's styling — none ticked means "any". On a phone it shrinks to its icon. */
export function FilterChecklist({
  label,
  emptyLabel,
  values,
  onChange,
  options,
  icon,
}: {
  label: string;
  emptyLabel: string;
  values: string[];
  onChange: (values: string[]) => void;
  options: { value: string; label: string }[];
  icon: ReactNode;
}) {
  return (
    <div className="shrink-0">
      <MultiSelect
        values={values}
        onChange={onChange}
        emptyLabel={emptyLabel}
        ariaLabel={label}
        title={label}
        icon={icon}
        options={options}
        className={cn(
          FILTER_FIELD,
          "cursor-pointer max-sm:w-[30px] max-sm:justify-center max-sm:px-0",
          values.length > 0 && "border-gold/30 text-gold sm:text-cream"
        )}
      />
    </div>
  );
}

/**
 * The strip of controls that sits on top of an admin table, joined to it:
 * search taking the slack, any filters the page adds, an always-present
 * reset, and the count on the right.
 *
 * It renders with no bottom border or rounding — follow it directly with the
 * table in a `TABLE_FRAME` given `rounded-t-none`, and the two read as one
 * card. Every admin table uses this, so they all filter the same way.
 */
export function TableFilterBar({
  query,
  onQuery,
  placeholder = "Search",
  children,
  onReset,
  canReset,
  count,
  trailing,
}: {
  query: string;
  onQuery: (value: string) => void;
  placeholder?: string;
  /** Filters beyond search — checklists, toggles. */
  children?: ReactNode;
  onReset: () => void;
  canReset: boolean;
  /** "24 members", "3/9 rules" — shown at the right. */
  count?: ReactNode;
  /** A page action that belongs with the table, such as "New rule". */
  trailing?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-t-xl border border-b-0 border-white/10 bg-surface-raised/60 p-1.5">
      <div className="relative min-w-0 flex-1">
        <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-faint" />
        <input
          type="search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className={cn(FILTER_FIELD, "w-full pl-7")}
        />
      </div>
      {children}
      {/* Always here, so the bar doesn't shift when a filter is set; dimmed
          until there is something to clear. */}
      <button
        type="button"
        onClick={onReset}
        disabled={!canReset}
        aria-label="Reset filters"
        title="Reset filters"
        className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] text-muted transition-colors hover:border-white/[0.18] hover:text-cream disabled:cursor-default disabled:opacity-40 disabled:hover:border-white/10 disabled:hover:text-muted"
      >
        <RotateCcw size={12} />
      </button>
      {count != null && (
        <span className="shrink-0 whitespace-nowrap px-1 text-[11px] text-faint tabular-nums">{count}</span>
      )}
      {trailing}
    </div>
  );
}
