"use client";

import { RotateCcw } from "lucide-react";
import { usePageActions } from "@/lib/page-toolbar-context";

/**
 * The reset control every chat-style tool shares, once there's something to
 * discard.
 *
 * Renders into the top nav rather than a bar of its own: a whole 44px row for
 * one button cost more vertical space than the conversation could spare, and
 * the nav already has room beside the credits pill. Nothing is drawn where
 * this component sits.
 */
export function ToolHeader({ onReset, resetLabel = "Start over" }: { onReset?: () => void; resetLabel?: string }) {
  usePageActions(
    onReset ? (
      <button
        onClick={onReset}
        title={resetLabel}
        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 px-2 py-1 text-[11px] text-muted transition-colors hover:bg-white/[0.07] hover:text-cream sm:px-2.5"
      >
        <RotateCcw size={12} />
        {/* The label is the first thing to go when the bar gets tight — the
            icon and tooltip still say what it does. */}
        <span className="hidden sm:inline">{resetLabel}</span>
      </button>
    ) : null
  );

  return null;
}
