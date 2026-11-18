"use client";

import { useEffect } from "react";
import { WifiOff } from "lucide-react";
import { BACKEND_URL } from "@/lib/api";
import { reportReachable, useConnectionState } from "@/lib/connection";
import { timeoutSignal } from "@/lib/session-check";

/** While the server can't be reached, how often to check whether it's back. */
const PROBE_EVERY_MS = 10_000;

/**
 * A thin bar across the top of the app while the connection is down or
 * Sparkle can't be reached. Without it, a bad connection showed up only as
 * pages that never finished loading, and nothing said why or that the app
 * was still trying.
 *
 * While unreachable it checks the backend's health endpoint every few
 * seconds, so the bar clears by itself once requests get through again. That
 * doesn't depend on the page happening to make a request. Offline needs no
 * checking: the browser says when it's back.
 */
export function ConnectionBanner() {
  const state = useConnectionState();

  useEffect(() => {
    if (state !== "unreachable") return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/health`, { signal: timeoutSignal(PROBE_EVERY_MS - 1000) });
        if (res.ok) reportReachable(true);
      } catch {
        // Still unreachable; the next tick tries again.
      }
    }, PROBE_EVERY_MS);
    return () => clearInterval(timer);
  }, [state]);

  if (state === "online") return null;

  return (
    <div
      role="status"
      className="flex shrink-0 items-center justify-center gap-2 border-b border-gold/20 bg-gold/10 px-4 py-1.5 text-center text-[12px] font-medium text-gold"
    >
      <WifiOff size={13} aria-hidden className="shrink-0" />
      {state === "offline"
        ? "You're offline. Sparkle will carry on when your connection is back."
        : "Having trouble reaching Sparkle. Retrying…"}
    </div>
  );
}
