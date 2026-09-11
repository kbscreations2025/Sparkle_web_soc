"use client";

import { cn } from "@/lib/utils";

/**
 * The thin bar under a running job, shared by every queue surface.
 *
 * The transition is deliberately as long as the worker's update interval:
 * progress arrives about once a second, so a one-second ease carries each
 * value into the next and the bar reads as continuous rather than stepping.
 * Only `width` is transitioned — animating a layout-affecting property here
 * would hand the compositor work once a second for every visible row.
 */
export function JobProgressBar({ percent, className }: { percent: number; className?: string }) {
  return (
    <span className={cn("block h-0.5 w-full overflow-hidden rounded-full bg-white/10", className)}>
      <span
        className="block h-full rounded-full bg-gold transition-[width] duration-1000 ease-linear"
        style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
      />
    </span>
  );
}
