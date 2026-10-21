"use client";

import { useCallback, useMemo, useState } from "react";
import { Lock, Sparkles, Users } from "lucide-react";
import { GenerationResults } from "@/components/studio/GenerationResults";
import { InlineModelSelect } from "@/components/studio/InlineModelSelect";
import { OptionChips } from "@/components/studio/OptionChips";
import { AspectChips } from "@/components/studio/AspectChips";
import { PromptCard } from "@/components/studio/PromptCard";
import { ErrorBanner, RunButton } from "@/components/studio/ToolChrome";
import { UploadZone, type UploadItem } from "@/components/studio/UploadZone";
import { ModelLibrary } from "@/components/studio/ModelLibrary";
import { ImagePreviewLayer, type PreviewImage } from "@/components/studio/ImagePreviewLayer";
import {
  lifestyle,
  refineLifestyle,
  LIFESTYLE_MODELS,
  DEFAULT_LIFESTYLE_MODEL,
  LIFESTYLE_ASPECTS,
  DEFAULT_LIFESTYLE_ASPECT,
  toModelOptions,
  type LifestyleModelId,
  type LifestyleAspectId,
} from "@/lib/api";
import { PLACEMENT_GROUPS, POSES, THEMES, HINTS, resolvePlacement, resolveScene } from "@/lib/lifestyleOptions";
import { makeThumbnail } from "@/lib/image";
import { filesToUploadItems, uploadErrorMessage } from "@/lib/uploads";
import { useGenerationWorkspace, type RefineRequest } from "@/lib/useGenerationWorkspace";
import { modelRequestFields, useModelLibrary } from "@/lib/useModelLibrary";
import { useAuth } from "@/lib/auth-context";
import { useModelQuality } from "@/lib/useModelQuality";
import { can } from "@/lib/permissions";
import { ToolAccessNotice } from "@/components/studio/ToolAccessNotice";
import { cn } from "@/lib/utils";

const PERMISSION = "tool.life_style.run";
const MODEL_OPTIONS = toModelOptions(LIFESTYLE_MODELS);

/**
 * Sent with every Lifestyle shot, ahead of the user's own notes. Shown in the
 * "Anything else" box as a locked chip rather than typed text: it gives the
 * best-sized results, so it can't be cleared or edited away.
 */
const FIXED_NOTE = "make the Jewelry very very very small";

