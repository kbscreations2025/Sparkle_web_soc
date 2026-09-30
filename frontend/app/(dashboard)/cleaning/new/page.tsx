"use client";

import { CleaningWorkspace } from "@/components/studio/CleaningWorkspace";
import { NEW_CLEANING_MODELS, DEFAULT_NEW_CLEANING_MODEL } from "@/lib/api";

/**
 * Same workspace as Default, same "Write my own" override, with two
 * differences: a plain "Clean this image" resolves to a different built-in
 * prompt (NEW_CLEANING_PROMPT, see backend/src/prompts/imageCleaning.js), and
 * it runs on OpenRouter's GPT image models instead of Gemini's.
 */
export default function CleaningNewPage() {
  return (
    <CleaningWorkspace
      modelOptions={NEW_CLEANING_MODELS}
      defaultModel={DEFAULT_NEW_CLEANING_MODEL}
      promptVariant="new"
    />
  );
}
