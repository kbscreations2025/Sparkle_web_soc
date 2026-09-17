"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { Pencil, Sparkles, Upload, X } from "lucide-react";
import { ImageCountSelector } from "@/components/studio/ImageCountSelector";
import { SpellCheckedTextarea } from "@/components/studio/SpellCheckedTextarea";
import { GenerationResults } from "@/components/studio/GenerationResults";
import { InlineModelSelect } from "@/components/studio/InlineModelSelect";
import { ImagePreviewLayer, type PreviewImage } from "@/components/studio/ImagePreviewLayer";
import {
  sketchToImage,
  refineOn,
  SPARKLE_MODELS,
  DEFAULT_SPARKLE_MODEL,
  toModelOptions,
  type SparkleModelId,
} from "@/lib/api";
import { PHOTO_COUNT_OPTIONS, DEFAULT_PHOTO_COUNT } from "@/lib/jewelryConfigurator";
import { compressImage, makeThumbnail } from "@/lib/image";
import { useGenerationWorkspace } from "@/lib/useGenerationWorkspace";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";

const PERMISSION = "tool.sketch_to_image.run";
const MODEL_OPTIONS = toModelOptions(SPARKLE_MODELS);
const refineRender = refineOn("/api/sketch-to-image");

/** Several views of one piece go to the model together, so it sees the whole design. */
const MAX_SKETCHES = 6;

const REFINE_HINTS = [
  "Add more diamond sparkle",
  "Make the metal shinier",
  "Brighten the background",
  "Add a halo of diamonds",
];

export default function SketchToImagePage() {
  const { user } = useAuth();

  const [sketches, setSketches] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [model, setModel] = useState<SparkleModelId>(DEFAULT_SPARKLE_MODEL);
  const [count, setCount] = useState<number>(DEFAULT_PHOTO_COUNT);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<PreviewImage | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const workspace = useGenerationWorkspace({
    tool: "sketch_to_image",
    resumeLabel: "Render this sketch",
    onRefine: (body) => refineRender({ ...body, model }),
  });

  if (!can(user, PERMISSION)) {
    return (
      <div className="flex-1 overflow-y-auto px-8 py-8">
        <p className="text-sm text-muted">
          Sketch to Image isn&apos;t enabled for your account. Ask an admin to grant you access.
        </p>
      </div>
    );
  }

  async function accept(files: File[]) {
    if (files.length === 0) return;
    try {
      const compressed = await Promise.all(files.map(compressImage));
      setSketches((current) => [...current, ...compressed].slice(0, MAX_SKETCHES));
    } catch (err) {
      workspace.setError(err instanceof Error ? err.message : "Could not read those files");
    }
  }

  async function handleGenerate() {
    if (sketches.length === 0) return;
    const preview = await makeThumbnail(sketches[0]);
    workspace.generate(
      () => sketchToImage({ images: sketches, description: notes.trim() || undefined, model, count, preview }),
      { count, prompt: notes.trim() || `Render ${sketches.length > 1 ? `${sketches.length} sketch views` : "this sketch"}` }
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
        busyLabel={`Rendering ${count > 1 ? `${count} images` : "your sketch"}…`}
        resetLabel="New render"
        downloadName="render.png"
        modelLabel={SPARKLE_MODELS.find((entry) => entry.id === model)?.label}
      />
    );
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      {workspace.error && (
        <p className="shrink-0 border-b border-error/20 bg-error/[0.08] px-5 py-2 text-xs text-error">
          {workspace.error}
        </p>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8">
        <div className="mx-auto max-w-3xl space-y-6">
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => {
              accept(event.target.files ? [...event.target.files] : []);
              event.target.value = "";
            }}
          />

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-[10px] font-semibold uppercase tracking-wider text-faint">Sketches</h2>
              <span className="text-[10px] text-faint">
                {sketches.length}/{MAX_SKETCHES}
              </span>
            </div>

            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                accept([...event.dataTransfer.files]);
              }}
              className={cn(
                "rounded-xl border border-dashed p-3 transition-colors",
                dragging ? "border-gold/40 bg-gold/[0.06]" : "border-white/[0.12] bg-white/[0.02]"
              )}
            >
              {sketches.length === 0 ? (
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  className="flex w-full flex-col items-center justify-center gap-2 py-9"
                >
                  <Upload size={20} className="text-faint" />
                  <p className="text-sm font-medium text-cream">Drop your sketches here, or click to choose</p>
                  <p className="text-[11px] text-faint">
                    Add up to {MAX_SKETCHES} views of the same piece — they are rendered as one design.
                  </p>
                </button>
              ) : (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
                  {sketches.map((src, index) => (
                    <div key={src.slice(-32) + index} className="group relative aspect-square">
                      {/* Open a view to inspect it, or to mark up what the render
                          should pick out of the drawing. */}
                      <button
                        type="button"
                        onClick={() => setPreview({ src, key: String(index) })}
                        title={`Preview or annotate sketch ${index + 1}`}
                        className="absolute inset-0 block"
                      >
                        <Image
                          src={src}
                          alt={`Sketch ${index + 1}`}
                          fill
                          sizes="120px"
                          className="rounded-lg border border-white/10 bg-white object-cover transition-colors group-hover:border-gold/40"
                        />
                        <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                          <Pencil size={13} className="text-white" />
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setSketches((current) => current.filter((_, i) => i !== index))}
                        aria-label={`Remove sketch ${index + 1}`}
                        className="absolute -right-1 -top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white/80 transition-colors hover:text-white"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  ))}

                  {sketches.length < MAX_SKETCHES && (
                    <button
                      type="button"
                      onClick={() => fileInput.current?.click()}
                      className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-white/[0.12] text-faint transition-colors hover:border-white/25 hover:text-cream"
                    >
                      <Upload size={15} />
                    </button>
                  )}
                </div>
              )}
            </div>
          </section>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-cream">
                Jeweller Notes <span className="font-normal normal-case text-faint">(optional)</span>
              </p>
              <span className="text-[10px] text-faint">{notes.length}/500</span>
            </div>

            <div className="rounded-xl border border-white/[0.08] bg-surface-raised transition-colors focus-within:border-gold/30">
              <SpellCheckedTextarea
                value={notes}
                onChange={setNotes}
                rows={3}
                maxLength={500}
                placeholder="Metal, stone types, finish — anything the sketch doesn't show…"
              />

              <div className="flex items-center justify-between gap-2 rounded-b-xl border-t border-white/[0.06] bg-surface-raised/60 px-3 py-2.5">
                <ImageCountSelector count={count} onChange={setCount} options={PHOTO_COUNT_OPTIONS} />

                <InlineModelSelect models={SPARKLE_MODELS} value={model} onChange={setModel} />
              </div>
            </div>

            <button
              type="button"
              onClick={handleGenerate}
              disabled={sketches.length === 0}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-gold/30 bg-gold/15 px-4 py-3 text-xs font-semibold text-gold transition-colors hover:bg-gold/25 disabled:opacity-50"
            >
              <Sparkles size={14} />
              {count > 1 ? `Render ${count} images` : "Render photo"}
            </button>
          </div>
        </div>
      </div>

      <ImagePreviewLayer
        preview={preview}
        onClose={() => setPreview(null)}
        onSave={(marked, key) =>
          setSketches((current) => current.map((src, index) => (index === Number(key) ? marked : src)))
        }
        downloadName="sketch.jpg"
      />
    </div>
  );
}
