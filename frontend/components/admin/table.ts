/**
 * The console's table styling, in one place — every list in the admin shell
 * (organizations, members, API keys) is the same table with different columns,
 * and these strings were previously copied into each of them.
 */

/** A cell in a top-level table. */
export const CELL = "px-4 py-3 text-[13px]";

/** A cell in a table nested inside an expanded row — one step tighter. */
export const NESTED_CELL = "px-3 py-2.5 text-[12px]";

/** The small-caps header row shared by both. */
export const HEAD_ROW =
  "bg-surface-float/60 text-left text-[10px] font-semibold uppercase tracking-wider text-muted";

/**
 * The audit log's density — one line of text per row, controls sized to fit
 * it. Lists people scan rather than read use this, so they match the log.
 */
export const COMPACT_CELL = "px-3 py-1.5 text-[12px]";

/** A header cell that stays pinned, and opaque, while the rows scroll under it. */
export const COMPACT_HEAD =
  "px-3 py-1.5 text-[12px] sticky top-0 z-10 bg-surface-float shadow-[inset_0_-1px_0_rgba(255,255,255,0.10)]";

/** The scroll container: outer for a page-level table, nested for one inside a row. */
export const TABLE_FRAME = "overflow-x-auto rounded-xl border border-white/10 bg-surface-raised/60";
export const NESTED_TABLE_FRAME = "overflow-x-auto rounded-lg border border-white/10";
