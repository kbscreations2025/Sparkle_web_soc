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
 *
 * With no `sidebar` the nav is pinned across the top and the content is
 * padded clear of it. Pass a `sidebar` and it becomes a two-column frame
 * instead: the sidebar owns the full height (which is what lets the product
 * mark live at the very top of it), and the nav sits inside the content
 * column. A nav used that way must render itself unpinned — see `NavBar`'s
 * `floating` prop — or it would lie across the sidebar.
 */
export function AppShell({
  nav,
  sidebar,
  children,
}: {
  nav: ReactNode;
  sidebar?: ReactNode;
  children: ReactNode;
}) {
  return (
    // Framer animates via rAF, so the reduced-motion CSS in globals.css can't
    // reach it — this is what honours the OS setting for every motion element.
    <MotionConfig reducedMotion="user">
      <div className="flex h-screen min-h-0 bg-void">
        {sidebar}
        {/* `min-w-0`: without it a wide child (a results grid, a long row of
            model cards) stretches this column and pushes the sidebar off. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {nav}
          <main className={cn("flex flex-1 flex-col min-h-0 overflow-hidden", !sidebar && NAV_OFFSET)}>
            {children}
          </main>
        </div>
      </div>
    </MotionConfig>
  );
}
