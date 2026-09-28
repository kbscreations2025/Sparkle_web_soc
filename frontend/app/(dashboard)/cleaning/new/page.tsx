"use client";

import { CleaningWorkspace } from "@/components/studio/CleaningWorkspace";
import { CLEANING_MODELS, DEFAULT_CLEANING_MODEL } from "@/lib/api";

/**
 * Same workspace as Default — same models, same "Write my own" override —
 * with one difference: a plain "Clean this image" resolves to a different
 * built-in prompt (NEW_CLEANING_PROMPT, see backend/src/prompts/imageCleaning.js)
 * rather than Default's. That's the whole point of a second mode.
 */
export default function CleaningNewPage() {
  return (
    <CleaningWorkspace modelOptions={CLEANING_MODELS} defaultModel={DEFAULT_CLEANING_MODEL} promptVariant="new" />
  );
}
