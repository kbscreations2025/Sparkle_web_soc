"use client";

import { useCallback, useRef, useState } from "react";
import { Check, ChevronDown, ImagePlus, RefreshCw, Trash2 } from "lucide-react";
import { FONT_LIST, fontOf } from "@/lib/lookbook/fonts";
import type { ResolvedTheme } from "@/lib/lookbook/theme";
import type { FontId, LookbookTheme } from "@/lib/lookbook/types";
import { useDismissable } from "@/lib/useEscapeKey";
import { cn } from "@/lib/utils";
import { ColorField, Field, Range, Section, Segmented, TextInput, Toggle } from "./controls";

type PageSettingsProps = {
  theme: LookbookTheme;
  resolved: ResolvedTheme;
  setTheme: (patch: Partial<LookbookTheme>, coalesce?: string) => void;
  pickLogo: () => void;
};

/** The whole page's look: the brand, colours, type and spacing. */
export function PageSettings({ theme, resolved, setTheme, pickLogo }: PageSettingsProps) {
  const swatches = [resolved.colors.bg, resolved.colors.surface, resolved.colors.text, resolved.colors.heading, resolved.colors.accent, "#FFFFFF", "#000000"];
  const color = (key: keyof LookbookTheme) => (value: string | null) => value && setTheme({ [key]: value } as Partial<LookbookTheme>, `color:${key}`);
  const headingFont = fontOf(theme.headingFont);
  const displayFont = fontOf(theme.displayFont);

  return (
    <div>
      <Section title="Brand">
        <Field label="Logo" hint="A PNG with a clear background works best.">
          <div className="flex items-center gap-2.5">
            <button type="button" onClick={pickLogo} className="flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/[0.08] p-1" style={{ background: resolved.colors.bg }}>
              {theme.logo ? (
                // eslint-disable-next-line @next/next/no-img-element -- the logo's own file, transparency intact
                <img src={theme.logo.url} alt="" className="max-h-full max-w-full object-contain" />
              ) : (
                <ImagePlus size={16} className="text-faint" />
              )}
            </button>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={pickLogo} className="flex items-center gap-1 rounded-md border border-white/[0.08] px-2 py-1 text-[11.5px] font-medium text-cream hover:border-gold/40">
                <RefreshCw size={11} /> {theme.logo ? "Replace" : "Add logo"}
              </button>
              {theme.logo && (
                <button type="button" onClick={() => setTheme({ logo: null })} className="flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] text-faint hover:text-red-400">
                  <Trash2 size={11} /> Remove
                </button>
              )}
            </div>
          </div>
        </Field>
        <Field label="Brand name" hint="Shown at the top of the page, beside the logo or on its own.">
          <TextInput value={theme.brandName} onChange={(brandName) => setTheme({ brandName }, "brandName")} placeholder="Your brand" />
        </Field>
        <Field label="Position">
          <Segmented
            value={theme.logoPlacement}
            options={[
              { id: "left", label: "Left" },
              { id: "center", label: "Centre" },
              { id: "right", label: "Right" },
              { id: "hidden", label: "Hide" },
            ]}
            onChange={(logoPlacement) => setTheme({ logoPlacement })}
          />
        </Field>
        {theme.logo && (
          <Field label="Logo size">
            <Range value={theme.logoSize} min={20} max={120} step={2} onChange={(logoSize) => setTheme({ logoSize }, "logoSize")} format={(value) => `${value}px`} />
          </Field>
        )}
      </Section>

      <Section title="Colours">
        <Field label="Page background">
          <ColorField value={theme.bgColor} onChange={color("bgColor")} swatches={swatches} />
        </Field>
        <Field label="Background style">
          <Segmented
            value={theme.background}
            options={[
              { id: "solid", label: "Solid" },
              { id: "glow", label: "Glow" },
              { id: "gradient", label: "Gradient" },
            ]}
            onChange={(background) => setTheme({ background })}
          />
        </Field>
        <Field label="Soft background" hint="Cards set to a soft background.">
          <ColorField value={theme.surfaceColor} onChange={color("surfaceColor")} swatches={swatches} />
        </Field>
        <Field label="Titles">
          <ColorField value={theme.headingColor} onChange={color("headingColor")} swatches={swatches} />
        </Field>
        <Field label="Text">
          <ColorField value={theme.textColor} onChange={color("textColor")} swatches={swatches} />
        </Field>
        <Field label="Quiet text" hint="Captions, labels and small print.">
          <ColorField value={theme.mutedColor} onChange={color("mutedColor")} swatches={swatches} />
        </Field>
        <Field label="Accent" hint="Buttons, small headings and ornaments.">
          <ColorField value={theme.accentColor} onChange={color("accentColor")} swatches={swatches} />
        </Field>
        <Field label="Words on accent buttons">
          <ColorField value={theme.accentTextColor} onChange={color("accentTextColor")} swatches={swatches} />
        </Field>
      </Section>

      <Section title="Fonts">
        <Field label="Big titles" hint="The hero's name.">
          <FontPicker value={theme.displayFont} onChange={(displayFont) => setTheme({ displayFont })} />
        </Field>
        <Field label="Titles">
          <FontPicker value={theme.headingFont} onChange={(headingFont) => setTheme({ headingFont })} />
        </Field>
        <Field label="Text">
          <FontPicker value={theme.bodyFont} onChange={(bodyFont) => setTheme({ bodyFont })} />
        </Field>
        {(headingFont.variable || displayFont.variable) && (
          <Field label="Title weight">
            <Range value={theme.headingWeight} min={300} max={900} step={100} onChange={(headingWeight) => setTheme({ headingWeight }, "weight")} />
          </Field>
        )}
        <Field label="Titles in capitals" inline>
          <Toggle checked={theme.headingUppercase} onChange={(headingUppercase) => setTheme({ headingUppercase })} />
        </Field>
        <Field label="Title letter spacing">
          <Range value={Math.round(theme.headingTracking * 100)} min={-4} max={30} onChange={(value) => setTheme({ headingTracking: value / 100 }, "tracking")} format={(value) => `${value / 100}em`} />
        </Field>
        <Field label="Text size">
          <Range value={theme.baseSize} min={13} max={21} onChange={(baseSize) => setTheme({ baseSize }, "baseSize")} format={(value) => `${value}px`} />
        </Field>
      </Section>

      <Section title="Spacing" defaultOpen={false}>
        <Field label="Corners">
          <Range value={theme.radius} min={0} max={40} onChange={(radius) => setTheme({ radius }, "radius")} format={(value) => `${value}px`} />
        </Field>
        <Field label="Space between cards">
          <Range value={theme.gap} min={0} max={120} step={4} onChange={(gap) => setTheme({ gap }, "gap")} format={(value) => `${value}px`} />
        </Field>
        <Field label="Content width" hint="How wide the page gets on a large screen.">
          <Range value={theme.maxWidth} min={720} max={1440} step={20} onChange={(maxWidth) => setTheme({ maxWidth }, "maxWidth")} format={(value) => `${value}px`} />
        </Field>
      </Section>
    </div>
  );
}

