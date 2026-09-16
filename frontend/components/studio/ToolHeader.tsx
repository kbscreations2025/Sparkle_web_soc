"use client";

import { RotateCcw } from "lucide-react";

/**
 * The reset control every chat-style tool shares, once there's something to
 * discard. The name and description that used to sit beside it were dropped
 * as redundant — the breadcrumb above already names the page. Shared so
 * Cleaning and Chat to Edit (and any tool built the same way) can't drift
 * into slightly different header markup.
 *
 * Renders nothing until there's something to reset, rather than an empty bar.
 */
export function ToolHeader({ onReset, resetLabel = "Start over" }: { onReset?: () => void; resetLabel?: string }) {
  if (!onReset) return null;

  return (
    <header className="flex h-11 shrink-0 items-center justify-end border-b border-white/[0.06] px-5">
      <button
        onClick={onReset}
        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-muted transition-colors hover:bg-white/[0.07] hover:text-cream"
      >
        <RotateCcw size={12} /> {resetLabel}
      </button>
    </header>
  );
}
