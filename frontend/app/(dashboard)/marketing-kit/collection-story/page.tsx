"use client";

import { Suspense } from "react";
import { AffinityWorkspace } from "@/components/studio/AffinityWorkspace";

/**
 * Collection Story: the Affinity deck under its own name, with its own saved
 * kits — same pieces, same catalog copy. See AffinityWorkspace.
 */
export default function CollectionStoryPage() {
  return (
    <Suspense fallback={<div className="flex-1 px-8 py-8 text-sm text-muted">Loading…</div>}>
      <AffinityWorkspace kind="collection_story" />
    </Suspense>
  );
}