/** A font list where each name is set in its own face. */
function FontPicker({ value, onChange }: { value: FontId; onChange: (value: FontId) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismissable(ref, open, close);
  const current = fontOf(value);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-white/[0.08] bg-white/[0.03] px-2.5 text-left hover:border-gold/30"
      >
        <span className="truncate text-[15px] text-cream" style={{ fontFamily: current.family }}>
          {current.label}
        </span>
        <ChevronDown size={13} className="shrink-0 text-faint" />
      </button>
      {open && (
        <div className="slim-scrollbar absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border border-white/[0.1] bg-surface-raised p-1 shadow-xl">
          {(["serif", "display", "script", "sans"] as const).map((category) => (
            <div key={category}>
              <p className="px-2 pb-0.5 pt-1.5 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-faint">{category === "sans" ? "Sans serif" : category}</p>
              {FONT_LIST.filter((font) => font.category === category).map((font) => (
                <button
                  key={font.id}
                  type="button"
                  onClick={() => {
                    onChange(font.id);
                    setOpen(false);
                  }}
                  className={cn("flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left hover:bg-white/[0.05]", font.id === value && "bg-gold/10")}
                >
                  <span className="text-[16px] text-cream" style={{ fontFamily: font.family }}>
                    {font.label}
                  </span>
                  {font.id === value && <Check size={12} className="text-gold" />}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
