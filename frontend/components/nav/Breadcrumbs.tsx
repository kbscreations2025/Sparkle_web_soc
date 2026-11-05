"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, House } from "lucide-react";
import { getBreadcrumbs } from "@/lib/breadcrumbs";

/**
 * The route trail, so every screen size says which page is open. On desktop
 * it stands in for the logo, which lives at the top of the sidebar; on phones
 * it sits after the logo and menu, truncating rather than wrapping.
 *
 * The first crumb is always "Dashboard" — shown as a home glyph instead of
 * the word, so the trail stays compact once there are two or three levels.
 */
export function Breadcrumbs() {
  const pathname = usePathname();
  const crumbs = getBreadcrumbs(pathname);

  return (
    <nav
      aria-label="Breadcrumb"
      // Smaller on phones — about the height of the home glyph — so more of
      // the page name fits beside the credits.
      className="flex -translate-y-px items-center gap-1 min-w-0 text-[10.5px] md:text-xs ml-1 md:ml-3"
    >
      {crumbs.map((crumb, index) => {
        const isHome = index === 0;
        // On a phone a middle crumb shrinks to its first word and a dot
        // ("Image Cleaning" → "Image."), so the page you are actually on
        // keeps as much of its name as it can.
        const isMiddle = index > 0 && index < crumbs.length - 1;
        const content = isHome ? (
          <House size={12} aria-label={crumb.label} />
        ) : isMiddle ? (
          <>
            <span className="md:hidden" title={crumb.label}>
              {crumb.label.split(" ")[0]}.
            </span>
            <span className="hidden truncate md:inline">{crumb.label}</span>
          </>
        ) : (
          <span className="truncate">{crumb.label}</span>
        );

        return (
          <span key={index} className="flex items-center gap-1 min-w-0">
            {index > 0 && <ChevronRight size={11} className="shrink-0 text-faint" />}
            {crumb.href ? (
              <Link href={crumb.href} className="flex items-center truncate text-muted hover:text-cream transition-colors">
                {content}
              </Link>
            ) : (
              <span className="flex items-center truncate font-medium text-cream">{content}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
