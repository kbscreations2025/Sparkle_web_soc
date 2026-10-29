"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { Download, Loader2, RotateCcw, Rotate3d, Upload, X } from "lucide-react";
import { PromptCard } from "@/components/studio/PromptCard";
import { ErrorBanner, RunButton } from "@/components/studio/ToolChrome";
import { GenerationResults } from "@/components/studio/GenerationResults";
import { InlineModelSelect } from "@/components/studio/InlineModelSelect";
import { usePhotoPicker } from "@/components/studio/SinglePhotoUpload";
import { Lightbox } from "@/components/studio/Lightbox";
import {
  generateProductViews,
  refineImage,
  IMAGE_EDIT_MODELS,
  DEFAULT_IMAGE_EDIT_MODEL,
  toModelOptions,
  resolveModelId,
  type ImageEditModelId,
  type ProductViewCategory,
  type ProductViewId,
} from "@/lib/api";
import { compressImage, downloadImage, makeThumbnail, urlToDataUrl } from "@/lib/image";
import { useGenerationWorkspace } from "@/lib/useGenerationWorkspace";
import { useAuth } from "@/lib/auth-context";
import { useModelQuality } from "@/lib/useModelQuality";
import { can } from "@/lib/permissions";
import { ToolAccessNotice } from "@/components/studio/ToolAccessNotice";
import { cn } from "@/lib/utils";

const PERMISSION = "tool.cleaning.run";
const MODEL_OPTIONS = toModelOptions(IMAGE_EDIT_MODELS);

type View = { id: ProductViewId; label: string; hint: string; example?: string; key?: boolean };

/**
 * Each kind of piece is showcased from its own angles (ids as in the backend's
 * prompts/productViews.js). Within a kind, the views are ordered by how much
 * of the piece each one shows — so the best photo to generate the rest from
 * comes first — and `key` marks those that show enough to start from.
 *
 * Rings and bracelets share one set:
 *  - 3/4 shows the stone's shape, the setting's height and the band at once;
 *  - front gives the stone and head exactly, but not how tall the setting is;
 *  - side gives the profile and gallery, but hides the stone's outline;
 *  - upright shows least — mostly the band and the stone edge-on.
 */
const CATEGORIES: { id: ProductViewCategory; label: string; views: View[] }[] = [
  {
    id: "ring",
    label: "Ring & Bracelet",
    views: [
      { id: "three-quarter", label: "3/4 angle", hint: "Classic hero angle", example: "/product-views/three-quarter.jpg", key: true },
      { id: "front", label: "Front", hint: "Top-down, stone facing you", example: "/product-views/front.jpg", key: true },
      { id: "side", label: "Side", hint: "Profile of the setting", example: "/product-views/side.jpg" },
      { id: "upright", label: "Upright", hint: "Standing, through the band", example: "/product-views/upright.jpg" },
    ],
  },
  {
    id: "earrings",
    label: "Earrings",
    views: [
      { id: "earring-pair", label: "Pair front", hint: "Both earrings facing you", example: "/product-views/earring-pair.jpg", key: true },
      { id: "earring-front-side", label: "Front + side", hint: "One face-on, one in profile", example: "/product-views/earring-front-side.jpg", key: true },
    ],
  },
  {
    id: "pendant",
    label: "Pendant",
    views: [
      { id: "pendant-front", label: "Front", hint: "Hanging, facing you", example: "/product-views/pendant-front.jpg", key: true },
      { id: "pendant-side", label: "Side", hint: "Profile with the bail", example: "/product-views/pendant-side.jpg" },
    ],
  },
];

/** "3/4 angle or front" — the views a run can start from, for the hints. */
function keyViewNames(views: View[]) {
  return views
    .filter((view) => view.key)
    .map((view) => view.label.toLowerCase())
    .join(" or ");
}

const REFINE_HINTS = ["Match the side stones to the front view", "Make the metal shinier", "Soften the shadow", "Show more of the band"];

