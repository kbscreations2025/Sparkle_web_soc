"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { Check, Download, Loader2, Save } from "lucide-react";
import { updateMarketingKit, type CampaignShot, type MarketingKit } from "@/lib/api";
import { downloadImage } from "@/lib/image";

/**
 * A saved Campaign Kit, reopened.
 *
 * Read-only apart from the captions — the four shots are what the run
 * produced, and rewriting a shot means generating a new one rather than
 * editing this record. Which is why only `caption` is sent on a save: the
 * backend refuses the rest for the same reason.
 */
export function CampaignKitDeck({ kit }: { kit: MarketingKit }) {
  const [shots, setShots] = useState<CampaignShot[]>(kit.campaign?.shots ?? []);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");

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
            {shots.length} shot{shots.length === 1 ? "" : "s"} · {new Date(kit.createdAt).toLocaleDateString()}
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
              <Image
                src={shot.thumbnailUrl || shot.url}
                alt={shot.label}
                fill
                sizes="(max-width: 640px) 100vw, 380px"
                className="object-cover"
              />
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
    </div>
  );
}
