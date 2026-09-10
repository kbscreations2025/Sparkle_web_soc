"use client";

import { RotateCcw } from "lucide-react";

/**
 * The title bar every chat-style tool shares: a name, a one-line description,
 * and — once there's something to discard — a reset button. Shared so
 * Cleaning and Chat to Edit (and any tool built the same way) can't drift
 * into slightly different header markup.
 */
export function ToolHeader({
  title,
  description,
  /** Omit to hide the reset button — e.g. before there's anything to reset. */
  onReset,
  resetLabel = "Start over",
}: {
  title: string;
  description: string;
  onReset?: () => void;
  resetLabel?: string;
}) {
  return (
    <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-white/[0.06] px-5">
      <div className="flex min-w-0 items-baseline gap-2">
        <h1 className="shrink-0 text-[13px] font-semibold text-cream">{title}</h1>
        <p className="truncate text-[11px] text-faint">{description}</p>
      </div>
      {onReset && (
        <button
          onClick={onReset}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-muted transition-colors hover:bg-white/[0.07] hover:text-cream"
        >
          <RotateCcw size={12} /> {resetLabel}
        </button>
      )}
    </header>
  );
}
