"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { fetchHistoryItem, fetchMarketingKit } from "./api";

/**
 * For the image kits that have no kit view of their own — Charm Shots and
 * Styled on Model reopen in their page's chat, where a shot is retouched by
 * typing — a `?kitId=` link is turned into that chat (`?conversationId=`).
 *
 * Such links still arrive: a History kit tile clicked before its run has
 * loaded, or a link saved earlier. The kit names its run (`generationId`), and
 * the run names its thread.
 *
 * `resolving` while the run is looked up; `failed` when the kit has no run
 * to reopen (its save failed), so the page can say so instead of hanging.
 *
 * Callers sit inside `<Suspense>`: `useSearchParams` suspends.
 */
export function useKitOpensInChat(path: string) {
  const kitId = useSearchParams().get("kitId");
  const router = useRouter();
  const [failedKitId, setFailedKitId] = useState<string | null>(null);

  useEffect(() => {
    if (!kitId) return;
    let cancelled = false;

    (async () => {
      try {
        const kitRes = await fetchMarketingKit(kitId);
        const generationId = kitRes.status === "success" ? kitRes.kit?.generationId : null;
        const itemRes = generationId ? await fetchHistoryItem(generationId) : null;
        const conversationId = itemRes?.status === "success" ? itemRes.item?.conversationId : null;
        if (cancelled) return;
        if (conversationId) router.replace(`${path}?conversationId=${conversationId}`);
        else setFailedKitId(kitId);
      } catch {
        if (!cancelled) setFailedKitId(kitId);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [kitId, path, router]);

  const failed = Boolean(kitId) && failedKitId === kitId;
  return { resolving: Boolean(kitId) && !failed, failed };
}
