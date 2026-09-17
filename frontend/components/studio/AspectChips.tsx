"use client";

import { cn } from "@/lib/utils";

type Aspect = { id: string; label: string; w: number; h: number };

/**
 * Aspect ratio, shown as the shape itself rather than only as a number — the
 * little outline is what makes 4:5 and 9:16 distinguishable at a glance.
 *
 * Wraps rather than forcing four onto one line: at 320px four of these
 * squeeze the labels to the point of truncation, so on a narrow screen they
 * take two rows and stay legible.
 */
export function AspectChips<TId extends string>({
  label = "Aspect Ratio",
  options,
  value,
  onChange,
}: {
  label?: string;
  options: readonly (Aspect & { id: TId })[];
  value: TId;
  onChange: (id: TId) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-cream">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = option.id === value;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onChange(option.id)}
              aria-pressed={active}
              className={cn(
                "flex min-h-11 min-w-[calc(50%-0.25rem)] flex-1 items-center justify-center gap-2 rounded-xl border text-xs font-medium transition-colors sm:min-w-0",
                active
                  ? "border-gold/30 bg-gold/10 text-gold"
                  : "border-white/[0.07] bg-white/[0.03] text-muted hover:border-white/[0.14] hover:text-cream"
              )}
            >
              <span
                style={{ width: option.w, height: option.h }}
                className="shrink-0 rounded-[2px] border-2 border-current"
              />
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
