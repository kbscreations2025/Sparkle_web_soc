"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { ImagePlus, Pencil, Wand2, X } from "lucide-react";
import { ImageCountSelector } from "@/components/studio/ImageCountSelector";
import { PromptCard } from "@/components/studio/PromptCard";
import { ErrorBanner, RunButton } from "@/components/studio/ToolChrome";
import { GenerationResults } from "@/components/studio/GenerationResults";
import { InlineModelSelect } from "@/components/studio/InlineModelSelect";
import { OptionChips } from "@/components/studio/OptionChips";
import { AspectChips } from "@/components/studio/AspectChips";
import { JewelryBuilder, JewelrySelectionChips, useJewelryBuilder } from "@/components/studio/JewelryBuilder";
import { ImagePreviewLayer, type PreviewImage } from "@/components/studio/ImagePreviewLayer";
import {
  textToSketch,
  refineOn,
  SPARKLE_MODELS,
  DEFAULT_SPARKLE_MODEL,
  toModelOptions,
  type SparkleModelId,
} from "@/lib/api";
import {
  ASPECTS,
  SKETCH_STYLES,
  TEXT_COUNT_OPTIONS,
  DEFAULT_IMAGE_COUNT,
  type AspectId,
  type SketchStyleId,
} from "@/lib/jewelryConfigurator";
import { compressImage } from "@/lib/image";
import { useGenerationWorkspace } from "@/lib/useGenerationWorkspace";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/permissions";
import { ToolAccessNotice } from "@/components/studio/ToolAccessNotice";

const PERMISSION = "tool.text_to_sketch.run";
const MODEL_OPTIONS = toModelOptions(SPARKLE_MODELS);
const refineSketch = refineOn("/api/text-to-sketch");

const REFINE_HINTS = [
  "Add more shading and depth",
  "Make the center stone larger",
  "Add a diamond halo",
  "Sharpen the linework and detail",
];

export default function TextToSketchPage() {
  const { user } = useAuth();

  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState<SketchStyleId>("pencil");
  const [aspect, setAspect] = useState<AspectId>("square");
  const [model, setModel] = useState<SparkleModelId>(DEFAULT_SPARKLE_MODEL);
  const [count, setCount] = useState<number>(DEFAULT_IMAGE_COUNT);
  /** An optional photo the design is drawn from, separate from chat attachments. */
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewImage | null>(null);
  const referenceInput = useRef<HTMLInputElement>(null);

  const builder = useJewelryBuilder();
  const workspace = useGenerationWorkspace({ tool: "text_to_sketch", onRefine: (body) => refineSketch({ ...body, model }) });

  // The builder and the free text are independent: either can be used alone,
  // and typing never clobbers a selection or the other way round.
  const finalDescription = [builder.text, prompt.trim()].filter(Boolean).join(", ");

  if (!can(user, PERMISSION)) {
    return <ToolAccessNotice tool="Text to Sketch" />;
  }

  async function pickReference(file: File) {
    try {
      setReferenceImage(await compressImage(file));
    } catch (err) {
      workspace.setError(err instanceof Error ? err.message : "Could not read that file");
    }
  }

  function handleGenerate() {
    workspace.generate(
      () =>
        textToSketch({
          prompt: finalDescription,
          model,
          style,
          aspect,
          count,
          referenceImage: referenceImage ?? undefined,
        }),
      { count, prompt: finalDescription }
    );
  }

  if (workspace.status !== "idle") {
    return (
      <GenerationResults
        workspace={workspace}
        modelOptions={MODEL_OPTIONS}
        modelValue={model}
        onModelChange={setModel}
        hints={REFINE_HINTS}
        busyLabel={`Sketching ${count > 1 ? `${count} designs` : "your design"}…`}
        resetLabel="New sketch"
        downloadName="sketch.png"
        modelLabel={SPARKLE_MODELS.find((entry) => entry.id === model)?.label}
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
              Reference Photo <span className="font-normal normal-case text-faint">(optional)</span>
            </p>
            <input
              ref={referenceInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) pickReference(file);
                event.target.value = "";
              }}
            />
            {referenceImage ? (
              <div className="relative inline-block">
                {/* Opens the same preview-and-annotate surface the results use, so
                    a reference can be marked up before it is drawn from. */}
                <button
                  type="button"
                  onClick={() => setPreview({ src: referenceImage, key: "reference" })}
                  title="Preview or annotate this reference"
                  className="group relative block h-16 w-16 overflow-hidden rounded-lg border border-white/10 transition-colors hover:border-gold/40"
                >
                  <Image src={referenceImage} alt="Reference" fill sizes="64px" className="object-cover" />
                  <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
                    <Pencil size={13} className="text-white" />
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setReferenceImage(null)}
                  aria-label="Remove reference"
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-white/10 bg-surface-float text-faint transition-colors hover:text-cream"
                >
                  <X size={10} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => referenceInput.current?.click()}
                className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2 text-[11px] text-muted transition-colors hover:border-white/[0.14] hover:text-cream"
              >
                <ImagePlus size={13} /> Start from a photo
              </button>
            )}
          </div>

          <JewelrySelectionChips builder={builder} />

          <div className="space-y-1">
            <PromptCard
              label="Description"
              value={prompt}
              onChange={setPrompt}
              rows={4}
              placeholder="Pick options in the Jewelry Builder, or type freely…"
              footerStart={<ImageCountSelector count={count} onChange={setCount} options={TEXT_COUNT_OPTIONS} />}
              footerEnd={<InlineModelSelect models={SPARKLE_MODELS} value={model} onChange={setModel} />}
            />

            <RunButton onClick={handleGenerate} icon={<Wand2 size={14} />}>
              {count > 1 ? `Sketch ${count} designs` : "Sketch design"}
            </RunButton>
          </div>
        </div>
      </div>

      <ImagePreviewLayer
        preview={preview}
        onClose={() => setPreview(null)}
        onSave={(marked) => setReferenceImage(marked)}
        downloadName="reference.jpg"
      />
    </div>
  );
}
