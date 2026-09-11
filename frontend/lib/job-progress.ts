"use client";

import { useSyncExternalStore } from "react";
import type { QueuedJob } from "./api";

/**
 * The clock half of the queue's progress display.
 *
 * The percentage arrives over the socket about once a second; elapsed time
 * does not need to travel at all, because the browser can read its own clock
 * against `startedAt`. Keeping the two separate means a run still visibly
 * counts up during a socket hiccup, and costs no traffic to do it.
 */

/**
 * The wall clock, modelled as an external store.
 *
 * One shared interval for the whole page, so ten rows counting seconds is
 * still one timer — and `currentNow` is a snapshot each render reads rather
 * than calling `Date.now()` during render, which would make the component
 * impure and its output depend on when React happened to run it.
 */
let currentNow = 0;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribeToClock(onChange: () => void) {
  // Refreshed here as well as on each tick, so a queue waking from idle reads
  // the time now rather than whenever the clock last ran.
  currentNow = Date.now();
  listeners.add(onChange);

  timer ??= setInterval(() => {
    currentNow = Date.now();
    listeners.forEach((notify) => notify());
  }, 1000);

  return () => {
    listeners.delete(onChange);
    // Nothing is watching a clock any more — a page with an idle queue should
    // not be waking once a second forever.
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** No subscription at all when nothing is running — the point of the gate. */
const subscribeToNothing = () => () => {};
const readClock = () => currentNow;
/** Also the server snapshot: nothing is timing anything during SSR. */
const readIdle = () => 0;

/**
 * The current time, refreshed once a second while `active`.
 *
 * Gated rather than always-on: an idle queue has no clock to advance, and a
 * timer that keeps firing anyway would re-render the rail forever for
 * nothing. Swapping the subscribe function is what starts and stops it.
 *
 * Returns 0 when inactive, which callers already treat as "no clock" — the
 * same value settled rows are handed.
 */
export function useNow(active: boolean) {
  return useSyncExternalStore(
    active ? subscribeToClock : subscribeToNothing,
    active ? readClock : readIdle,
    readIdle
  );
}

/** "8s", "1m 12s", "2m". Seconds are dropped past two minutes, where they are noise. */
export function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 2) return `${minutes}m`;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

/**
 * What each stage is called on screen. The percentage says how far along, the
 * phase says what is actually happening — worth distinguishing, because a run
 * stalled uploading its result and one stalled waiting on the provider look
 * identical from a number alone.
 */
const PHASE_LABELS: Record<string, string> = {
  preparing: "Preparing",
  generating: "Generating",
  saving: "Saving",
};

export type JobTiming = {
  /** How long it has been running, or how long it took once finished. Null before it starts. */
  elapsedMs: number | null;
  /** Predicted time left, or null once the run has passed its estimate. */
  remainingMs: number | null;
  /**
   * The complete status line, ready to render: "Waiting…",
   * "Generating… 47% · 14s left", "Done · 31s", or the failure message.
   */
  label: string;
};

/**
 * Turns a job plus the current time into the words shown under it.
 *
 * `now` comes from `useNow` rather than being read here, so every row on a
 * page agrees on the time and re-renders together instead of each drifting
 * by a few milliseconds.
 */
export function describeJob(job: QueuedJob, now: number): JobTiming {
  const startedAt = job.startedAt ? Date.parse(job.startedAt) : null;

  if (job.status === "queued") {
    return { elapsedMs: null, remainingMs: null, label: "Waiting…" };
  }

  if (job.status === "running") {
    const elapsedMs = startedAt ? Math.max(0, now - startedAt) : null;
    const remainingMs =
      elapsedMs != null && job.estimatedMs ? Math.max(0, job.estimatedMs - elapsedMs) : null;

    // Past the estimate there is no honest number left to give — half of all
    // runs land there, since the estimate is a median. Saying "finishing up"
    // beats a countdown stuck at 0s, and beats inventing a new deadline the
    // run may miss again.
    const clock =
      remainingMs && remainingMs > 1000
        ? `${formatDuration(remainingMs)} left`
        : elapsedMs != null
          ? `${formatDuration(elapsedMs)} · finishing up`
          : null;

    const phase = PHASE_LABELS[job.phase ?? ""] || "Generating";
    return {
      elapsedMs,
      remainingMs,
      label: `${phase}… ${job.progress}%${clock ? ` · ${clock}` : ""}`,
    };
  }

  // Settled. The measured duration is on the job; falling back to the
  // timestamps covers jobs queued before it was recorded.
  const finishedAt = job.finishedAt ? Date.parse(job.finishedAt) : null;
  const elapsedMs =
    job.durationMs ?? (startedAt && finishedAt ? Math.max(0, finishedAt - startedAt) : null);

  if (job.status === "completed") {
    return { elapsedMs, remainingMs: null, label: elapsedMs ? `Done · ${formatDuration(elapsedMs)}` : "Done" };
  }
  if (job.status === "cancelled") return { elapsedMs, remainingMs: null, label: "Cancelled" };
  return { elapsedMs, remainingMs: null, label: job.error?.message || "Failed" };
}
