"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether this tab can reach Sparkle right now, for the notice at the top of
 * the app.
 *
 * Two signals, because neither is enough alone:
 * - The browser's own online/offline. It's reliable when it says offline (no
 *   network at all), but it says "online" on a connection that's up yet too
 *   weak to get a request through.
 * - What actually happened to the last request: `apiRequest` reports every
 *   attempt that got no answer (after its retries) and every one that did.
 *
 * A module-level store read through useSyncExternalStore: every component
 * agrees on one value, and the server render (and hydration) assume online.
 */
export type ConnectionState = "online" | "offline" | "unreachable";

let unreachable = false;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

/** Called by apiRequest: `false` when a request got no answer, `true` when one did. */
export function reportReachable(reached: boolean) {
  if (unreachable === !reached) return;
  unreachable = !reached;
  notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

function snapshot(): ConnectionState {
  if (!navigator.onLine) return "offline";
  return unreachable ? "unreachable" : "online";
}

export function useConnectionState(): ConnectionState {
  return useSyncExternalStore(subscribe, snapshot, () => "online");
}
