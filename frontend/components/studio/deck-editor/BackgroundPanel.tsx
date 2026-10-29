"use client";

import { useRef, useState } from "react";
import { Crosshair, Trash2, Upload } from "lucide-react";
import type { AffinityPiece } from "@/lib/affinity";
import { BRAND_COLORS, backgroundSource, type PageScope, type SlideBackgroundImage } from "@/lib/deckDesign";
import { compressGraphic } from "@/lib/image";
import { cn } from "@/lib/utils";
import type { EditorApi } from "./DeckEditor";
import { ScopeSwitch, useScope } from "./ScopeSwitch";

const PAGE_COLORS = [...BRAND_COLORS, "#F3E9DC", "#E8E1D6", "#1C1814", "#0F1B2D"];

/** Where a watermark can be dropped in one click — corners, edges and centre. */
const SPOTS: [number, number][] = [
  [-35, -30],
  [0, -30],
  [35, -30],
  [-35, 0],
  [0, 0],
  [35, 0],
  [-35, 30],
  [0, 30],
  [35, 30],
];

/**
 * The page's backdrop: its colour, and a picture behind everything —
 * full-bleed, or a faint watermark that can be any size and sit anywhere,
 * even partly off the page. Every change goes to the pages chosen at the
 * top: this page, its whole category, or the whole deck.
 *
 * Unlike an image element, a backdrop can't be clicked or dragged, so it
 * never gets in the way of working on what sits over it.
 */
