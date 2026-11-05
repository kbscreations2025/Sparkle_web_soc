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
        aria-label={resetLabel}
        // Drawn like the other round controls in this bar (History's filter
        // buttons): a circle on phones, a pill once the label fits.
        className="flex h-7 w-7 shrink-0 items-center justify-center gap-1.5 rounded-full border border-white/10 bg-surface-raised text-[11px] font-medium text-cream transition-colors hover:border-white/20 sm:w-auto sm:px-3 md:h-8"
      >
        <RotateCcw size={14} className="text-faint" />
        {/* The label is the first thing to go when the bar gets tight — the
            icon and tooltip still say what it does. */}
        <span className="hidden sm:inline">{resetLabel}</span>
      </button>
    ) : null
  );

  return null;
}
