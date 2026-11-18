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
 *
 * A few entries can also be kept on the device (`persist`), so a reload, a new
 * tab or the next sign-in opens on them too. History's first screen above all:
 * on a slow connection it is the difference between the grid at once and a
 * skeleton for seconds. Read back only with `getPersistedPageCache`, from an
 * effect: the server's HTML can't know what's on the device, so using it
 * during the first render would make hydration disagree.
 */

/** Enough for a handful of filter combinations per page; oldest goes first. */
const MAX_ENTRIES = 40;

const store = new Map<string, unknown>();

/** Versioned, so a change of shape simply stops matching rather than painting garbage. */
const PERSIST_PREFIX = "sparkle:page-cache:v1:";
const PERSIST_INDEX = `${PERSIST_PREFIX}index`;
/** Kept small: a few filter views of History, not everything ever seen. */
const MAX_PERSISTED = 8;

export function pageCacheKey(userId: string | undefined, ...parts: unknown[]) {
  return `${userId ?? "anon"}:${parts.map((part) => (typeof part === "string" ? part : JSON.stringify(part))).join(":")}`;
}

export function getPageCache<T>(key: string): T | undefined {
  return store.get(key) as T | undefined;
}

function remember(key: string, value: unknown) {
  // Re-inserted so it counts as the newest — a Map iterates in insertion order.
  store.delete(key);
  store.set(key, value);
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

/**
 * `persist` also keeps it on the device: `true` for the value as is, or a
 * function returning the part worth keeping, such as the first few screens
 * of a grid rather than every page scrolled through.
 */
export function setPageCache<T>(key: string, value: T, options?: { persist?: boolean | ((value: T) => unknown) }) {
  remember(key, value);
  if (options?.persist) writePersisted(key, typeof options.persist === "function" ? options.persist(value) : value);
}

/**
 * The cached value, from memory or, failing that, from the device. Only
 * after mount (in an effect or a handler), never during the first render.
 */
export function getPersistedPageCache<T>(key: string): T | undefined {
  const inMemory = store.get(key);
  if (inMemory !== undefined) return inMemory as T;
  try {
    const raw = window.localStorage.getItem(PERSIST_PREFIX + key);
    if (!raw) return undefined;
    const value = JSON.parse(raw) as T;
    remember(key, value);
    return value;
  } catch {
    // Storage blocked (a private window, strict settings) or unreadable: as if never kept.
    return undefined;
  }
}

/** Called on sign-out, so nothing from the last session survives into the next. */
export function clearPageCache() {
  store.clear();
  try {
    readIndex().forEach((key) => window.localStorage.removeItem(PERSIST_PREFIX + key));
    window.localStorage.removeItem(PERSIST_INDEX);
  } catch {
    // Nothing was kept if storage is blocked.
  }
}

function readIndex(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PERSIST_INDEX) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((key) => typeof key === "string") : [];
  } catch {
    return [];
  }
}

function writePersisted(key: string, value: unknown) {
  try {
    const index = readIndex().filter((existing) => existing !== key);
    index.push(key);
    // Oldest first, so the ones that drop off are the least recently written.
    while (index.length > MAX_PERSISTED) {
      const dropped = index.shift();
      if (dropped) window.localStorage.removeItem(PERSIST_PREFIX + dropped);
    }
    window.localStorage.setItem(PERSIST_PREFIX + key, JSON.stringify(value));
    window.localStorage.setItem(PERSIST_INDEX, JSON.stringify(index));
  } catch {
    // Blocked or full: the in-memory copy still serves this tab, and the next
    // visit just loads from the network as before.
  }
}
