"use client";

import { useState } from "react";
import type { QueuedJob } from "./api";

/**
 * Calls `onSettled` once, the moment a run this page is following finishes.
 *
 * For the tools with no refine loop — Image to Text, Image to Video, and
 * Marketing Kit's writing halves. The generate-then-refine tools get the
 * same thing from `useGenerationWorkspace`, which has a whole conversation
 * to maintain besides.
 *
 * Applied during render rather than from an effect, which is React's
 * documented pattern for state that depends on something that changed
 * (here, the job arriving in a terminal state). An effect would paint one
 * frame of "still running" after the result is already known, and would be
 * a cascading render the moment the queue ticks.
 *
 * `onSettled` must only set state. Anything with a side effect — fetching
 * the document a run wrote — belongs in an effect keyed on what this stores.
 */
const TERMINAL = new Set(["completed", "failed", "cancelled"]);

export function useSettledJob(job: QueuedJob | null, onSettled: (job: QueuedJob) => void) {
  const [handledJobId, setHandledJobId] = useState<string | null>(null);

  if (job && job.id !== handledJobId && TERMINAL.has(job.status)) {
    setHandledJobId(job.id);
    onSettled(job);
  }
}

/** The message to show for a run that didn't finish, in the caller's words or the server's. */
export function failureMessage(job: QueuedJob, fallback: string) {
  return job.error?.message || (job.status === "cancelled" ? "Cancelled" : fallback);
}
