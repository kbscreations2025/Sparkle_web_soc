"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, House } from "lucide-react";
import { getBreadcrumbs } from "@/lib/breadcrumbs";

/**
 * The route trail, standing in for the header on desktop where the logo
 * doesn't live in this bar — it's at the top of the sidebar instead.
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
      className="hidden md:flex -translate-y-px items-center gap-1 min-w-0 text-xs ml-3"
    >
      {crumbs.map((crumb, index) => {
        const isHome = index === 0;
        const content = isHome ? (
          <House size={12} aria-label={crumb.label} />
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
