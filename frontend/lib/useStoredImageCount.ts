"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * How many images to generate, remembered in this browser until the user
 * picks a different number.
 *
 * Shared by every tool of a kind, so the number is chosen once rather than on
 * every page: the text tools (Text to Image, Text to Sketch) share one choice,
 * the photo tools (Sketch to Image, Image to Sketch) another — their ranges
 * and defaults differ, so one number can't serve both.
 * Read through `useSyncExternalStore` rather than a state initialiser: the
 * server has no localStorage, so it renders the default and the stored value
 * takes over on the client without a hydration mismatch — and every page
 * holding the same tool's count stays in step when one of them changes it.
 *
 * Storage can be unavailable (private mode, blocked site data); then the
 * choice holds for the visit and starts from the default next time.
 */

const listeners = new Set<() => void>();
/** Stand-in when storage is blocked, so a click still takes effect for this visit. */
const memory = new Map<string, string>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab changing the same choice.
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function read(key: string) {
  try {
    return window.localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

export type ImageCountGroup = "text" | "photo";

export function useStoredImageCount(group: ImageCountGroup, options: readonly number[], fallback: number) {
  const key = `sparkle:image-count:${group}`;
  const raw = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null
  );

  // Anything stored that is no longer on offer (the options changed since)
  // falls back to the default rather than selecting a button that isn't there.
  const stored = Number(raw);
  const count = raw !== null && options.includes(stored) ? stored : fallback;

  const setCount = useCallback(
    (next: number) => {
      memory.set(key, String(next));
      try {
        window.localStorage.setItem(key, String(next));
      } catch {
        // Blocked storage: `memory` above still carries it for this visit.
      }
      listeners.forEach((listener) => listener());
    },
    [key]
  );

  return [count, setCount] as const;
}
