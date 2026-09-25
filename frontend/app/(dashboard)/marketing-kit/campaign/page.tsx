"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Newspaper, Users } from "lucide-react";
import { CampaignKitDeck } from "@/components/studio/CampaignKitDeck";
import { GenerationResults } from "@/components/studio/GenerationResults";
import { InlineModelSelect } from "@/components/studio/InlineModelSelect";
import { ModelLibrary } from "@/components/studio/ModelLibrary";
import { AspectChips } from "@/components/studio/AspectChips";
import { OptionChips } from "@/components/studio/OptionChips";
import { PromptCard } from "@/components/studio/PromptCard";
import { ErrorBanner, RunButton } from "@/components/studio/ToolChrome";
import { UploadZone, type UploadItem } from "@/components/studio/UploadZone";
import {
  campaignKit,
  fetchMarketingKit,
  refineCampaignKit,
  SPARKLE_MODELS,
  DEFAULT_SPARKLE_MODEL,
  toModelOptions,
  type MarketingKit,
  type SparkleModelId,
} from "@/lib/api";
import { BOX_STYLE_OPTIONS, POSE_OPTIONS, STUDIO_PROP_OPTIONS, CAMPAIGN_ASPECTS } from "@/lib/campaignOptions";
import { makeThumbnail } from "@/lib/image";
import { filesToUploadItems, uploadErrorMessage } from "@/lib/uploads";
import { useGenerationWorkspace, type RefineRequest } from "@/lib/useGenerationWorkspace";
import { modelRequestFields, useModelLibrary } from "@/lib/useModelLibrary";
import { useAuth } from "@/lib/auth-context";
import { useModelQuality } from "@/lib/useModelQuality";
import { can } from "@/lib/permissions";
import { ToolAccessNotice } from "@/components/studio/ToolAccessNotice";

const PERMISSION = "tool.marketing_kit.run";
const MODEL_OPTIONS = toModelOptions(SPARKLE_MODELS);

const HINTS = [
  "Warm the lighting a little",
  "Blur the background more",
  "Bring the piece closer to camera",
  "Try a cleaner backdrop",
];

/**
 * Campaign Kit: four shots in one run — two of the piece worn, two of it
 * alone.
 *
 * Uses the shared generate-then-refine workspace like every image tool, so
 * the four shots arrive one at a time as they land and any one of them can
 * be retouched by asking.
 */
export default function CampaignKitPage() {
  // `useSearchParams` suspends, and a kit link arrives as `?kitId=`.
  return (
    <Suspense fallback={<div className="flex-1 px-8 py-8 text-sm text-muted">Loading…</div>}>
      <CampaignKitWorkspace />
    </Suspense>
  );
}

