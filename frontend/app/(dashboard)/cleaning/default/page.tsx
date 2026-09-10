"use client";

import { CleaningWorkspace } from "@/components/studio/CleaningWorkspace";
import { CLEANING_MODELS, DEFAULT_CLEANING_MODEL } from "@/lib/api";

export default function CleaningDefaultPage() {
  return (
    <CleaningWorkspace
      title="Image Cleaning"
      description="Upload jewellery photos · get a studio-grade clean, then refine it in chat"
      modelOptions={CLEANING_MODELS}
      defaultModel={DEFAULT_CLEANING_MODEL}
    />
  );
}
