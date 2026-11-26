import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { lookbookCacheTag } from "@/lib/lookbook/cache";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";

/** A published page, as the backend's public route returns it (backend/src/services/lookbooks.js, readPublished). */
export type PublishedLookbook = {
  slug: string;
  title: string;
  description: string;
  design: unknown;
  publishedAt: string;
  shareImage: { url: string; width: number | null; height: number | null; type: string | null } | null;
};

export type LookbookRead =
  | { kind: "found"; lookbook: PublishedLookbook }
  | { kind: "redirect"; slug: string }
  | { kind: "missing" }
  /** The API couldn't answer (asleep, busy, rate limited): try again, rather than "gone". */
  | { kind: "unavailable" };

/**
 * One published page by its link name.
 *
 * Kept by Next's data cache for a minute, so a link sent to a whole client
 * list costs the API one read a minute rather than one per open. A publish,
 * unpublish, rename or delete clears it at once (the builder calls
 * `refreshPublicLookbooks`). Only successful answers are kept, so a page
 * that was missing shows the moment it's published.
 *
 * Wrapped in React's `cache` so the page and its metadata share one fetch.
 */
export const readLookbook = cache(async (slug: string): Promise<LookbookRead> => {
  try {
    const response = await fetch(`${BACKEND_URL}/api/public/lookbooks/${encodeURIComponent(slug)}`, {
      next: { revalidate: 60, tags: [lookbookCacheTag(slug)] },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 404) return { kind: "missing" };
    if (!response.ok) return { kind: "unavailable" };
    const body = await response.json();
    if (body?.status === "redirect" && typeof body.slug === "string") return { kind: "redirect", slug: body.slug };
    if (body?.status === "success" && body.lookbook) return { kind: "found", lookbook: body.lookbook as PublishedLookbook };
    return { kind: "missing" };
  } catch {
    return { kind: "unavailable" };
  }
});

/** This site's own origin, as the request reached it, for absolute links in link previews. */
export async function requestOrigin() {
  const list = await headers();
  const host = list.get("x-forwarded-host") ?? list.get("host");
  if (!host) return "";
  const proto = list.get("x-forwarded-proto")?.split(",")[0]?.trim() || (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}
