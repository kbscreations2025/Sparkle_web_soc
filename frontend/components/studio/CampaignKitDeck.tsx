"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { Check, Download, Loader2, Maximize2, Save } from "lucide-react";
import { Lightbox } from "./Lightbox";
import { fetchMarketingKit, updateMarketingKit, type CampaignShot, type MarketingKit } from "@/lib/api";
import { downloadImage } from "@/lib/image";

/**
 * A saved Campaign Kit, reopened.
 *
 * Read-only apart from the captions — the four shots are what the run
 * produced, and rewriting a shot means generating a new one rather than
 * editing this record. Which is why only `caption` is sent on a save: the
 * backend refuses the rest for the same reason.
 */
export function CampaignKitDeck({
  kit,
  /** What one picture is called — a Festive kit holds posters, not shots. */
  noun = "shot",
}: {
  kit: MarketingKit;
  noun?: string;
}) {
  const [shots, setShots] = useState<CampaignShot[]>(kit.campaign?.shots ?? []);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");
  /** The picture open full size, for a close look. */
  const [preview, setPreview] = useState<CampaignShot | null>(null);

  // A different kit in the same mounted view — reset during render rather
  // than from an effect, so the old deck is never painted under the new id.
  const [openKitId, setOpenKitId] = useState(kit.id);
  if (kit.id !== openKitId) {
    setOpenKitId(kit.id);
    setShots(kit.campaign?.shots ?? []);
  }

  const save = useCallback(async () => {
    setSaving("saving");
    const res = await updateMarketingKit(kit.id, {
      shots: shots.map((shot) => ({ id: shot.id, caption: shot.caption })),
    });
    setSaving(res.status === "success" ? "saved" : "idle");
    if (res.status !== "success") setError(res.message || "Could not save those captions");
  }, [kit.id, shots]);

  useEffect(() => {
    if (saving !== "saved") return;
    const timer = setTimeout(() => setSaving("idle"), 1800);
    return () => clearTimeout(timer);
  }, [saving]);

  if (!kit.campaign) return null;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {error && <p className="rounded-lg border border-error/20 bg-error/[0.08] px-3 py-2 text-xs text-error">{error}</p>}

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-cream">{kit.title}</h2>
          <p className="text-[11px] text-faint">
            {shots.length} {noun}
            {shots.length === 1 ? "" : "s"} · {new Date(kit.createdAt).toLocaleDateString()}
          </p>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving === "saving"}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/[0.07] px-2.5 py-1.5 text-[11px] font-medium text-muted transition-colors hover:border-white/[0.14] hover:text-cream disabled:opacity-40"
        >
          {saving === "saved" ? <Check size={11} /> : saving === "saving" ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
          {saving === "saved" ? "Saved" : saving === "saving" ? "Saving…" : "Save captions"}
        </button>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2">
        {shots.map((shot) => (
          <li key={shot.id} className="space-y-2 rounded-xl border border-white/[0.08] bg-surface-raised p-2.5">
            <div className="group relative aspect-square overflow-hidden rounded-lg bg-white/[0.04]">
              <button
                type="button"
                onClick={() => setPreview(shot)}
                title={`Preview ${shot.label}`}
                aria-label={`Preview ${shot.label}`}
                className="absolute inset-0 cursor-zoom-in"
              >
                <Image src={shot.thumbnailUrl || shot.url} alt={shot.label} fill sizes="(max-width: 640px) 100vw, 380px" className="object-cover" />
              </button>
              <button
                type="button"
                onClick={() => setPreview(shot)}
                title={`Preview ${shot.label}`}
                aria-label={`Preview ${shot.label} full size`}
                className="absolute right-10 top-2 rounded-full bg-black/55 p-1.5 text-white/85 opacity-0 backdrop-blur-sm transition-opacity hover:bg-black/75 group-hover:opacity-100"
              >
                <Maximize2 size={12} />
              </button>
              <button
                type="button"
                onClick={() => downloadImage(shot.url, `${shot.id}.jpg`)}
                title={`Download ${shot.label}`}
                aria-label={`Download ${shot.label}`}
                className="absolute right-2 top-2 rounded-full bg-black/55 p-1.5 text-white/85 opacity-0 backdrop-blur-sm transition-opacity hover:bg-black/75 group-hover:opacity-100"
              >
                <Download size={12} />
              </button>
            </div>

            <p className="text-[10px] uppercase tracking-widest text-faint">{shot.label}</p>
            <input
              value={shot.caption}
              onChange={(event) =>
                setShots((current) =>
                  current.map((entry) => (entry.id === shot.id ? { ...entry, caption: event.target.value } : entry))
                )
              }
              placeholder="+ Add caption"
              className="w-full bg-transparent text-[12px] text-cream placeholder:text-faint/70 focus:outline-none"
            />
          </li>
        ))}
      </ul>

      {/* Full size, zoomable — the stored original, not the grid's thumbnail. */}
      <Lightbox src={preview?.url ?? null} onClose={() => setPreview(null)} downloadName={preview ? `${preview.id}.jpg` : undefined} />
    </div>
  );
}

/**
 * The saved kit a `?kitId=` link reopens — null for a new run, and until it
 * has loaded. Campaign Kit and Festive Poster both reopen theirs into
 * `CampaignKitDeck`, so only a kit with a `campaign` section counts.
 *
 * Callers sit inside `<Suspense>`: `useSearchParams` suspends.
 */
export function useReopenedCampaignKit() {
  const openKitId = useSearchParams().get("kitId");
  const [openKit, setOpenKit] = useState<MarketingKit | null>(null);

  useEffect(() => {
    if (!openKitId) return;
    let cancelled = false;

    fetchMarketingKit(openKitId).then((res) => {
      if (!cancelled && res.status === "success" && res.kit?.campaign) setOpenKit(res.kit);
    });

    return () => {
      cancelled = true;
    };
  }, [openKitId]);

  return openKit;
}
