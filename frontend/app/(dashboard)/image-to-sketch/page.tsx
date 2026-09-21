"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { Maximize2, PenLine, Upload, X } from "lucide-react";
import { ImageCountSelector } from "@/components/studio/ImageCountSelector";
import { ErrorBanner, RunButton } from "@/components/studio/ToolChrome";
import { GenerationResults } from "@/components/studio/GenerationResults";
import { InlineModelSelect } from "@/components/studio/InlineModelSelect";
import { OptionChips } from "@/components/studio/OptionChips";
import { ImagePreviewLayer, type PreviewImage } from "@/components/studio/ImagePreviewLayer";
import {
  imageToSketch,
  refineOn,
  SPARKLE_MODELS,
  DEFAULT_SPARKLE_MODEL,
  toModelOptions,
  type SparkleModelId,
} from "@/lib/api";
import {
  SKETCH_STYLES,
  PHOTO_COUNT_OPTIONS,
  DEFAULT_PHOTO_COUNT,
  type SketchStyleId,
} from "@/lib/jewelryConfigurator";
import { compressImage, makeThumbnail } from "@/lib/image";
import { useGenerationWorkspace } from "@/lib/useGenerationWorkspace";
import { useAuth } from "@/lib/auth-context";
import { useModelQuality } from "@/lib/useModelQuality";
import { can } from "@/lib/permissions";
import { ToolAccessNotice } from "@/components/studio/ToolAccessNotice";
import { cn } from "@/lib/utils";

const PERMISSION = "tool.image_to_sketch.run";
const MODEL_OPTIONS = toModelOptions(SPARKLE_MODELS);
const refineSketch = refineOn("/api/image-to-sketch");

const REFINE_HINTS = [
  "Add more shading and depth",
  "Sharpen the linework",
  "Deepen the contrast",
  "Soften the shading",
];

export default function ImageToSketchPage() {
  const { user } = useAuth();

  const [photo, setPhoto] = useState<string | null>(null);
  const [style, setStyle] = useState<SketchStyleId>("pencil");
  const [model, setModel] = useState<SparkleModelId>(DEFAULT_SPARKLE_MODEL);
  const [quality, setQuality] = useModelQuality(model);
  const [count, setCount] = useState<number>(DEFAULT_PHOTO_COUNT);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<PreviewImage | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const workspace = useGenerationWorkspace({
    tool: "image_to_sketch",
    resumeLabel: "Sketch this photo",
    onRefine: (body) => refineSketch({ ...body, model, quality }),
  });

  if (!can(user, PERMISSION)) {
    return <ToolAccessNotice tool="Image to Sketch" />;
  }

  async function accept(file: File | undefined) {
    if (!file) return;
    try {
      setPhoto(await compressImage(file));
    } catch (err) {
      workspace.setError(err instanceof Error ? err.message : "Could not read that file");
    }
  }

  async function handleGenerate() {
    if (!photo) return;
    const preview = await makeThumbnail(photo);
    workspace.generate(() => imageToSketch({ image: photo, style, model, quality, count, preview }), {
      count,
      prompt: `Sketch this photo — ${SKETCH_STYLES.find((entry) => entry.id === style)?.label}`,
    });
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
        busyLabel={`Sketching ${count > 1 ? `${count} versions` : "your photo"}…`}
        resetLabel="New sketch"
        downloadName="sketch.png"
        modelLabel={SPARKLE_MODELS.find((entry) => entry.id === model)?.label}
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

          {photo ? (
            <div className="relative overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
              {/* The photo the sketch follows — open it to look closely, or to
                  mark up what the sketch should emphasise. */}
              <button
                type="button"
                onClick={() => setPreview({ src: photo, key: "photo" })}
                title="Preview or annotate this photo"
                className="group relative block aspect-[4/3] w-full"
              >
                <Image src={photo} alt="Photo to sketch" fill sizes="(max-width: 768px) 100vw, 720px" className="object-contain" />
                <span className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-lg border border-white/15 bg-black/55 px-2 py-1 text-[10px] font-medium text-white/85 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
                  <Maximize2 size={11} /> Preview &amp; annotate
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
              <p className="text-sm font-medium text-cream">Drop a photo here, or click to choose</p>
              <p className="text-[11px] text-faint">The sketch follows this piece exactly — design, stones and angle.</p>
            </button>
          )}

          <OptionChips label="Sketch Style" options={SKETCH_STYLES} value={style} onChange={setStyle} />

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-surface-raised px-3 py-2.5">
            <ImageCountSelector count={count} onChange={setCount} options={PHOTO_COUNT_OPTIONS} />

            <InlineModelSelect models={SPARKLE_MODELS} value={model} onChange={setModel} showQuality quality={quality} onQualityChange={setQuality} />
          </div>

          <RunButton onClick={handleGenerate} disabled={!photo} icon={<PenLine size={14} />}>
            {count > 1 ? `Sketch ${count} versions` : "Sketch this photo"}
          </RunButton>
        </div>
      </div>

      <ImagePreviewLayer
        preview={preview}
        onClose={() => setPreview(null)}
        onSave={(marked) => setPhoto(marked)}
        downloadName="photo.jpg"
      />
    </div>
  );
}