export function BackgroundPanel({ api, pieces }: { api: EditorApi; pieces: AffinityPiece[] }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<PageScope>("page");
  const { effective: effectiveScope, reach } = useScope(api, scope);
  const slide = api.slide;
  const image = slide.backgroundImage ?? null;
  const current = image ? backgroundSource(image, pieces) : "";

  /** A fresh picture starts as a soft watermark — the usual reason to put one behind a page. */
  function choose(source: { pieceIndex?: number; src?: string }) {
    api.setBackgroundImage(
      {
        opacity: image?.opacity ?? 0.12,
        mode: image?.mode ?? "watermark",
        size: image?.size ?? 70,
        offsetX: image?.offsetX ?? 0,
        offsetY: image?.offsetY ?? 0,
        ...source,
      },
      effectiveScope
    );
  }

  function update(patch: Partial<SlideBackgroundImage>) {
    if (image) api.setBackgroundImage({ ...image, ...patch }, effectiveScope);
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      choose({ src: await compressGraphic(file) });
    } finally {
      setBusy(false);
    }
  }

  const photos = pieces.map((piece, index) => ({ index, image: piece.image })).filter((entry) => entry.image);

  return (
    <>
      {/* Where every change below goes. */}
      <ScopeSwitch api={api} scope={scope} onScope={setScope} className="sticky top-0 z-10 bg-white px-2.5 pb-1.5 pt-2">
        <p className="mb-1 text-[12px] font-semibold">Backdrop</p>
      </ScopeSwitch>

      <div className="space-y-3 px-2.5 pb-3 text-[10px]">
        {/* Colour — the last swatch opens any colour. */}
        <section>
          <Heading>Colour</Heading>
          {/* Phones: every colour in one row of small swatches; wider screens: two rows. */}
          <div className="grid grid-cols-12 gap-1 lg:grid-cols-6">
            {[...new Set([...(api.design.brand?.colors ?? []), ...PAGE_COLORS])].map((color) => (
              <button
                key={color}
                type="button"
                title={color}
                onClick={() => api.setBackground(color, effectiveScope)}
                className={cn(
                  "aspect-square rounded-full border",
                  slide.background.toLowerCase() === color.toLowerCase() ? "border-[#8B5CF6] ring-2 ring-[#8B5CF6]/30" : "border-black/15"
                )}
                style={{ background: color }}
              />
            ))}
            <label
              title="Any colour"
              className="relative aspect-square cursor-pointer overflow-hidden rounded-full border border-black/15"
              style={{ background: "conic-gradient(#f44, #fd4, #4d4, #4df, #44f, #f4f, #f44)" }}
            >
              <input
                type="color"
                value={/^#[0-9a-f]{6}$/i.test(slide.background) ? slide.background : "#ffffff"}
                onChange={(event) => api.setBackground(event.target.value, effectiveScope)}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
            </label>
          </div>
        </section>

        {/* Picture */}
        <section>
          <Heading>Picture</Heading>

          {image && current ? (
            <div className="space-y-1.5 rounded-md border border-black/10 p-1.5">
              <div className="flex gap-1.5">
                <div
                  className="relative w-[88px] shrink-0 overflow-hidden rounded border border-black/10"
                  style={{ background: slide.background, aspectRatio: "16 / 9" }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- a picture already in the deck */}
                  <img
                    src={current}
                    alt=""
                    className="absolute"
                    style={
                      image.mode === "fill"
                        ? { inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: image.opacity }
                        : {
                            width: `${image.size}%`,
                            height: `${image.size}%`,
                            left: `${(100 - image.size) / 2 + (image.offsetX ?? 0)}%`,
                            top: `${(100 - image.size) / 2 + (image.offsetY ?? 0)}%`,
                            objectFit: "contain",
                            opacity: image.opacity,
                          }
                    }
                  />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  {(["watermark", "fill"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => update({ mode })}
                      className={cn(
                        "flex-1 rounded border",
                        image.mode === mode ? "border-[#8B5CF6] bg-[#8B5CF6]/10 text-[#5B3FB0]" : "border-black/10 hover:bg-black/5"
                      )}
                    >
                      {mode === "watermark" ? "Watermark" : "Fill page"}
                    </button>
                  ))}
                </div>
              </div>

              <Row label="Opacity" value={Math.round(image.opacity * 100)} min={2} max={100} onChange={(value) => update({ opacity: value / 100 })} />

              {image.mode === "watermark" && (
                <>
                  {/* Past 100% the picture is bigger than the page — only part of it shows, as a crop. */}
                  <Row label="Size" value={image.size} min={10} max={300} onChange={(size) => update({ size })} />
                  <Row label="↔" title="Left / right" value={image.offsetX ?? 0} min={-100} max={100} onChange={(offsetX) => update({ offsetX })} />
                  <Row label="↕" title="Up / down" value={image.offsetY ?? 0} min={-100} max={100} onChange={(offsetY) => update({ offsetY })} />
                  <div className="flex items-center gap-1.5">
                    <div className="grid w-[39px] grid-cols-3 gap-px" title="Quick positions">
                      {SPOTS.map(([x, y]) => {
                        const on = (image.offsetX ?? 0) === x && (image.offsetY ?? 0) === y;
                        return (
                          <button
                            key={`${x},${y}`}
                            type="button"
                            onClick={() => update({ offsetX: x, offsetY: y })}
                            className={cn("h-2.5 rounded-[2px] border", on ? "border-[#8B5CF6] bg-[#8B5CF6]/40" : "border-black/15 hover:bg-black/10")}
                          />
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={() => update({ offsetX: 0, offsetY: 0 })}
                      className="flex items-center gap-1 rounded px-1 py-0.5 text-black/60 hover:bg-black/5 hover:text-black"
                    >
                      <Crosshair size={10} /> Centre
                    </button>
                    <button
                      type="button"
                      onClick={() => api.setBackgroundImage(null, effectiveScope)}
                      title={reach > 1 ? `Remove from ${reach} pages` : "Remove"}
                      className="ml-auto flex items-center gap-1 rounded px-1 py-0.5 text-black/60 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 size={10} /> Remove
                    </button>
                  </div>
                </>
              )}
              {image.mode === "fill" && (
                <button
                  type="button"
                  onClick={() => api.setBackgroundImage(null, effectiveScope)}
                  className="flex items-center gap-1 rounded px-1 py-0.5 text-black/60 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 size={10} /> Remove{reach > 1 ? ` from ${reach} pages` : ""}
                </button>
              )}
            </div>
          ) : (
            <p className="mb-1 leading-snug text-black/45 max-lg:hidden">Pick a picture below — it starts as a soft watermark.</p>
          )}

          <input ref={input} type="file" accept="image/*" hidden onChange={(event) => { upload(event.target.files?.[0]); event.target.value = ""; }} />
          <div className="mt-1.5 grid grid-cols-6 gap-1 md:grid-cols-10 lg:grid-cols-4">
            <button
              type="button"
              onClick={() => input.current?.click()}
              disabled={busy}
              title="Upload a picture — a logo, a texture…"
              className="flex aspect-square flex-col items-center justify-center gap-0.5 rounded-md border border-dashed border-[#6B5D42]/50 text-[9px] text-[#6B5D42] hover:bg-[#F7F2EC] disabled:opacity-50"
            >
              <Upload size={12} />
              {busy ? "…" : "Upload"}
            </button>
            {photos.map(({ index, image: src }) => (
              <button
                key={index}
                type="button"
                onClick={() => choose({ pieceIndex: index })}
                className={cn(
                  "aspect-square overflow-hidden rounded-md border bg-white",
                  image?.pieceIndex === index && !image.src ? "border-[#8B5CF6] ring-2 ring-[#8B5CF6]/30" : "border-black/10 hover:border-[#6B5D42]"
                )}
                title="Put behind the chosen pages"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- a picture already in the deck */}
                <img src={src} alt="" className="h-full w-full object-contain" />
              </button>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

function Heading({ children }: { children: string }) {
  return <p className="mb-1 text-[9px] uppercase tracking-wider text-black/40">{children}</p>;
}

/** Label, slider and value on one line. */
function Row({
  label,
  title,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  title?: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex items-center gap-1.5" title={title ?? label}>
      <span className="w-[38px] shrink-0 text-black/60">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="slim-range min-w-0 flex-1"
        style={{ "--fill": `${((value - min) / (max - min)) * 100}%` } as React.CSSProperties}
      />
      <span className="w-[30px] shrink-0 text-right tabular-nums">{value}%</span>
    </label>
  );
}
