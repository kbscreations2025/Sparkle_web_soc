"use client";

import { CleaningWorkspace, DEFAULT_CLEANING_NOTES } from "@/components/studio/CleaningWorkspace";
import { CLEANING_MODELS, DEFAULT_CLEANING_MODEL } from "@/lib/api";

export default function CleaningDefaultPage() {
  return (
    <CleaningWorkspace
      modelOptions={CLEANING_MODELS}
      defaultModel={DEFAULT_CLEANING_MODEL}
      defaultNotes={DEFAULT_CLEANING_NOTES}
    />
  );
}
