"use client";

import { CleaningWorkspace } from "@/components/studio/CleaningWorkspace";
import { CLEANING_MODELS, NEW_CLEANING_MODELS, DEFAULT_CLEANING_MODEL } from "@/lib/api";

/** Every model from both other cards, so either family can be tried here. */
const SHANK_MODELS = [...CLEANING_MODELS, ...NEW_CLEANING_MODELS];

/**
 * Same workspace again, with its own built-in prompt that cleans only the
 * ring's shank (SHANK_CLEANING_PROMPT, see backend/src/prompts/shankCleaning.js).
 */
export default function CleaningShankPage() {
  return (
    <CleaningWorkspace
      modelOptions={SHANK_MODELS}
      defaultModel={DEFAULT_CLEANING_MODEL}
      promptVariant="shank"
    />
  );
}