/**
 * Product Views: the standard catalogue angles of one piece. The person drops
 * each photo they have into the box for its angle; every empty box is
 * generated from those photos — so a run covers front, side, upright and 3/4,
 * and only what is missing costs anything.
 */
export default function ProductViewsPage() {
  const { user } = useAuth();

  const [category, setCategory] = useState<ProductViewCategory>("ring");
  // View ids are unique across kinds, so switching kind and back keeps each kind's photos.
  const [photos, setPhotos] = useState<Partial<Record<ProductViewId, string>>>({});
  /** Empty boxes the person chose not to generate. */
  const [skipped, setSkipped] = useState<Partial<Record<ProductViewId, boolean>>>({});
  const [notes, setNotes] = useState("");
  const [model, setModel] = useState<ImageEditModelId>(DEFAULT_IMAGE_EDIT_MODEL);
  const [quality, setQuality] = useModelQuality(model);
  const [dropTarget, setDropTarget] = useState<ProductViewId | null>(null);
  /** The angles the latest run asked for — the boxes that spin while it works. */
  const [runViews, setRunViews] = useState<ProductViewId[]>([]);
  /** What came back, by angle. Kept across runs, so a second run only fills the gaps. */
  const [generated, setGenerated] = useState<Partial<Record<ProductViewId, string>>>({});
  /** The chat a result is refined in, opened from one box; null on the grid. */
  const [refining, setRefining] = useState<ProductViewId | null>(null);
  /**
   * Set once there are boxes to fill — a run started here, or a reopened one
   * whose angles were recorded. A thread from before they were stays in the chat.
   */
  const [ranHere, setRanHere] = useState(false);
  /** An example view opened full size. */
  const [example, setExample] = useState<string | null>(null);
  /** Which box the file picker — or the library — is filling. */
  const pickingFor = useRef<ProductViewId>("front");
  const picker = usePhotoPicker((file) => void place(pickingFor.current, file));

  const workspace = useGenerationWorkspace({
    tool: "cleaning",
    resumeLabel: "Generate views",
    onRefine: (body) => refineImage({ ...body, model, quality }),
    // A run reopened from History is laid back out in its boxes: each photo
    // where it was placed, each result in the box for its angle.
    onResume: ({ model: resumedModel, generations }) => {
      const resumed = resolveModelId(IMAGE_EDIT_MODELS, resumedModel);
      if (resumed) setModel(resumed);

      const runs = generations.filter((turn) => turn.productViews?.outputViews);
      if (runs.length === 0) return;
      const placedPhotos: Partial<Record<ProductViewId, string>> = {};
      const results: Partial<Record<ProductViewId, string>> = {};
      for (const turn of runs) {
        const { photoViews, outputViews } = turn.productViews!;
        photoViews.forEach((id, index) => {
          const url = turn.inputAssets[index]?.url;
          if (url) placedPhotos[id] = url;
        });
        outputViews!.forEach((id, index) => {
          const url = turn.outputAssets[index]?.url;
          if (url) results[id] = url;
        });
      }
      setCategory(runs[runs.length - 1].productViews!.category);
      setPhotos(placedPhotos);
      setGenerated(results);
      setRunViews(Object.keys(results) as ProductViewId[]);
      setRanHere(true);
    },
  });

  // A finished run drops each image into the box for its angle. Done while
  // rendering rather than in an effect, so the boxes never show a frame of
  // spinners after the results have already arrived.
  const [seenImages, setSeenImages] = useState(workspace.images);
  if (workspace.images !== seenImages) {
    setSeenImages(workspace.images);
    const tags = workspace.imageTags;
    if (tags) {
      setGenerated((current) => ({
        ...current,
        ...Object.fromEntries(tags.map((id, index) => [id, workspace.images[index]])),
      }));
    }
  }

  if (!can(user, PERMISSION)) {
    return <ToolAccessNotice tool="Image Cleaning" />;
  }

  async function place(view: ProductViewId, file: File | undefined) {
    if (!file || !file.type.startsWith("image/")) return;
    try {
      const image = await compressImage(file);
      setPhotos((current) => ({ ...current, [view]: image }));
    } catch (err) {
      workspace.setError(err instanceof Error ? err.message : "Could not read that file");
    }
  }

  function pick(view: ProductViewId) {
    pickingFor.current = view;
    picker.show();
  }

  const views = CATEGORIES.find((entry) => entry.id === category)!.views;
  const placed = views.filter((view) => photos[view.id]);
  // Every angle without a photo or a result is generated, unless the person skipped it.
  const toGenerate = views
    .filter((view) => !photos[view.id] && !generated[view.id] && !skipped[view.id])
    .map((view) => view.id);
  const busy = workspace.isGenerating;
  // A colleague's run, opened to read: nothing on it can be changed.
  const locked = busy || Boolean(workspace.readOnly);
  const readyCount = busy ? workspace.deliveredCount : 0;
  // The lesser angles alone show too little of the piece to rebuild it from.
  const hasKeyPhoto = placed.some((view) => view.key);
  const keyNames = keyViewNames(views);

  async function handleGenerate() {
    if (locked || !hasKeyPhoto || toGenerate.length === 0) return;
    const requested = toGenerate;
    // A photo put back from a reopened run is a stored url; the model needs its bytes.
    let images: string[];
    try {
      images = await Promise.all(
        placed.map((view) => {
          const photo = photos[view.id]!;
          return photo.startsWith("data:") ? photo : urlToDataUrl(photo);
        })
      );
    } catch {
      workspace.setError("Could not load your photos — add them again");
      return;
    }
    setRunViews(requested);
    setRanHere(true);
    // The run plays out in the chat, like every other tool: results arrive on
    // the stage and can be refined there. "Back to views" returns to the boxes.
    setRefining(requested[0]);
    const preview = await makeThumbnail(images[0]);
    workspace.generate(
      () =>
        generateProductViews({
          category,
          photos: placed.map((view, index) => ({ view: view.id, image: images[index] })),
          views: requested,
          notes: notes.trim() || undefined,
          model,
          quality,
          preview,
        }),
      {
        count: requested.length,
        prompt: `Generate views: ${requested.map((id) => views.find((view) => view.id === id)?.label).join(", ")}`,
        images,
      }
    );
  }

  function openRefine(view: ProductViewId) {
    workspace.setSelectedView(generated[view]!);
    setRefining(view);
  }

  /** Back from the chat: whichever image was showing there becomes that box's result. */
  function closeRefine() {
    const view = refining;
    const shown = workspace.displayImg;
    // Picking another angle's result in the chat isn't a refinement of this one.
    const isRunResult = shown ? Object.values(generated).includes(shown) : false;
    // Leaving mid-run: what's showing is a preview, and the run fills the boxes itself.
    if (view && shown && !isRunResult && !workspace.isGenerating) setGenerated((current) => ({ ...current, [view]: shown }));
    setRefining(null);
  }

  if (refining || (workspace.status === "done" && !ranHere)) {
    return (
      <GenerationResults
        workspace={workspace}
        modelOptions={MODEL_OPTIONS}
        modelValue={model}
        onModelChange={setModel}
        qualityValue={quality}
        onQualityChange={setQuality}
        hints={REFINE_HINTS}
        busyLabel="Refining…"
        resetLabel={refining ? "Back to views" : "New views"}
        onReset={refining ? closeRefine : undefined}
        downloadName="view.png"
        modelLabel={IMAGE_EDIT_MODELS.find((entry) => entry.id === model)?.label}
      />
    );
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <ErrorBanner message={workspace.error} />

      <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8">
        <div className="mx-auto max-w-3xl space-y-6">
          {picker.inputs}

          {/* What kind of piece — each is showcased from its own angles. */}
          <section className="space-y-2">
            <h2 className="text-[10px] font-semibold uppercase tracking-wider text-faint">Piece</h2>
            <div className="grid grid-cols-3 gap-2">
              {CATEGORIES.map((entry) => {
                const active = entry.id === category;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setCategory(entry.id)}
                    disabled={locked && !active}
                    aria-pressed={active}
                    className={cn(
                      "flex items-center gap-2.5 rounded-xl border p-2 text-left transition-colors disabled:opacity-50",
                      active
                        ? "border-gold/50 bg-gold/[0.08]"
                        : "border-black/[0.06] bg-surface-raised hover:border-gold/30"
                    )}
                  >
                    <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-black/[0.06] bg-white">
                      <Image src={entry.views[0].example!} alt="" fill sizes="40px" className="object-contain" />
                    </span>
                    <span className="min-w-0">
                      <span className={cn("block truncate text-[12px] font-medium", active ? "text-cream" : "text-muted")}>
                        {entry.label}
                      </span>
                      <span className="block text-[10px] text-faint">{entry.views.length} views</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-[10px] font-semibold uppercase tracking-wider text-faint">Views</h2>
              <span className="text-[10px] text-faint">Add a {keyNames} photo — the empty views are generated from it</span>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {views.map((view) => {
                const photo = photos[view.id];
                const result = !photo ? generated[view.id] : undefined;
                const pending = busy && runViews.includes(view.id);
                // Asked for last run but never came back — it's queued for the next one.
                const missed = !busy && !photo && !result && ranHere && runViews.includes(view.id);
                const off = !photo && !result && !pending && skipped[view.id];
                // A skipped box drains to grey, so it reads as "won't be made" at a glance.
                const drained = off && "grayscale opacity-45";
                const status = photo
                  ? "Your photo"
                  : result
                    ? "Generated"
                    : pending
                      ? "Generating…"
                      : off
                        ? "Won't be generated"
                        : missed
                          ? "Didn't come out — try again"
                          : "Will be generated";
                return (
                  <div
                    key={view.id}
                    onDragOver={(event) => {
                      if (locked) return;
                      event.preventDefault();
                      setDropTarget(view.id);
                    }}
                    onDragLeave={() => setDropTarget(null)}
                    onDrop={(event) => {
                      event.preventDefault();
                      setDropTarget(null);
                      void place(view.id, event.dataTransfer.files[0]);
                    }}
                    className={cn(
                      "flex flex-col gap-2 rounded-xl border p-2.5 transition-colors",
                      dropTarget === view.id
                        ? "border-gold/50 bg-gold/[0.08]"
                        : off
                          ? "border-black/[0.08] bg-black/[0.03]"
                          : result
                            ? "border-gold/40 bg-gold/[0.06]"
                            : photo
                              ? "border-white/[0.08] bg-white/[0.02]"
                              : "border-gold/30 bg-gold/[0.04]"
                    )}
                  >
                    <div
                      className={cn(
                        "relative aspect-square w-full overflow-hidden rounded-lg border border-white/[0.06] bg-white transition-[filter,opacity]",
                        drained
                      )}
                    >
                      {result ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setExample(result)}
                            aria-label={`Open the generated ${view.label.toLowerCase()} view`}
                            className="absolute inset-0"
                          >
                            <Image src={result} alt={`${view.label} — generated`} fill sizes="160px" className="object-contain" />
                          </button>
                          <div className="absolute right-1.5 top-1.5 flex gap-1">
                            <button
                              type="button"
                              onClick={() => void downloadImage(result, `${view.id}.png`)}
                              title="Download"
                              aria-label={`Download the ${view.label.toLowerCase()} view`}
                              className="flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white/85 transition-colors hover:bg-black/75"
                            >
                              <Download size={12} />
                            </button>
                            {!locked && (
                              <button
                                type="button"
                                onClick={() => setGenerated((current) => ({ ...current, [view.id]: undefined }))}
                                title="Discard and generate again"
                                aria-label={`Discard the generated ${view.label.toLowerCase()} view`}
                                className="flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white/85 transition-colors hover:bg-black/75"
                              >
                                <RotateCcw size={12} />
                              </button>
                            )}
                          </div>
                        </>
                      ) : pending ? (
                        <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-gold/[0.06] text-gold">
                          <Loader2 size={18} className="animate-spin" />
                          <span className="text-[10px]">Generating…</span>
                        </div>
                      ) : photo ? (
                        <>
                          <Image src={photo} alt={`${view.label} — your photo`} fill sizes="160px" className="object-contain" />
                          <button
                            type="button"
                            hidden={locked}
                            onClick={() => setPhotos((current) => ({ ...current, [view.id]: undefined }))}
                            aria-label={`Remove the ${view.label.toLowerCase()} photo`}
                            className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white/85 transition-colors hover:bg-black/75"
                          >
                            <X size={12} />
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          disabled={locked}
                          onClick={() => pick(view.id)}
                          className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-faint transition-colors hover:text-cream disabled:pointer-events-none"
                        >
                          <Upload size={18} />
                          <span className="text-[10px]">Add photo</span>
                        </button>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-1">
                      {/* What this angle looks like — tap for the full example. */}
                      {view.example && (
                        <button
                          type="button"
                          onClick={() => setExample(view.example!)}
                          title={`See an example ${view.label.toLowerCase()} view`}
                          aria-label={`See an example ${view.label.toLowerCase()} view`}
                          className={cn(
                            "relative h-8 w-8 shrink-0 overflow-hidden rounded-md border border-black/10 bg-white transition-[transform,filter,opacity] hover:scale-105",
                            drained
                          )}
                        >
                          <Image src={view.example} alt="" fill sizes="32px" className="object-contain" />
                        </button>
                      )}
                      <div className={cn("min-w-0 flex-1 transition-opacity", off && "opacity-60")}>
                        <p className="flex items-center gap-1 text-[11px] font-medium text-cream">
                          {view.label}
                          {view.key && (
                            <span className="rounded-full bg-gold/15 px-1.5 text-[8px] font-semibold uppercase leading-4 tracking-wide text-gold">
                              Key
                            </span>
                          )}
                        </p>
                        <p className={cn("truncate text-[10px]", result || pending ? "text-gold" : "text-faint")} title={status}>
                          {status}
                        </p>
                      </div>
                      {result ? (
                        !locked && (
                          <button
                            type="button"
                            onClick={() => openRefine(view.id)}
                            className="shrink-0 text-[10px] font-medium text-gold transition-colors hover:text-cream"
                          >
                            Refine
                          </button>
                        )
                      ) : !photo && !locked && (
                        <button
                          type="button"
                          onClick={() => setSkipped((current) => ({ ...current, [view.id]: !current[view.id] }))}
                          className="shrink-0 text-[10px] font-medium text-gold transition-colors hover:text-cream"
                        >
                          {off ? "Generate" : "Skip"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <div className="space-y-1">
            <PromptCard
              label={
                <>
                  Notes <span className="font-normal normal-case text-faint">(optional)</span>
                </>
              }
              value={notes}
              onChange={setNotes}
              rows={2}
              placeholder="Anything the photos don't make clear — the metal, the side stones, the band…"
              footerEnd={<InlineModelSelect models={IMAGE_EDIT_MODELS} value={model} onChange={setModel} showQuality quality={quality} onQualityChange={setQuality} />}
            />

            <RunButton
              onClick={handleGenerate}
              disabled={locked || !hasKeyPhoto || toGenerate.length === 0}
              icon={busy ? <Loader2 size={14} className="animate-spin" /> : <Rotate3d size={14} />}
            >
              {busy
                ? `Generating ${runViews.length > 1 ? `${runViews.length} views` : "the view"}… ${readyCount}/${runViews.length} ready`
                : workspace.readOnly
                  ? `${workspace.readOnly.ownerName ?? "A colleague"}'s views — read only`
                  : !hasKeyPhoto
                ? `Add a ${keyNames} photo to start`
                : toGenerate.length === 0
                  ? views.some((view) => generated[view.id])
                    ? "All views ready"
                    : "Nothing left to generate"
                  : `Generate ${toGenerate.length} view${toGenerate.length > 1 ? "s" : ""}`}
            </RunButton>
          </div>
        </div>
      </div>

      <Lightbox src={example} onClose={() => setExample(null)} />
    </div>
  );
}
