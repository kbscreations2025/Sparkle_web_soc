"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useNavItems } from "./nav";

/**
 * Pages one click past a nav item — not in the rail, so a `<Link>` never puts
 * them on screen to be prefetched, but reached often enough to want warm.
 */
const EXTRA_ROUTES = [
  "/cleaning/default",
  "/cleaning/new",
  "/marketing-kit/brand-story",
  "/marketing-kit/affinity",
  "/marketing-kit/campaign",
  "/credits",
];

/**
 * Loads every dashboard page in the background once the shell is up, so
 * moving between tools never waits on a download.
 *
 * Production: `router.prefetch` for each route. The rail's own links already
 * prefetch what is visible; this covers everything else, and does it up front
 * rather than as links scroll into view.
 *
 * Development: Next.js does not prefetch at all, and instead compiles each
 * route on its first visit — the multi-second "lag" on a first click. A plain
 * request to the route makes the dev server compile it now, so it is ready by
 * the time anyone clicks. One at a time, so the warm-up never competes with
 * the page actually in use for the compiler.
 *
 * Deferred to idle time either way: the page the user landed on comes first.
 */
export function usePreloadRoutes() {
  const router = useRouter();
  const items = useNavItems();

  useEffect(() => {
    const routes = Array.from(
      new Set([...items.map((item) => item.href).filter((href): href is string => Boolean(href)), ...EXTRA_ROUTES])
    );
    let cancelled = false;

    const run = async () => {
      if (process.env.NODE_ENV === "production") {
        routes.forEach((href) => router.prefetch(href));
        return;
      }
      for (const href of routes) {
        if (cancelled) return;
        // The response is thrown away — compiling the route is the point.
        await fetch(href, { credentials: "include" }).catch(() => {});
      }
    };

    // `requestIdleCallback` is missing in Safari; a short timeout stands in.
    const idle = typeof window.requestIdleCallback === "function";
    const handle = idle ? window.requestIdleCallback(() => void run()) : window.setTimeout(() => void run(), 1500);

    return () => {
      cancelled = true;
      if (idle) window.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
    };
  }, [items, router]);
}
