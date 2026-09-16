"use client";

/**
 * Chat rail + image stage. Side by side on desktop from `md` up. Below `md`
 * there isn't room for both side by side — the rail used to be a fixed
 * 300-340px column that squeezed the stage into nothing — so instead they
 * stack: a shorter stage on top and the chat filling the rest of the screen,
 * visible at all times rather than tucked behind a button. Shared by every
 * tool built on this split (chat-to-edit, cleaning) so the fix lands once
 * for all of them.
 */
export function StudioSplitLayout({
  chatRail,
  stage,
}: {
  chatRail: React.ReactNode;
  stage: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
      {/* ── chat rail — left on desktop (unchanged); below the stage, always
          visible, on mobile — order-2 keeps DOM order (and the existing
          border-r on desktop) while moving it below the stage visually. */}
      <div className="order-2 flex min-h-0 flex-1 flex-col overflow-hidden md:order-1 md:w-[350px] md:flex-none md:border-r md:border-white/[0.06] xl:w-[340px]">
        {chatRail}
      </div>

      {/* ── stage ── shorter, fixed-height strip on top on mobile; full column on the right from md up */}
      <div className="relative order-1 h-[38vh] shrink-0 overflow-hidden border-b border-white/[0.06] md:order-2 md:h-auto md:flex-1 md:border-b-0">
        {stage}
      </div>
    </div>
  );
}
