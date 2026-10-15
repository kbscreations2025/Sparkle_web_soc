"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import { Eraser, ImagePlus, Maximize2, Palette, Sparkles, Upload, X } from "lucide-react";
import { ErrorBanner, RunButton } from "@/components/studio/ToolChrome";
import { GenerationResults } from "@/components/studio/GenerationResults";
import { ImageCountSelector } from "@/components/studio/ImageCountSelector";
import { InlineModelSelect } from "@/components/studio/InlineModelSelect";
import { ImagePreviewLayer, type PreviewImage } from "@/components/studio/ImagePreviewLayer";
import { ToolAccessNotice } from "@/components/studio/ToolAccessNotice";
import {
  CLEANING_MODELS,
  DEFAULT_CLEANING_MODEL,
  fetchProductBackgroundThemes,
  productBackground,
  refineProductBackground,
  toModelOptions,
  type ProductBackgroundChoice,
  type ProductBackgroundTheme,
  type ProductFraming,
  type ProductShadow,
} from "@/lib/api";
import { compressGraphic, compressImage, makeThumbnail } from "@/lib/image";
import { useGenerationWorkspace } from "@/lib/useGenerationWorkspace";
import { useAuth } from "@/lib/auth-context";
import { useModelQuality } from "@/lib/useModelQuality";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";

/**
 * Product Background: a piece of jewellery, a new background.
 *
 * Transparent, white and a colour are cut out of the photo's own pixels and
 * laid on exactly — the piece in the result is the piece in the photo, never
 * redrawn. A scene is generated around the piece by an image model. Both land
 * in the same results screen, where a follow-up can change the background
 * further.
 */

const PERMISSION = "tool.product_background.run";
const MODEL_OPTIONS = toModelOptions(CLEANING_MODELS);
const SCENE_COUNT_OPTIONS = [1, 2, 3, 4] as const;

type Mode = "transparent" | "white" | "color" | "theme";

const CHECKER = "repeating-conic-gradient(#e6e1d9 0% 25%, #faf8f5 0% 50%) 50% / 12px 12px";

const MODES: { id: Mode; label: string; hint: string; swatch: string }[] = [
  { id: "transparent", label: "Transparent", hint: "PNG cutout", swatch: CHECKER },
  { id: "white", label: "White", hint: "Pure #FFFFFF", swatch: "#ffffff" },
  { id: "color", label: "Colour", hint: "Any colour, exact", swatch: "conic-gradient(#f2ddd3, #e4ece4, #e3ecf5, #efe4cf, #14213d, #f2ddd3)" },
  { id: "theme", label: "Scene", hint: "Styled setting", swatch: "linear-gradient(135deg, #f4f4f2, #d9d9d6 45%, #f7f7f5 60%, #cfcfcb)" },
];

/** Colours a jewellery catalogue reaches for — the picker beside them takes any other. */
const COLOURS = [
  { hex: "#F7F2EC", name: "Cream" },
  { hex: "#F2DDD3", name: "Blush" },
  { hex: "#EFE4CF", name: "Champagne" },
  { hex: "#E4ECE4", name: "Sage" },
  { hex: "#E3ECF5", name: "Sky" },
  { hex: "#D9D9D9", name: "Light grey" },
  { hex: "#2B2620", name: "Charcoal" },
  { hex: "#14213D", name: "Navy" },
  { hex: "#7A1F2B", name: "Wine" },
  { hex: "#000000", name: "Black" },
];

/** A look for each scene tile — presentation only; the scene itself is described on the server. */
const THEME_SWATCHES: Record<string, string> = {
  marble: "linear-gradient(135deg, #f4f4f2, #d9d9d6 45%, #f7f7f5 60%, #cfcfcb)",
  velvet: "radial-gradient(circle at 30% 30%, #2f7d5c, #0d3b2a)",
  silk: "linear-gradient(120deg, #f3e3c9, #d9bf96 50%, #f6e9d4)",
  podium: "linear-gradient(180deg, #f3e6e1 62%, #e2cfc4 62%)",
  wood: "linear-gradient(90deg, #7a4f2d, #a26b3f 40%, #6b4224)",
  stone: "linear-gradient(135deg, #4a4f56, #22262b)",
  mirror: "linear-gradient(180deg, #121212 55%, #2c2c2c 55%, #070707)",
  botanical: "radial-gradient(circle at 70% 30%, #8cc07a, #2d5a27)",
  bridal: "radial-gradient(circle at 40% 40%, #ffffff, #efe2e2)",
  festive: "radial-gradient(circle at 30% 40%, #ffd36e, #b8742a 60%, #5a2d0c)",
  beach: "linear-gradient(180deg, #5fc3d6 45%, #f1dfb8 45%)",
  gradient: "linear-gradient(180deg, #f7efe5, #e8d8c4)",
};

