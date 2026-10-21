"use client";

import { CleaningWorkspace } from "@/components/studio/CleaningWorkspace";
import { OFFERED_TESTING_CLEANING_MODELS, DEFAULT_TESTING_CLEANING_MODEL } from "@/lib/api";

/**
 * Cleaning in Testing: the same workspace as Default, with the studio prompt —
 * plain white background, polished shank, brilliant stones, a soft contact
 * shadow and one consistent yellow-gold tone across a set (see
 * backend/src/prompts/studioCleaning.js) — on the trial models that held up
 * against it, badged in the picker.
 *
 * Runs record under Image Cleaning like every other cleaning, so they sit in
 * History and the queue beside the rest, and reopen here by their model's
 * name (see lib/nav.ts workspacePathFor).
 */
export default function CleaningTestingPage() {
  return (
    <CleaningWorkspace
      modelOptions={OFFERED_TESTING_CLEANING_MODELS}
      defaultModel={DEFAULT_TESTING_CLEANING_MODEL}
      promptVariant="studio"
    />
  );
}
