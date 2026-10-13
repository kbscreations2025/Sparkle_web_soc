"use client";

import { Suspense } from "react";
import { AffinityWorkspace } from "@/components/studio/AffinityWorkspace";

/** Several pieces turned into a catalog deck — see AffinityWorkspace. */
export default function AffinityPage() {
  return (
    <Suspense fallback={<div className="flex-1 px-8 py-8 text-sm text-muted">Loading…</div>}>
      <AffinityWorkspace kind="affinity" />
    </Suspense>
  );
}
