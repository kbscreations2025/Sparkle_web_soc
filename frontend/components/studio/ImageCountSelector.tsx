"use client";

import { cn } from "@/lib/utils";

/**
 * How many variations to generate in parallel — a labelled pill row, styled
 * to sit beside the Model/Quality groups in a composer's footer bar.
 */
export function ImageCountSelector({
  count,
  onChange,
  options,
  disabled,
}: {
  count: number;
  onChange: (count: number) => void;
  options: readonly number[];
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col items-start gap-1 rounded-lg border border-white/[0.07] bg-white/[0.04] px-2 py-1">
      <span className="text-[8px] font-semibold uppercase leading-none tracking-wide text-faint">Images</span>
      <div className="flex gap-1">
        {options.map((option) => {
          const active = option === count;
          return (
            <button
              key={option}
              type="button"
              onClick={() => onChange(option)}
              disabled={disabled}
              title={`Generate ${option} images`}
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded-md text-[10px] font-medium transition-colors disabled:opacity-40",
                active ? "bg-gold/15 text-gold" : "text-muted hover:bg-white/[0.06] hover:text-cream"
              )}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}
