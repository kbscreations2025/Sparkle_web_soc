"use client";

import { CleaningWorkspace } from "@/components/studio/CleaningWorkspace";
import { CLEANING_MODELS, DEFAULT_CLEANING_MODEL } from "@/lib/api";

export default function CleaningDefaultPage() {
  return (
    <CleaningWorkspace modelOptions={CLEANING_MODELS} defaultModel={DEFAULT_CLEANING_MODEL} />
  );
}
