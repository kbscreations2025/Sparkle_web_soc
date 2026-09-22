"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchMyCredits, type CreditBalance } from "./api";
import { useAuth } from "./auth-context";
import { useJobs } from "./jobs-context";

/**
 * The signed-in person's credit balance, kept roughly current.
 *
 * Refreshed on three occasions, because the balance moves for three reasons:
 *
 *   - queuing a run freezes credits, and finishing one charges them, so the
 *     figure is re-read whenever the number of live jobs changes;
 *   - a grant happens elsewhere entirely — someone else's console — which
 *     nothing here can observe, so returning to the tab re-reads it;
 *   - and once on mount, for the first paint.
 *
 * Polling on a timer was the alternative and is worse: the balance is
 * genuinely static most of the time, and a request a second from every open
 * tab buys nothing.
 */
export function useCredits() {
  const { user } = useAuth();
  const { jobs } = useJobs();
  const [credits, setCredits] = useState<CreditBalance | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    const res = await fetchMyCredits();
    if (res.status === "success") setCredits(res.credits);
  }, [user]);

  // How many runs are in flight. When this changes, credits have just been
  // frozen or released — the only moments a run can move the balance.
  const liveJobs = jobs.filter((job) => job.status === "queued" || job.status === "running").length;

  useEffect(() => {
    refresh();
  }, [refresh, liveJobs]);

  useEffect(() => {
    function onFocus() {
      if (document.visibilityState === "visible") refresh();
    }
    window.addEventListener("visibilitychange", onFocus);
    return () => window.removeEventListener("visibilitychange", onFocus);
  }, [refresh]);

  return { credits, refresh };
}