export default function LifeStylePage() {
  const { user } = useAuth();

  const library = useModelLibrary();
  const [jewelry, setJewelry] = useState<UploadItem[]>([]);
  /** A jewellery photo opened for a closer look, or to annotate before it's placed. */
  const [jewelryPreview, setJewelryPreview] = useState<PreviewImage | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [spot, setSpot] = useState<string | null>(null);
  const [pose, setPose] = useState(POSES[0].id);
  const [theme, setTheme] = useState(THEMES[0].id);
  const [aspectRatio, setAspectRatio] = useState<LifestyleAspectId>(DEFAULT_LIFESTYLE_ASPECT);
  const [description, setDescription] = useState("");
  // The fixed size note always leads; whatever the user types is added after it.
  const fullDescription = [FIXED_NOTE, description.trim()].filter(Boolean).join(". ");
  const [model, setModel] = useState<LifestyleModelId>(DEFAULT_LIFESTYLE_MODEL);
  const [quality, setQuality] = useModelQuality(model);

  /**
   * The jewellery photos, kept for the refine turns as well as the first
   * one. Re-sent on every follow-up as the ground truth for the design —
   * without them the model only ever checks its work against the previous
   * generated image, so a stone lost on turn two stays lost.
   */
  const jewelryImages = useMemo(() => jewelry.map((item) => item.dataUrl), [jewelry]);

  const onRefine = useCallback(
    (body: RefineRequest) => refineLifestyle({ ...body, model, quality, jewelryImages }),
    [model, quality, jewelryImages]
  );

  const workspace = useGenerationWorkspace({
    tool: "life_style",
    resumeLabel: "Place this jewellery on a model",
    onRefine,
  });

  if (!can(user, PERMISSION)) {
    return <ToolAccessNotice tool="Lifestyle" />;
  }

  async function addJewelry(files: File[]) {
    try {
      const added = await filesToUploadItems(files);
      setJewelry((current) => [...current, ...added]);
    } catch (err) {
      workspace.setError(uploadErrorMessage(err));
    }
  }

  async function handleGenerate() {
    if (jewelry.length === 0 || !library.choice) return;

    const chosenPlacement = resolvePlacement(category, spot);
    const chosenPose = POSES.find((entry) => entry.id === pose);
    // Resolved here so the request always names a concrete scene — "Surprise
    // Me" is a choice the picker makes, never one the model is left to make.
    const scene = resolveScene(theme);

    const preview = await makeThumbnail(jewelry[0].dataUrl);

    workspace.generate(
      () =>
        lifestyle({
          ...modelRequestFields(library.choice!),
          jewelryImages,
          placement: chosenPlacement?.value ?? "",
          poseInstruction: chosenPose?.value ?? "",
          shotType: chosenPose?.shot ?? "",
          sceneInstruction: scene.value,
          aspectRatio,
          description: fullDescription,
          model,
          quality,
          preview,
        }),
      {
        // One composite per run, however many pieces went in.
        count: 1,
        prompt:
          `Place ${jewelry.length > 1 ? `these ${jewelry.length} pieces` : "this piece"} on the model — ` +
          `${chosenPlacement?.label ?? "on the model"}, ${scene.label}` +
          `\n${fullDescription}`,
        // The piece leads; the model it goes on follows, small.
        images: [...jewelry.map((item) => item.dataUrl), library.choice.src],
      }
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
        hints={HINTS}
        busyLabel="Placing the jewellery…"
        resetLabel="New shot"
        downloadName="lifestyle.png"
        modelLabel={LIFESTYLE_MODELS.find((entry) => entry.id === model)?.label}
      />
    );
  }

  const ready = jewelry.length > 0 && Boolean(library.choice);

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <ErrorBanner message={workspace.error || library.error} />

      {/*
       * Two columns across the full width, the same split the other tools
       * use: everything you *choose from* on the left, and on the right what
       * you *give it* — the pieces, the note and the button.
       *
       * The choices are the long half — a placement grid, poses and scenes —
       * so pairing them with a short right-hand column is what keeps the
       * upload and the generate button on screen instead of a scroll below
       * twenty chips.
       */}
      <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8">
        <div className="grid w-full items-start gap-6 lg:grid-cols-[65fr_35fr] lg:gap-8">
          <div className="space-y-7">
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Users size={14} className="text-faint" />
                <h2 className="text-xs font-semibold uppercase tracking-wider text-cream">Who wears it</h2>
              </div>
              <ModelLibrary library={library} />
            </section>

            <PlacementPicker
              category={category}
              spot={spot}
              onCategoryChange={(next) => {
                setCategory(next);
                setSpot(null);
              }}
              onSpotChange={setSpot}
            />

            <OptionChips label="Pose & Framing" options={POSES} value={pose} onChange={setPose} />
            <OptionChips label="Scene" options={THEMES} value={theme} onChange={setTheme} />
          </div>

          {/* Sticky on a wide screen: the left column is much taller, and the
              button should not scroll away while you are still picking. */}
          <div className="space-y-5 lg:sticky lg:top-0">
            <AspectChips options={LIFESTYLE_ASPECTS} value={aspectRatio} onChange={setAspectRatio} />

            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-cream">
                The jewellery{" "}
                {jewelry.length > 1 && (
                  <span className="font-normal normal-case tracking-normal text-faint">
                    — worn together as a set
                  </span>
                )}
              </h2>
              <UploadZone
                items={jewelry}
                onAdd={addJewelry}
                onRemove={(id) => setJewelry((c) => c.filter((i) => i.id !== id))}
                onPreview={(item) => setJewelryPreview({ src: item.dataUrl, key: item.id })}
                compact
              />
            </section>

            <PromptCard
              topSlot={
                <span
                  title="Always sent — gives the best-sized results"
                  className="inline-flex items-center gap-1.5 rounded-md border border-gold/25 bg-gold/10 px-2 py-1 text-[12px] text-gold"
                >
                  <Lock size={11} /> {FIXED_NOTE}
                </span>
              }
              label="Anything else"
              value={description}
              onChange={setDescription}
              onPasteImage={(file) => addJewelry([file])}
              placeholder="Optional — e.g. warmer light, a softer background"
              footerEnd={<InlineModelSelect models={LIFESTYLE_MODELS} value={model} onChange={setModel} showQuality quality={quality} onQualityChange={setQuality} />}
            />

            <RunButton onClick={handleGenerate} disabled={!ready} icon={<Sparkles size={14} />}>
              {ready ? "Place on the model" : "Pick a model and a piece"}
            </RunButton>
          </div>
        </div>
      </div>

      <ImagePreviewLayer
        preview={jewelryPreview}
        onClose={() => setJewelryPreview(null)}
        onSave={(marked, key) =>
          setJewelry((current) => current.map((item) => (item.id === key ? { ...item, dataUrl: marked } : item)))
        }
        downloadName="jewellery.jpg"
      />
    </div>
  );
}


function PlacementChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "min-h-8 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "border-gold/30 bg-gold/10 text-gold"
          : "border-white/[0.07] bg-white/[0.03] text-muted hover:border-white/[0.14] hover:text-cream"
      )}
    >
      {label}
    </button>
  );
}

/**
 * Placement in two steps: what the piece is, then — optionally — exactly
 * where it goes. They know they have a ring before they know which finger.
 *
 * Clicking a chip a second time clears it: a category back to "from the
 * photo", a spot back to that category's standard placement.
 */
function PlacementPicker({
  category,
  spot,
  onCategoryChange,
  onSpotChange,
}: {
  category: string | null;
  spot: string | null;
  onCategoryChange: (category: string | null) => void;
  onSpotChange: (spot: string | null) => void;
}) {
  const group = PLACEMENT_GROUPS.find((entry) => entry.group === category);

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-cream">What is it</p>
      <div className="flex flex-wrap gap-1.5">
        {PLACEMENT_GROUPS.map((entry) => (
          <PlacementChip
            key={entry.group}
            label={entry.group}
            active={entry.group === category}
            onClick={() => onCategoryChange(entry.group === category ? null : entry.group)}
          />
        ))}
      </div>

      {group && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-medium uppercase tracking-widest text-faint">
            Where it goes{" "}
            <span className="normal-case tracking-normal">— optional, standard placement if none picked</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {group.items.map((item) => (
              <PlacementChip
                key={item.id}
                label={item.label}
                active={item.id === spot}
                onClick={() => onSpotChange(item.id === spot ? null : item.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