const SHADOWS: { id: ProductShadow; label: string; hint: string }[] = [
  { id: "none", label: "None", hint: "Just the piece" },
  { id: "natural", label: "From photo", hint: "Keeps the photo's own shadow" },
  { id: "soft", label: "Soft", hint: "A gentle drop shadow" },
];

const FRAMINGS: { id: ProductFraming; label: string; hint: string }[] = [
  { id: "original", label: "As photographed", hint: "Same frame as your photo" },
  { id: "square", label: "Square, centred", hint: "Even margin — ready for listings" },
];

const REFINE_HINTS = ["Make the background a soft blush pink", "Add a gentle reflection under the piece", "Try a dark velvet setting", "Give it more space around the piece"];

export default function ProductBackgroundPage() {
  const { user } = useAuth();

  const [photo, setPhoto] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("transparent");
  const [hex, setHex] = useState("#F7F2EC");
  const [shadow, setShadow] = useState<ProductShadow>("none");
  const [framing, setFraming] = useState<ProductFraming>("original");
  const [themes, setThemes] = useState<ProductBackgroundTheme[]>([]);
  const [theme, setTheme] = useState("marble");
  const [sceneNotes, setSceneNotes] = useState("");
  const [backdrop, setBackdrop] = useState<string | null>(null);
  const [model, setModel] = useState<string>(DEFAULT_CLEANING_MODEL);
  const [quality, setQuality] = useModelQuality(model);
  const [count, setCount] = useState(1);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<PreviewImage | null>(null);
  /** Whether the run on screen asked for transparency — its result is shown over a checkerboard. */
  const [showChecker, setShowChecker] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const backdropInput = useRef<HTMLInputElement>(null);

  const workspace = useGenerationWorkspace({
    tool: "product_background",
    resumeLabel: "Change the background",
    onRefine: (body) => refineProductBackground({ ...body, model, quality }),
  });
  const { setError } = workspace;

  useEffect(() => {
    let cancelled = false;
    fetchProductBackgroundThemes().then((res) => {
      if (!cancelled && res.status === "success" && res.themes) setThemes(res.themes);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!can(user, PERMISSION)) {
    return <ToolAccessNotice tool="Product Background" />;
  }

  async function accept(file: File | undefined) {
    if (!file) return;
    try {
      // Keeps a PNG's transparency, so an existing cutout can be recoloured.
      setPhoto(await compressGraphic(file, 2048));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that file");
    }
  }

  async function acceptBackdrop(file: File | undefined) {
    if (!file) return;
    try {
      setBackdrop(await compressImage(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that file");
    }
  }

  const isScene = mode === "theme";
  const customScene = isScene && theme === "custom";
  const canRun = Boolean(photo) && (!customScene || Boolean(sceneNotes.trim()) || Boolean(backdrop));

  const choice: ProductBackgroundChoice =
    mode === "transparent"
      ? { kind: "transparent" }
      : mode === "white"
        ? { kind: "white" }
        : mode === "color"
          ? { kind: "color", hex }
          : { kind: "theme", theme, prompt: sceneNotes.trim() || undefined };

  const themeLabel = themes.find((entry) => entry.id === theme)?.label;
  const runLabel =
    mode === "transparent"
      ? "Remove the background"
      : mode === "white"
        ? "Put it on white"
        : mode === "color"
          ? "Put it on this colour"
          : count > 1
            ? `Create ${count} scenes`
            : "Create the scene";
  const promptLabel =
    mode === "transparent"
      ? "Remove the background"
      : mode === "white"
        ? "Put it on a white background"
        : mode === "color"
          ? `Put it on ${COLOURS.find((entry) => entry.hex === hex)?.name ?? hex}`
          : backdrop
            ? "Place it in my background photo"
            : customScene
              ? sceneNotes.trim()
              : `${themeLabel ?? "Styled"} scene${sceneNotes.trim() ? ` — ${sceneNotes.trim()}` : ""}`;

  async function handleRun() {
    if (!photo || !canRun) return;
    const thumb = await makeThumbnail(photo);
    setShowChecker(mode === "transparent");
    workspace.generate(
      () =>
        productBackground({
          image: photo,
          background: choice,
          shadow,
          framing,
          ...(isScene ? { model, quality, count, ...(backdrop ? { backdropImage: backdrop } : {}) } : {}),
          preview: thumb,
        }),
      { count: isScene ? count : 1, prompt: promptLabel, images: isScene && backdrop ? [photo, backdrop] : [photo] }
    );
  }

  if (workspace.status !== "idle") {
    const shown = workspace.displayImg ?? "";
    // A thread reopened from History says what it was in its opening turn
    // ("Cut out on a transparent background") — this page's own state only
    // knows about runs started here.
    const transparentThread =
      showChecker || workspace.history.some((message) => message.role === "user" && /transparent/i.test(message.content ?? ""));
    const extension = /\.png($|\?)/i.test(shown) || shown.startsWith("data:image/png") ? "png" : "jpg";
    return (
      <GenerationResults
        workspace={workspace}
        modelOptions={MODEL_OPTIONS}
        modelValue={model}
        onModelChange={setModel}
        qualityValue={quality}
        onQualityChange={setQuality}
        hints={REFINE_HINTS}
        busyLabel={isScene ? `Creating ${count > 1 ? `${count} scenes` : "the scene"}…` : "Cutting out your piece…"}
        resetLabel="New photo"
        downloadName={`product-background.${extension}`}
        modelLabel={isScene ? CLEANING_MODELS.find((entry) => entry.id === model)?.label : "Sparkle Cutout"}
        checkerboard={transparentThread}
      />
    );
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <ErrorBanner message={workspace.error} />

      <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8">
        <div className="mx-auto max-w-3xl space-y-6">
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              accept(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <input
            ref={backdropInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              acceptBackdrop(event.target.files?.[0]);
              event.target.value = "";
            }}
          />

          {/* The photo */}
          {photo ? (
            <div className="relative overflow-hidden rounded-xl border border-white/10" style={{ background: CHECKER }}>
              <button
                type="button"
                onClick={() => setPreview({ src: photo, key: "photo" })}
                title="Preview this photo"
                className="group relative block aspect-[4/3] w-full"
              >
                <Image src={photo} alt="Your piece" fill sizes="(max-width: 768px) 100vw, 720px" className="object-contain" />
                <span className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-lg border border-white/15 bg-black/55 px-2 py-1 text-[10px] font-medium text-white/85 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
                  <Maximize2 size={11} /> Preview
                </span>
              </button>
              <button
                type="button"
                onClick={() => setPhoto(null)}
                aria-label="Remove photo"
                className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white/85 backdrop-blur-sm transition-colors hover:bg-black/75"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                accept(event.dataTransfer.files?.[0]);
              }}
              className={cn(
                "flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-12 transition-colors",
                dragging ? "border-gold/40 bg-gold/[0.06]" : "border-white/[0.12] bg-white/[0.02] hover:border-white/25"
              )}
            >
              <Upload size={20} className="text-faint" />
              <p className="text-sm font-medium text-cream">Drop a product photo here, or click to choose</p>
              <p className="text-[11px] text-faint">Works best on a plain backdrop — busy photos are cleaned up first.</p>
            </button>
          )}

          {/* The background */}
          <Section label="Background">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {MODES.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setMode(entry.id)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-xl border p-2.5 text-left transition-colors",
                    mode === entry.id ? "border-gold/50 bg-gold/[0.08]" : "border-white/[0.08] bg-surface-raised hover:border-white/20"
                  )}
                >
                  <span className="h-9 w-9 shrink-0 rounded-lg border border-black/10" style={{ background: entry.swatch }} />
                  <span className="min-w-0">
                    <span className={cn("block text-[12px] font-semibold", mode === entry.id ? "text-gold" : "text-cream")}>{entry.label}</span>
                    <span className="block truncate text-[10px] text-faint">{entry.hint}</span>
                  </span>
                </button>
              ))}
            </div>
          </Section>

          {mode === "color" && (
            <Section label="Colour">
              <div className="flex flex-wrap items-center gap-2">
                {COLOURS.map((entry) => (
                  <button
                    key={entry.hex}
                    type="button"
                    title={`${entry.name} ${entry.hex}`}
                    onClick={() => setHex(entry.hex)}
                    className={cn(
                      "h-8 w-8 rounded-full border transition-shadow",
                      hex.toUpperCase() === entry.hex ? "border-gold ring-2 ring-gold/40" : "border-black/15 hover:ring-2 hover:ring-white/20"
                    )}
                    style={{ background: entry.hex }}
                  />
                ))}
                <label
                  title="Any colour"
                  className="relative h-8 w-8 cursor-pointer overflow-hidden rounded-full border border-black/15"
                  style={{ background: "conic-gradient(#f44, #fd4, #4d4, #4df, #44f, #f4f, #f44)" }}
                >
                  <input type="color" value={hex} onChange={(event) => setHex(event.target.value.toUpperCase())} className="absolute inset-0 cursor-pointer opacity-0" />
                </label>
                <span className="ml-1 flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-surface-raised px-2 py-1 font-mono text-[11px] text-cream">
                  <span className="h-3 w-3 rounded-full border border-black/15" style={{ background: hex }} />
                  {hex}
                </span>
              </div>
            </Section>
          )}

          {!isScene && (
            <div className="grid gap-6 sm:grid-cols-2">
              <Section label="Shadow">
                <Segmented options={SHADOWS} value={shadow} onChange={setShadow} />
              </Section>
              <Section label="Framing">
                <Segmented options={FRAMINGS} value={framing} onChange={setFraming} />
              </Section>
            </div>
          )}

          {isScene && (
            <>
              <Section label="Scene">
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
                  {themes.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => setTheme(entry.id)}
                      title={entry.hint}
                      className={cn(
                        "overflow-hidden rounded-xl border text-left transition-colors",
                        theme === entry.id ? "border-gold/60 ring-1 ring-gold/40" : "border-white/[0.08] hover:border-white/25"
                      )}
                    >
                      <span className="block h-12 w-full" style={{ background: THEME_SWATCHES[entry.id] ?? "#ddd" }} />
                      <span className={cn("block truncate px-2 py-1 text-[11px] font-medium", theme === entry.id ? "text-gold" : "text-cream")}>
                        {entry.label}
                      </span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setTheme("custom")}
                    className={cn(
                      "overflow-hidden rounded-xl border text-left transition-colors",
                      theme === "custom" ? "border-gold/60 ring-1 ring-gold/40" : "border-white/[0.08] hover:border-white/25"
                    )}
                  >
                    <span className="flex h-12 w-full items-center justify-center bg-white/[0.04] text-faint">
                      <Sparkles size={16} />
                    </span>
                    <span className={cn("block truncate px-2 py-1 text-[11px] font-medium", theme === "custom" ? "text-gold" : "text-cream")}>
                      Your own
                    </span>
                  </button>
                </div>
              </Section>

              <Section label={customScene ? "Describe the scene" : "Add details (optional)"}>
                <textarea
                  value={sceneNotes}
                  onChange={(event) => setSceneNotes(event.target.value.slice(0, 600))}
                  rows={2}
                  placeholder={
                    customScene
                      ? "e.g. on a rose-gold tray beside a cup of chai, morning light"
                      : "e.g. warmer light, a few pearls scattered nearby"
                  }
                  className="w-full resize-none rounded-xl border border-white/[0.08] bg-surface-raised px-3 py-2 text-[12px] text-cream placeholder:text-faint focus:border-gold/30 focus:outline-none"
                />
              </Section>

              <Section label="Your own background photo (optional)">
                {backdrop ? (
                  <div className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-surface-raised p-2">
                    <span className="relative h-14 w-20 shrink-0 overflow-hidden rounded-lg border border-white/10">
                      <Image src={backdrop} alt="Background" fill sizes="80px" className="object-cover" />
                    </span>
                    <p className="flex-1 text-[11px] text-faint">The piece will be placed into this photo, matching its light and perspective.</p>
                    <button
                      type="button"
                      onClick={() => setBackdrop(null)}
                      aria-label="Remove background photo"
                      className="flex h-7 w-7 items-center justify-center rounded-full text-faint hover:bg-white/[0.06] hover:text-cream"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => backdropInput.current?.click()}
                    className="flex w-full items-center gap-2 rounded-xl border border-dashed border-white/[0.12] px-3 py-2.5 text-[12px] text-faint transition-colors hover:border-white/25 hover:text-cream"
                  >
                    <ImagePlus size={15} /> Add a photo of a setting — a shelf, a tray, a shop window…
                  </button>
                )}
              </Section>

              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-surface-raised px-3 py-2.5">
                <ImageCountSelector count={count} onChange={setCount} options={SCENE_COUNT_OPTIONS} />
                <InlineModelSelect models={CLEANING_MODELS} value={model} onChange={setModel} showQuality quality={quality} onQualityChange={setQuality} />
              </div>
            </>
          )}

          <RunButton
            onClick={handleRun}
            disabled={!canRun}
            icon={mode === "transparent" ? <Eraser size={14} /> : isScene ? <Sparkles size={14} /> : <Palette size={14} />}
          >
            {runLabel}
          </RunButton>

          <p className="text-[11px] leading-relaxed text-faint">
            {isScene
              ? "Scenes are generated around your piece, which is kept exactly as photographed. Ask for changes in the chat afterwards."
              : "Transparent, white and colour use your photo's own pixels — the piece is cut out, never redrawn, so every stone and detail stays exactly as photographed."}
          </p>
        </div>
      </div>

      <ImagePreviewLayer preview={preview} onClose={() => setPreview(null)} onSave={(marked) => setPhoto(marked)} downloadName="photo.png" />
    </div>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-medium uppercase tracking-widest text-faint">{label}</p>
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string; hint: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex rounded-xl border border-white/[0.08] bg-surface-raised p-1">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            className={cn(
              "flex-1 rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors",
              value === option.id ? "bg-gold/15 text-gold" : "text-muted hover:text-cream"
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="text-[10px] text-faint">{options.find((option) => option.id === value)?.hint}</p>
    </div>
  );
}