function CampaignKitWorkspace() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const openKitId = searchParams.get("kitId");

  /** A saved deck being reopened from the kits rail, rather than a new run. */
  const [openKit, setOpenKit] = useState<MarketingKit | null>(null);

  useEffect(() => {
    if (!openKitId) return;
    let cancelled = false;

    fetchMarketingKit(openKitId).then((res) => {
      if (!cancelled && res.status === "success" && res.kit?.campaign) setOpenKit(res.kit);
    });

    return () => {
      cancelled = true;
    };
  }, [openKitId]);

  const library = useModelLibrary();
  const [jewelry, setJewelry] = useState<UploadItem[]>([]);
  const [description, setDescription] = useState("");
  const [aspect, setAspect] = useState<string>(CAMPAIGN_ASPECTS[0].id);
  const [pose, setPose] = useState<string>(POSE_OPTIONS[0].id);
  const [box, setBox] = useState<string>(BOX_STYLE_OPTIONS[0].id);
  const [prop, setProp] = useState<string>(STUDIO_PROP_OPTIONS[0].id);
  const [model, setModel] = useState<SparkleModelId>(DEFAULT_SPARKLE_MODEL);
  const [quality, setQuality] = useModelQuality(model);

  const onRefine = useCallback((body: RefineRequest) => refineCampaignKit({ ...body, model, quality }), [model, quality]);

  const workspace = useGenerationWorkspace({
    tool: "marketing_kit",
    resumeLabel: "Build a campaign kit",
    onRefine,
  });

  if (!can(user, PERMISSION)) {
    return <ToolAccessNotice tool="Marketing Kit" />;
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

    const preview = await makeThumbnail(jewelry[0].dataUrl);

    workspace.generate(
      () =>
        campaignKit({
          ...modelRequestFields(library.choice!),
          jewelryImages: jewelry.map((item) => item.dataUrl),
          description,
          // "Auto" is sent as no pick at all, which is what makes the
          // backend choose two *different* options for the pair rather than
          // the same one twice.
          poses: pose === "auto" ? [] : [pose],
          boxStyles: [box],
          studioProps: prop === "auto" ? [] : [prop],
          aspect,
          model,
          quality,
          preview,
        }),
      {
        count: 4,
        prompt: "Build a campaign kit — two lifestyle shots and two studio shots",
        images: [...jewelry.map((item) => item.dataUrl), library.choice!.src],
      }
    );
  }

  // A reopened deck wins over the builder: arriving with ?kitId= means
  // looking at what was made, not starting something new.
  if (openKit) {
    return (
      <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8">
        <CampaignKitDeck kit={openKit} />
      </div>
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
        busyLabel="Shooting the kit…"
        resetLabel="New kit"
        downloadName="campaign-shot.png"
        modelLabel={SPARKLE_MODELS.find((entry) => entry.id === model)?.label}
      />
    );
  }

  const ready = jewelry.length > 0 && Boolean(library.choice);

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <ErrorBanner message={workspace.error || library.error} />

      <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8">
        {/* The same split as the Lifestyle builder: what you choose from on
            the left, what you hand over — the pieces, the shape, the note —
            on the right, so the two tools are laid out alike. */}
        <div className="grid w-full items-start gap-6 lg:grid-cols-[65fr_35fr] lg:gap-8">
          <div className="space-y-7">
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Users size={14} className="text-faint" />
                <h2 className="text-xs font-semibold uppercase tracking-wider text-cream">
                  Who wears it{" "}
                  <span className="font-normal normal-case tracking-normal text-faint">
                    — for the two lifestyle shots
                  </span>
                </h2>
              </div>
              <ModelLibrary library={library} />
            </section>

            <OptionChips label="Pose · lifestyle shots" options={POSE_OPTIONS} value={pose} onChange={setPose} />
            <OptionChips
              label="Presentation box · studio shots"
              options={BOX_STYLE_OPTIONS}
              value={box}
              onChange={setBox}
            />
            <OptionChips label="Styling · studio shots" options={STUDIO_PROP_OPTIONS} value={prop} onChange={setProp} />
          </div>

          <div className="space-y-5 lg:sticky lg:top-0">
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-cream">The jewellery</h2>
              <UploadZone
                items={jewelry}
                onAdd={addJewelry}
                onRemove={(id) => setJewelry((current) => current.filter((item) => item.id !== id))}
              />
            </section>

            <AspectChips options={CAMPAIGN_ASPECTS} value={aspect} onChange={setAspect} />

            <PromptCard
              label="Anything else"
              value={description}
              onChange={setDescription}
              placeholder="Optional — applied to all four shots"
              footerEnd={<InlineModelSelect models={SPARKLE_MODELS} value={model} onChange={setModel} showQuality quality={quality} onQualityChange={setQuality} />}
            />

            <RunButton onClick={handleGenerate} disabled={!ready} icon={<Newspaper size={14} />}>
              {ready ? "Shoot the kit · 4 images" : "Pick a model and a piece"}
            </RunButton>
          </div>
        </div>
      </div>
    </div>
  );
}

