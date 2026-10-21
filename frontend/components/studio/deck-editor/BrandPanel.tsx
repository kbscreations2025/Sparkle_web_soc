"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, Upload, X } from "lucide-react";
import {
  BRAND_LOGO_NAME,
  FONTS,
  SLIDE_H,
  SLIDE_W,
  fontStack,
  imageElement,
  type DeckBrand,
  type DeckDesign,
  type LogoCorner,
  type PageScope,
} from "@/lib/deckDesign";
import { compressGraphic } from "@/lib/image";
import { cn } from "@/lib/utils";
import type { EditorApi } from "./DeckEditor";
import { ScopeSwitch, useScope } from "./ScopeSwitch";

const EMPTY: DeckBrand = { logos: [], colors: [] };

const CORNERS: { id: LogoCorner; label: string }[] = [
  { id: "top-left", label: "Top left" },
  { id: "top-right", label: "Top right" },
  { id: "bottom-left", label: "Bottom left" },
  { id: "bottom-right", label: "Bottom right" },
];

/** A picture's width ÷ height. */
function aspectOf(src: string) {
  return new Promise<number>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth / Math.max(1, img.naturalHeight) || 1);
    img.onerror = () => resolve(1);
    img.src = src;
  });
}

/**
 * The house style: logos, colours and fonts, kept with the deck and
 * remembered in this browser for the next one.
 *
 * A logo can be dropped on the page like any picture, or stamped into the
 * same corner of this page, its category, or every page at once — and
 * stamped again to move or resize it everywhere, since a re-stamp replaces
 * the last one rather than adding a second.
 */
