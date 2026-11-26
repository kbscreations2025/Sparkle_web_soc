"use server";

import { updateTag } from "next/cache";
import { lookbookCacheTag } from "@/lib/lookbook/cache";

/**
 * Drops the frontend's cached copy of these public pages, so a publish,
 * unpublish, rename or delete shows on /l/<slug> at once rather than when the
 * cache next expires (app/l/[slug]/page.tsx keeps a page for a minute).
 *
 * Only ever forgets: the next visit reads the page fresh from the API, which
 * decides on its own what is published. So it needs no permission check of
 * its own, and the slugs are only trimmed and bounded.
 */
export async function refreshPublicLookbooks(slugs: string[]) {
  for (const slug of slugs.slice(0, 20)) {
    if (typeof slug === "string" && slug.length > 0 && slug.length <= 80) updateTag(lookbookCacheTag(slug));
  }
}
