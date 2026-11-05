"use client";

import { Suspense } from "react";
import { PresentationWorkspace } from "@/components/studio/PresentationWorkspace";

/**
 * Presentation: drop in anything — Excel, an old PowerPoint, PDFs, Word,
 * photos — and get a designed deck back, then refine it by chat. See
 * PresentationWorkspace.
 */
export default function PresentationPage() {
  return (
    <Suspense fallback={<div className="flex-1 px-8 py-8 text-sm text-muted">Loading…</div>}>
      <PresentationWorkspace />
    </Suspense>
  );
}