export function BrandPanel({ api }: { api: EditorApi }) {
  const brand = api.design.brand ?? EMPTY;
  const logoInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<PageScope>("all");
  const { effective, reach } = useScope(api, scope);

  const [logo, setLogo] = useState(0);
  const [corner, setCorner] = useState<LogoCorner>("top-right");
  const [width, setWidth] = useState(150);
  const [opacity, setOpacity] = useState(100);
  const colorInput = useRef<HTMLInputElement>(null);
  // A native colour picker reports its final choice with "change" as it closes — the moment to add it.
  const latestBrand = useRef(brand);
  useEffect(() => {
    latestBrand.current = brand;
  });
  useEffect(() => {
    const node = colorInput.current;
    if (!node) return;
    const add = () => {
      const current = latestBrand.current;
      if (!current.colors.includes(node.value)) api.setBrand({ ...current, colors: [...current.colors, node.value] });
    };
    node.addEventListener("change", add);
    return () => node.removeEventListener("change", add);
  }, [api]);
  const chosenLogo = brand.logos[Math.min(logo, brand.logos.length - 1)];

  // Each logo's proportions, measured once, so a live resize can set its height without waiting.
  const aspects = useRef(new Map<string, number>());
  useEffect(() => {
    for (const src of brand.logos) if (!aspects.current.has(src)) aspectOf(src).then((ratio) => aspects.current.set(src, ratio));
  }, [brand.logos]);
  const aspectFor = (src: string) => aspects.current.get(src) ?? 1;

  const slides = api.design.slides;
  const scopePages = api.pagesFor(effective);
  const placedInScope = scopePages.filter((i) => slides[i]?.elements.some((element) => element.name === BRAND_LOGO_NAME)).length;
  const placed = placedInScope > 0;

  // With a logo already on this page, the controls show that logo's own corner, size and opacity.
  const here = api.slide.elements.find((element) => element.name === BRAND_LOGO_NAME);
  const shown = here
    ? {
        corner: `${here.y < SLIDE_H / 2 ? "top" : "bottom"}-${here.x < SLIDE_W / 2 ? "left" : "right"}` as LogoCorner,
        width: Math.round(here.w),
        opacity: Math.round(here.opacity * 100),
      }
    : { corner, width, opacity };

  /** The drag a live change belongs to, so the whole drag is one undo step. */
  const dragStart = useRef<DeckDesign | null>(null);

  /** A change to corner, size or opacity — shown straight away on every page that already has the logo. */
  function adjust(next: Partial<typeof shown>, live = false) {
    const settings = { ...shown, ...next };
    setCorner(settings.corner);
    setWidth(settings.width);
    setOpacity(settings.opacity);
    if (!placed || !chosenLogo) return;
    api.placeLogo(chosenLogo, aspectFor(chosenLogo), settings.corner, settings.width, settings.opacity / 100, effective, {
      live: live && dragStart.current !== null,
      onlyExisting: true,
    });
  }

  const dragHandlers = {
    onStart: () => {
      dragStart.current = api.designRef.current;
    },
    onEnd: () => {
      if (dragStart.current) api.commitFrom(dragStart.current);
      dragStart.current = null;
    },
  };

  async function uploadLogos(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      const added: string[] = [];
      for (const file of [...files]) added.push(await compressGraphic(file, 1200));
      api.setBrand({ ...brand, logos: [...brand.logos, ...added] });
      setLogo(brand.logos.length);
    } finally {
      setBusy(false);
    }
  }

  async function dropOnPage(src: string) {
    const aspect = await aspectOf(src);
    const w = 220;
    const h = Math.round(w / aspect);
    api.addElements([imageElement({ x: (SLIDE_W - w) / 2, y: (SLIDE_H - h) / 2, w, h, src, fit: "contain", name: "Logo" })]);
  }

  async function stamp() {
    if (!chosenLogo) return;
    const aspect = await aspectOf(chosenLogo);
    aspects.current.set(chosenLogo, aspect);
    api.placeLogo(chosenLogo, aspect, shown.corner, shown.width, shown.opacity / 100, effective);
  }

  return (
    <>
      <div className="sticky top-0 z-10 bg-white px-2.5 pb-1.5 pt-2">
        <p className="text-[12px] font-semibold">Brand</p>
        <p className="text-[9px] leading-snug text-black/45 max-lg:hidden">Saved with this deck, and remembered for your next one.</p>
      </div>

      <div className="space-y-3 px-2.5 pb-3 text-[10px]">
        {/* Logos */}
        <section>
          <Heading>Logos</Heading>
          <input ref={logoInput} type="file" accept="image/*" multiple hidden onChange={(event) => { uploadLogos(event.target.files); event.target.value = ""; }} />
          {/* Phones: small tiles, six to a row. */}
          <div className="grid grid-cols-6 gap-1 md:grid-cols-10 lg:grid-cols-3">
            {brand.logos.map((src, index) => (
              <div key={index} className="group/logo relative">
                <button
                  type="button"
                  onClick={() => {
                    setLogo(index);
                    // Already placed? Swap the picture in where it sits.
                    if (placed) api.placeLogo(src, aspectFor(src), shown.corner, shown.width, shown.opacity / 100, effective, { onlyExisting: true });
                  }}
                  onDoubleClick={() => dropOnPage(src)}
                  title="Click to choose for the corners below · double-click to drop it on this page"
                  className={cn(
                    "flex aspect-square w-full items-center justify-center rounded-md border p-1.5",
                    index === logo ? "border-[#8B5CF6] ring-2 ring-[#8B5CF6]/30" : "border-black/10 hover:border-[#6B5D42]"
                  )}
                  style={{ background: "repeating-conic-gradient(#f1eee9 0 25%, #fff 0 50%) 50% / 10px 10px" }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- the person's own logo */}
                  <img src={src} alt="" className="max-h-full max-w-full object-contain" />
                </button>
                <button
                  type="button"
                  title="Remove this logo from the brand"
                  onClick={() => {
                    api.setBrand({ ...brand, logos: brand.logos.filter((_, i) => i !== index) });
                    setLogo(0);
                  }}
                  className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-white text-black/60 shadow group-hover/logo:flex hover:text-red-600"
                >
                  <X size={9} />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => logoInput.current?.click()}
              disabled={busy}
              className="flex aspect-square flex-col items-center justify-center gap-0.5 rounded-md border border-dashed border-[#6B5D42]/50 text-[9px] text-[#6B5D42] hover:bg-[#F7F2EC] disabled:opacity-50"
            >
              <Upload size={12} />
              {busy ? "…" : brand.logos.length ? "Add" : "Upload logo"}
            </button>
          </div>
          {brand.logos.length > 0 && (
            <button type="button" onClick={() => chosenLogo && dropOnPage(chosenLogo)} className="mt-1 text-[#6B5D42] hover:underline">
              + Drop the chosen logo on this page
            </button>
          )}
        </section>

        {/* Logo on every page */}
        {brand.logos.length > 0 && (
          <section className="space-y-1.5 rounded-md border border-black/10 p-1.5">
            <Heading>Logo in a corner</Heading>
            <ScopeSwitch api={api} scope={scope} onScope={setScope} />
            <div className="grid grid-cols-2 gap-1">
              {CORNERS.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => adjust({ corner: id })}
                  className={cn(
                    "rounded border py-1",
                    shown.corner === id ? "border-[#8B5CF6] bg-[#8B5CF6]/10 text-[#5B3FB0]" : "border-black/10 hover:bg-black/5"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <Row label="Size" value={shown.width} min={40} max={420} suffix="px" onChange={(value) => adjust({ width: value }, true)} {...dragHandlers} />
            <Row label="Opacity" value={shown.opacity} min={10} max={100} suffix="%" onChange={(value) => adjust({ opacity: value }, true)} {...dragHandlers} />
            {placed && <p className="text-[9px] leading-snug text-black/45">Changes show live on the {placedInScope > 1 ? `${placedInScope} pages` : "page"} with the logo.</p>}
            <div className="flex gap-1">
              <button
                type="button"
                onClick={stamp}
                className="flex-1 rounded-md bg-[#6B5D42] py-1.5 font-medium text-white hover:opacity-90"
                title="Run again with a new corner or size to move it — it replaces the last one"
              >
                {placedInScope === reach ? "Re-apply" : placed ? "Add to all" : "Add"} on {reach > 1 ? `${reach} pages` : "this page"}
              </button>
              {placed && (
                <button
                  type="button"
                  onClick={() => api.removeLogos(effective)}
                  title="Take the corner logo off these pages"
                  className="flex items-center justify-center rounded-md border border-black/10 px-2 text-black/60 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 size={11} />
                </button>
              )}
            </div>
          </section>
        )}

        {/* Colours */}
        <section>
          <Heading>Brand colours</Heading>
          <div className="grid grid-cols-12 gap-1 lg:grid-cols-6">
            {brand.colors.map((color) => (
              <button
                key={color}
                type="button"
                title={`${color} — click to remove`}
                onClick={() => api.setBrand({ ...brand, colors: brand.colors.filter((entry) => entry !== color) })}
                className="group/c relative aspect-square rounded-full border border-black/15"
                style={{ background: color }}
              >
                <X size={9} className="absolute inset-0 m-auto hidden text-white mix-blend-difference group-hover/c:block" />
              </button>
            ))}
            <label
              title="Add a colour"
              className="relative flex aspect-square cursor-pointer items-center justify-center rounded-full border border-dashed border-black/30 text-black/50 hover:border-[#6B5D42]"
            >
              <Plus size={11} />
              <input ref={colorInput} type="color" defaultValue="#6B5D42" className="absolute inset-0 cursor-pointer opacity-0" />
            </label>
          </div>
          <p className="mt-1 leading-snug text-black/45 max-lg:hidden">Shown first in every colour picker.</p>
        </section>

        {/* Fonts */}
        <section className="space-y-1">
          <Heading>Brand fonts</Heading>
          {/* Phones: the two pickers side by side. */}
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-1 lg:gap-1">
            <FontRow label="Headings" value={brand.headingFont ?? "Cambria"} onChange={(headingFont) => api.setBrand({ ...brand, headingFont })} />
            <FontRow label="Body" value={brand.bodyFont ?? "Helvetica"} onChange={(bodyFont) => api.setBrand({ ...brand, bodyFont })} />
          </div>
          {/* With logos, the switch above (in the corner-logo box) sets the pages for both. */}
          {brand.logos.length === 0 && <ScopeSwitch api={api} scope={scope} onScope={setScope} />}
          <button
            type="button"
            onClick={() => api.applyFonts(brand.headingFont ?? "Cambria", brand.bodyFont ?? "Helvetica", effective)}
            className="w-full rounded-md border border-black/10 py-1.5 hover:bg-black/5"
            title="Large text takes the heading font, everything else the body font"
          >
            Apply fonts to {reach > 1 ? `${reach} pages` : "this page"}
          </button>
        </section>
      </div>
    </>
  );
}

function Heading({ children }: { children: string }) {
  return <p className="mb-1 text-[9px] uppercase tracking-wider text-black/40">{children}</p>;
}

function FontRow({ label, value, onChange }: { label: string; value: string; onChange: (font: string) => void }) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="shrink-0 text-black/60 lg:w-[48px]">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-6 min-w-0 flex-1 rounded border border-black/15 bg-white px-1 text-[10px] focus:outline-none"
        style={{ fontFamily: fontStack(value) }}
      >
        {FONTS.map((font) => (
          <option key={font} value={font} style={{ fontFamily: fontStack(font) }}>
            {font}
          </option>
        ))}
      </select>
    </label>
  );
}

function Row({
  label,
  value,
  min,
  max,
  suffix,
  onChange,
  onStart,
  onEnd,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix: string;
  onChange: (value: number) => void;
  onStart?: () => void;
  onEnd?: () => void;
}) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="w-[38px] shrink-0 text-black/60">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onPointerDown={onStart}
        onPointerUp={onEnd}
        onChange={(event) => onChange(Number(event.target.value))}
        className="slim-range min-w-0 flex-1"
        style={{ "--fill": `${((value - min) / (max - min)) * 100}%` } as React.CSSProperties}
      />
      <span className="w-[34px] shrink-0 text-right tabular-nums">
        {value}
        {suffix}
      </span>
    </label>
  );
}
