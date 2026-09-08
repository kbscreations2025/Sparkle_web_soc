"use client";

import type { ReactNode } from "react";
import { MotionConfig } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * The fixed nav's height, and the padding that clears it. Both live here
 * because they must always agree — the nav sits outside the flow, so if they
 * drift the first screenful of content slides under it.
 */
export const NAV_HEIGHT = "h-14 md:h-16";
const NAV_OFFSET = "pt-14 md:pt-16";

/**
 * The frame both shells share — the dashboard and the super-admin console.
 * They differ only in which nav they hang at the top.
 */
export function AppShell({ nav, children }: { nav: ReactNode; children: ReactNode }) {
  return (
    // Framer animates via rAF, so the reduced-motion CSS in globals.css can't
    // reach it — this is what honours the OS setting for every motion element.
    <MotionConfig reducedMotion="user">
      <div className="flex flex-col min-h-screen bg-void">
        {nav}
        <main className={cn("flex-1 flex flex-col", NAV_OFFSET)}>{children}</main>
      </div>
    </MotionConfig>
  );
}
