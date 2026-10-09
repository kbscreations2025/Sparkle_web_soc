/**
 * The last data each page showed, kept in memory between client navigations.
 *
 * Revisiting History or Credits used to start from an empty skeleton and wait
 * a full round trip. With this, the page paints what it showed last time
 * straight away and refetches in the background — stale-while-revalidate,
 * without pulling in a data library for two pages.
 *
 * Module-level, so it lives exactly as long as the tab: a reload starts
 * clean. Every key is scoped to the signed-in user (see `pageCacheKey`) so one
 * account's results can never paint for another on a shared browser.
 */

/** Enough for a handful of filter combinations per page; oldest goes first. */
const MAX_ENTRIES = 40;

const store = new Map<string, unknown>();

export function pageCacheKey(userId: string | undefined, ...parts: unknown[]) {
  return `${userId ?? "anon"}:${parts.map((part) => (typeof part === "string" ? part : JSON.stringify(part))).join(":")}`;
}

export function getPageCache<T>(key: string): T | undefined {
  return store.get(key) as T | undefined;
}

export function setPageCache<T>(key: string, value: T) {
  // Re-inserted so it counts as the newest — a Map iterates in insertion order.
  store.delete(key);
  store.set(key, value);
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

/** Called on sign-out, so nothing from the last session survives into the next. */
export function clearPageCache() {
  store.clear();
}
