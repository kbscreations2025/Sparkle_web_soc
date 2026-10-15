"use client";

import { Cinzel, Dancing_Script, Great_Vibes, Montserrat, Playfair_Display, Poiret_One } from "next/font/google";
import { Shuffle } from "lucide-react";
import { POSTER_FONTS } from "@/lib/festiveEvents";
import { cn } from "@/lib/utils";

/*
 * The fonts the picker previews in — the same styles the backend describes to
 * the model (prompts/festivePoster.js). The model can't load a font file, so
 * the poster's lettering is its rendering of the style, close but not identical.
 */
const playfair = Playfair_Display({ subsets: ["latin"], weight: ["500"], display: "swap" });
const greatVibes = Great_Vibes({ subsets: ["latin"], weight: "400", display: "swap" });
const cinzel = Cinzel({ subsets: ["latin"], weight: ["500"], display: "swap" });
const montserrat = Montserrat({ subsets: ["latin"], weight: ["300"], display: "swap" });
const poiret = Poiret_One({ subsets: ["latin"], weight: "400", display: "swap" });
const dancing = Dancing_Script({ subsets: ["latin"], weight: ["500"], display: "swap" });

const PREVIEW_CLASS: Record<string, string> = {
  classic_serif: playfair.className,
  script: greatVibes.className,
  engraved: `${cinzel.className} uppercase tracking-[0.12em]`,
  modern_sans: `${montserrat.className} uppercase tracking-[0.2em]`,
  art_deco: poiret.className,
  handwritten: dancing.className,
};

export type PosterText = {
  enabled: boolean;
  headline: string;
  subtitle: string;
  tagline: string;
  font: string;
  placement: "left" | "center" | "right";
};

/**
 * The words on a festive poster and the font they are set in — previewed in
 * each font with the poster's own headline, so the choice is made by eye.
 * An empty line is written by the AI for the event.
 */
export function PosterTextCard({
  value,
  onChange,
  suggested,
}: {
  value: PosterText;
  onChange: (next: PosterText) => void;
  /** The event's ready-made headline and tagline. */
  suggested: { headline: string; tagline: string };
}) {
  const set = (patch: Partial<PosterText>) => onChange({ ...value, ...patch });
  const sample = value.headline.trim() || suggested.headline;

  return (
    <section className="space-y-3 rounded-xl border border-white/[0.08] bg-surface-raised p-3">
      <label className="flex cursor-pointer items-center justify-between gap-3">
        <span>
          <span className="block text-xs font-semibold uppercase tracking-wider text-cream">Text on the poster</span>
          <span className="block text-[11px] text-faint">A headline in a beautiful font — or leave it off and add your own later.</span>
        </span>
        <input type="checkbox" checked={value.enabled} onChange={(event) => set({ enabled: event.target.checked })} className="h-4 w-4 accent-gold" />
      </label>

      {value.enabled && (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="Headline" value={value.headline} placeholder={`AI writes it — e.g. ${suggested.headline}`} max={60} onChange={(headline) => set({ headline })} />
            <Field label="Subtitle" value={value.subtitle} placeholder="AI writes it — e.g. Curated Jewellery Designs" max={60} onChange={(subtitle) => set({ subtitle })} />
            <Field label="Tagline" value={value.tagline} placeholder={`AI writes it — e.g. ${suggested.tagline}`} max={90} onChange={(tagline) => set({ tagline })} />
          </div>

          <div className="space-y-1.5">
            <p className="text-[10px] font-medium uppercase tracking-widest text-faint">Font</p>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {POSTER_FONTS.map((font) => (
                <button
                  key={font.id}
                  type="button"
                  onClick={() => set({ font: font.id })}
                  className={cn(
                    "flex h-[68px] flex-col justify-between rounded-lg border px-2.5 py-2 text-left transition-colors",
                    value.font === font.id ? "border-gold/60 bg-gold/[0.08] ring-1 ring-gold/30" : "border-white/[0.08] hover:border-white/25"
                  )}
                >
                  <span className={cn("block truncate text-[19px] leading-tight text-[#8a5a2b]", PREVIEW_CLASS[font.id])}>{sample}</span>
                  <span className={cn("text-[10px]", value.font === font.id ? "text-gold" : "text-faint")}>{font.label}</span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => set({ font: "surprise" })}
                className={cn(
                  "flex h-[68px] flex-col justify-between rounded-lg border px-2.5 py-2 text-left transition-colors",
                  value.font === "surprise" ? "border-gold/60 bg-gold/[0.08] ring-1 ring-gold/30" : "border-dashed border-white/[0.14] hover:border-white/25"
                )}
              >
                <Shuffle size={18} className="text-[#8a5a2b]" />
                <span className={cn("text-[10px]", value.font === "surprise" ? "text-gold" : "text-faint")}>Surprise me — a different one per version</span>
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] font-medium uppercase tracking-widest text-faint">Position</span>
            <div className="flex rounded-lg border border-white/[0.08] p-0.5">
              {(["left", "center", "right"] as const).map((placement) => (
                <button
                  key={placement}
                  type="button"
                  onClick={() => set({ placement })}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-[11px] capitalize transition-colors",
                    value.placement === placement ? "bg-gold/15 text-gold" : "text-muted hover:text-cream"
                  )}
                >
                  {placement === "center" ? "Centre" : placement}
                </button>
              ))}
            </div>
          </div>
          <p className="text-[10px] leading-relaxed text-faint">
            The model draws the lettering in this style, so it will be close to the preview rather than identical. Check the spelling on
            the result — ask in the chat to fix anything.
          </p>
        </>
      )}
    </section>
  );
}

function Field({ label, value, placeholder, max, onChange }: { label: string; value: string; placeholder: string; max: number; onChange: (value: string) => void }) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] font-medium uppercase tracking-widest text-faint">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value.slice(0, max))}
        placeholder={placeholder}
        className="w-full rounded-lg border border-white/[0.10] bg-white/[0.03] px-2.5 py-1.5 text-[12px] text-cream placeholder:text-faint focus:border-gold/40 focus:outline-none"
      />
    </label>
  );
}
