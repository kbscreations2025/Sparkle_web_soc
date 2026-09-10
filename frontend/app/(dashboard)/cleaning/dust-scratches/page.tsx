"use client";

import { CleaningWorkspace } from "@/components/studio/CleaningWorkspace";
import { GPT_CLEANING_MODELS, DEFAULT_GPT_CLEANING_MODEL } from "@/lib/api";

/**
 * Same workspace, same cleaning prompt as Default — only the model is
 * different: this one always runs on OpenAI's `gpt-image-1` rather than
 * Gemini, so a side-by-side comparison on the same photo doesn't require
 * switching tools.
 */
export default function CleaningDustScratchesPage() {
  return (
    <CleaningWorkspace
      title="Dust & Scratches"
      description="Clear specks, fibres and hairline marks — via GPT Image, same studio-clean prompt"
      modelOptions={GPT_CLEANING_MODELS}
      defaultModel={DEFAULT_GPT_CLEANING_MODEL}
    />
  );
}
