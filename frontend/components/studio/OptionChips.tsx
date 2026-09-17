"use client";

import { cn } from "@/lib/utils";

/**
 * A labelled row of single-choice chips — Sketch Style, Visual Style, and the
 * option groups inside the Jewelry Builder.
 *
 * Every generation tool had its own copy of this markup, which is how the
 * chips drifted into three slightly different paddings and two different
 * selected-states. One component means a chip looks the same wherever it is.
 */
export function OptionChips<TId extends string>({
  label,
  options,
  value,
  onChange,
  size = "md",
}: {
  label?: string;
  options: readonly { id: TId; label: string }[];
  value: TId | "";
  /** Called with the id picked. Chips are single-choice; re-picking is the caller's to interpret. */
  onChange: (id: TId) => void;
  /** "sm" for the dense lists inside the builder, "md" for a form section. */
  size?: "sm" | "md";
}) {
  return (
    <div className="space-y-2">
      {label && <p className="text-xs font-semibold uppercase tracking-wider text-cream">{label}</p>}
      <div className={cn("flex flex-wrap", size === "sm" ? "gap-1.5" : "gap-2")}>
        {options.map((option) => (
          <Chip
            key={option.id}
            label={option.label}
            active={option.id === value}
            size={size}
            onClick={() => onChange(option.id)}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * One chip. Exported so the builder can render its raw string options without
 * first mapping them into `{ id, label }` pairs it has no other use for.
 *
 * `min-h-8` on the larger size is not decoration: a chip is a touch target,
 * and the text-only height of these lands under the 32px where taps start
 * being missed on a phone.
 */
export function Chip({
  label,
  active,
  onClick,
  size = "md",
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  size?: "sm" | "md";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-lg border font-medium transition-colors",
        size === "sm" ? "px-2 py-1 text-[10px]" : "min-h-8 px-3 py-1.5 text-xs",
        active
          ? "border-gold/30 bg-gold/10 text-gold"
          : "border-white/[0.07] bg-white/[0.03] text-muted hover:border-white/[0.14] hover:text-cream"
      )}
    >
      {label}
    </button>
  );
}
