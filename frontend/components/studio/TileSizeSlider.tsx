"use client";

import { ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Photo size for a grid of tiles: drag right for bigger photos (fewer to a
 * row), left for smaller (more to a row). Shared by the library picker and
 * History, each with its own range of columns.
 *
 * Drawn by hand — a thin line with a dot per stop and a round knob — over a
 * transparent native range that does the dragging and the arrow keys.
 */
export function TileSizeSlider({
  columns,
  min,
  max,
  onChange,
  className,
}: {
  columns: number;
  /** Fewest photos to a row — the biggest they get. */
  min: number;
  /** Most photos to a row — the smallest they get. */
  max: number;
  onChange: (columns: number) => void;
  className?: string;
}) {
  // The slider runs small → big, columns the other way.
  const size = max + min - columns;
  const percent = ((size - min) / (max - min)) * 100;
  const step = (delta: number) => onChange(Math.min(max, Math.max(min, columns - delta)));
  return (
    <div
      className={cn(
        "flex h-7 items-center gap-1 rounded-md border border-white/[0.1] bg-white/[0.03] px-1.5 text-muted",
        className
      )}
    >
      <button
        type="button"
        onClick={() => step(-1)}
        disabled={columns >= max}
        aria-label="Smaller photos"
        title="Smaller photos"
        className="hover:text-cream disabled:opacity-40 disabled:hover:text-muted"
      >
        <ZoomOut size={11} />
      </button>
      <div className="relative mx-1 flex h-4 w-16 items-center">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-faint/50" />
        <div
          aria-hidden
          className="pointer-events-none absolute left-0 top-1/2 h-px -translate-y-1/2 bg-gold"
          style={{ width: `${percent}%` }}
        />
        {Array.from({ length: max - min + 1 }, (_, index) => (
          <span
            key={index}
            aria-hidden
            className={cn(
              "pointer-events-none absolute top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full",
              index + min <= size ? "bg-gold" : "bg-faint/70"
            )}
            style={{ left: `${(index / (max - min)) * 100}%` }}
          />
        ))}
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-gold bg-surface-raised shadow-sm"
          style={{ left: `${percent}%` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={size}
          onChange={(event) => onChange(max + min - Number(event.target.value))}
          aria-label="Photo size"
          title={`${columns} per row`}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </div>
      <button
        type="button"
        onClick={() => step(1)}
        disabled={columns <= min}
        aria-label="Bigger photos"
        title="Bigger photos"
        className="hover:text-cream disabled:opacity-40 disabled:hover:text-muted"
      >
        <ZoomIn size={11} />
      </button>
    </div>
  );
}
