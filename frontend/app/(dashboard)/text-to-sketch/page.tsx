"use client";

import { useState } from "react";
import { useStoredImageCount } from "@/lib/useStoredImageCount";
import { Wand2 } from "lucide-react";
import { ImageCountSelector } from "@/components/studio/ImageCountSelector";
import { PromptCard } from "@/components/studio/PromptCard";
import { ErrorBanner, RunButton } from "@/components/studio/ToolChrome";
import { GenerationResults } from "@/components/studio/GenerationResults";
import { InlineModelSelect } from "@/components/studio/InlineModelSelect";
import { Chip, OptionChips } from "@/components/studio/OptionChips";
import { AspectChips } from "@/components/studio/AspectChips";
import { JewelryBuilder, JewelrySelectionChips, useJewelryBuilder } from "@/components/studio/JewelryBuilder";
import { ReferencePhotoField, useReferencePhoto } from "@/components/studio/ReferencePhotoField";
import {
  textToSketch,
  refineOn,
  OPTIONAL_IMAGE_MODELS,
  DEFAULT_OPTIONAL_IMAGE_MODEL,
  toModelOptions,
  type OptionalImageModelId,
} from "@/lib/api";
import {
  ASPECTS,
  SKETCH_STYLES,
  TEXT_COUNT_OPTIONS,
  DEFAULT_IMAGE_COUNT,
  type AspectId,
  type SketchStyleId,
} from "@/lib/jewelryConfigurator";
import { useGenerationWorkspace } from "@/lib/useGenerationWorkspace";
import { useAuth } from "@/lib/auth-context";
import { useModelQuality } from "@/lib/useModelQuality";
import { can } from "@/lib/permissions";
import { ToolAccessNotice } from "@/components/studio/ToolAccessNotice";

const PERMISSION = "tool.text_to_sketch.run";
const MODEL_OPTIONS = toModelOptions(OPTIONAL_IMAGE_MODELS);
const refineSketch = refineOn<string>("/api/text-to-sketch");

const REFINE_HINTS = [
  "Add more shading and depth",
  "Make the center stone larger",
  "Add a diamond halo",
  "Sharpen the linework and detail",
];

/** Optional angles to lay out side by side in a single sketch sheet. */
const VIEW_OPTIONS = [
  { id: "front", label: "Front view" },
  { id: "side", label: "Side view" },
  { id: "top", label: "Top view" },
  { id: "back", label: "Back view" },
  { id: "three-quarter", label: "3/4 perspective" },
  { id: "detail", label: "Close-up detail" },
] as const;
type ViewId = (typeof VIEW_OPTIONS)[number]["id"];

/** Empty when no views are picked, so the prompt is exactly what it was before. */
function viewsInstruction(views: ViewId[]) {
  if (views.length === 0) return "";
  const labels = VIEW_OPTIONS.filter((v) => views.includes(v.id)).map((v) => v.label.toLowerCase());
  return `show the same piece in a single image as a multi-view design sheet with these views arranged neatly side by side: ${labels.join(", ")}`;
}

export default function TextToSketchPage() {
  const { user } = useAuth();

  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState<SketchStyleId>("pencil");
  const [aspect, setAspect] = useState<AspectId>("square");
  const [model, setModel] = useState<OptionalImageModelId>(DEFAULT_OPTIONAL_IMAGE_MODEL);
  const [quality, setQuality] = useModelQuality(model);
  // Remembered in this browser until changed — see useStoredImageCount.
  const [count, setCount] = useStoredImageCount("text", TEXT_COUNT_OPTIONS, DEFAULT_IMAGE_COUNT);
  const [views, setViews] = useState<ViewId[]>([]);

  function toggleView(id: ViewId) {
    setViews((current) => (current.includes(id) ? current.filter((v) => v !== id) : [...current, id]));
  }

  const builder = useJewelryBuilder();
  const workspace = useGenerationWorkspace({ tool: "text_to_sketch", onRefine: (body) => refineSketch({ ...body, model, quality }) });
  /** An optional photo the design is drawn from, separate from chat attachments. */
  const reference = useReferencePhoto(workspace.setError);

  // The builder and the free text are independent: either can be used alone,
  // and typing never clobbers a selection or the other way round.
  const finalDescription = [builder.text, prompt.trim()].filter(Boolean).join(", ");

  if (!can(user, PERMISSION)) {
    return <ToolAccessNotice tool="Text to Sketch" />;
  }

  function handleGenerate() {
    const promptWithViews = [finalDescription, viewsInstruction(views)].filter(Boolean).join(", ");
    workspace.generate(
      () =>
        textToSketch({
          prompt: promptWithViews,
          model,
          quality,
          style,
          aspect,
          count,
          referenceImage: reference.photo ?? undefined,
        }),
      { count, prompt: finalDescription, images: reference.photo ? [reference.photo] : [] }
    );
  }

  if (workspace.status !== "idle") {
    return (
      <GenerationResults
        workspace={workspace}
        modelOptions={MODEL_OPTIONS}
        modelValue={model}
        onModelChange={setModel}
        qualityValue={quality}
        onQualityChange={setQuality}
        hints={REFINE_HINTS}
        busyLabel={`Sketching ${count > 1 ? `${count} designs` : "your design"}…`}
        resetLabel="New sketch"
        downloadName="sketch.png"
        modelLabel={OPTIONAL_IMAGE_MODELS.find((entry) => entry.id === model)?.label}
      />
    );
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <ErrorBanner message={workspace.error} />

      <div className="flex flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
        <JewelryBuilder builder={builder} subtitle="Select to build the design brief" onClear={() => setPrompt("")} />

        {/* ── Sketch options ── */}
        <div className="flex-1 space-y-5 px-4 py-5 sm:px-6 md:overflow-y-auto md:px-7">
          <OptionChips label="Sketch Style" options={SKETCH_STYLES} value={style} onChange={setStyle} />
          <AspectChips options={ASPECTS} value={aspect} onChange={setAspect} />

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-cream">
              Views <span className="font-normal normal-case tracking-normal text-muted">(optional, shown in one image)</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {VIEW_OPTIONS.map((option) => (
                <Chip key={option.id} label={option.label} active={views.includes(option.id)} onClick={() => toggleView(option.id)} />
              ))}
            </div>
          </div>

          <ReferencePhotoField photo={reference.photo} onPick={reference.pick} onChange={reference.setPhoto} />

          <div className="space-y-1">
            <PromptCard
              label="Description"
              value={prompt}
              onChange={setPrompt}
              rows={4}
              placeholder="Pick options in the Jewelry Builder, or type freely…"
              // A pasted photo is the reference photo, not text — same as
              // "Start from a photo", just without leaving the keyboard.
              onPasteImage={reference.pick}
              topSlot={builder.selectedCount > 0 ? <JewelrySelectionChips builder={builder} /> : undefined}
              footerStart={<ImageCountSelector count={count} onChange={setCount} options={TEXT_COUNT_OPTIONS} />}
              footerEnd={<InlineModelSelect models={OPTIONAL_IMAGE_MODELS} value={model} onChange={setModel} showQuality quality={quality} onQualityChange={setQuality} />}
            />

            <RunButton
              onClick={handleGenerate}
              // Nothing to work from yet: the builder starts empty.
              disabled={!finalDescription && !reference.photo}
              icon={<Wand2 size={14} />}
            >
              {count > 1 ? `Sketch ${count} designs` : "Sketch design"}
            </RunButton>
          </div>
        </div>
      </div>
    </div>
  );
}
