"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarHeart } from "lucide-react";
import { CampaignKitDeck } from "@/components/studio/CampaignKitDeck";
import { GenerationResults } from "@/components/studio/GenerationResults";
import { ImageCountSelector } from "@/components/studio/ImageCountSelector";
import { InlineModelSelect } from "@/components/studio/InlineModelSelect";
import { AspectChips } from "@/components/studio/AspectChips";
import { OptionChips } from "@/components/studio/OptionChips";
import { PromptCard } from "@/components/studio/PromptCard";
import { ErrorBanner, RunButton } from "@/components/studio/ToolChrome";
import { UploadZone, type UploadItem } from "@/components/studio/UploadZone";
import { ImagePreviewLayer, type PreviewImage } from "@/components/studio/ImagePreviewLayer";
import { ToolAccessNotice } from "@/components/studio/ToolAccessNotice";
import {
  festivePoster,
  fetchMarketingKit,
  refineFestivePoster,
  IMAGE_EDIT_MODELS,
  DEFAULT_IMAGE_EDIT_MODEL,
  toModelOptions,
  type MarketingKit,
  type ImageEditModelId,
} from "@/lib/api";
import { CAMPAIGN_ASPECTS } from "@/lib/campaignOptions";
import { EVENT_COPY, FESTIVE_COUNT_OPTIONS, FESTIVE_EVENT_OPTIONS, MAX_FESTIVE_PIECES } from "@/lib/festiveEvents";
import { PosterTextCard, type PosterText } from "@/components/studio/PosterTextCard";
import { makeThumbnail } from "@/lib/image";
import { filesToUploadItems, uploadErrorMessage } from "@/lib/uploads";
import { useGenerationWorkspace, type RefineRequest } from "@/lib/useGenerationWorkspace";
import { useAuth } from "@/lib/auth-context";
import { useModelQuality } from "@/lib/useModelQuality";
import { can } from "@/lib/permissions";

const PERMISSION = "tool.marketing_kit.run";
const MODEL_OPTIONS = toModelOptions(IMAGE_EDIT_MODELS);

const HINTS = ["Make it warmer and more golden", "Add more space for a greeting", "Fewer props, cleaner", "Richer, darker backdrop"];

/**
 * Festive Poster: up to six pieces together in one campaign image styled for
 * a calendar moment — Mother's Day, Christmas, Diwali — with no text in it,
 * so the brand adds its own greeting.
 *
 * The shared generate-then-refine workspace, like Campaign Kit: variations
 * arrive as they land and any one can be retouched by asking.
 */
export default function FestivePosterPage() {
  // `useSearchParams` suspends, and a kit link arrives as `?kitId=`.
  return (
    <Suspense fallback={<div className="flex-1 px-8 py-8 text-sm text-muted">Loading…</div>}>
      <FestivePosterWorkspace />
    </Suspense>
  );
}

function FestivePosterWorkspace() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const openKitId = searchParams.get("kitId");

  /** A saved set of posters reopened from the rail or History, rather than a new run. */
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

  const [jewelry, setJewelry] = useState<UploadItem[]>([]);
  const [jewelryPreview, setJewelryPreview] = useState<PreviewImage | null>(null);
  const [event, setEvent] = useState<string>("mothers_day");
  const [customEvent, setCustomEvent] = useState("");
  const [description, setDescription] = useState("");
  const [aspect, setAspect] = useState<string>(CAMPAIGN_ASPECTS[0].id);
  const [count, setCount] = useState(1);
  const [posterText, setPosterText] = useState<PosterText>({
    enabled: true,
    headline: "",
    subtitle: "",
    tagline: "",
    font: "classic_serif",
    placement: "center",
  });
  const [model, setModel] = useState<ImageEditModelId>(DEFAULT_IMAGE_EDIT_MODEL);
  const [quality, setQuality] = useModelQuality(model);

  const onRefine = useCallback((body: RefineRequest) => refineFestivePoster({ ...body, model, quality }), [model, quality]);

  const workspace = useGenerationWorkspace({
    tool: "marketing_kit",
    resumeLabel: "Make a festive poster",
    onRefine,
  });

  if (!can(user, PERMISSION)) {
    return <ToolAccessNotice tool="Marketing Kit" />;
  }

  async function addJewelry(files: File[]) {
    try {
      const added = await filesToUploadItems(files);
      setJewelry((current) => {
        const next = [...current, ...added];
        if (next.length > MAX_FESTIVE_PIECES) {
          workspace.setError(`A poster holds up to ${MAX_FESTIVE_PIECES} pieces — the extra ones were left out.`);
        }
        return next.slice(0, MAX_FESTIVE_PIECES);
      });
    } catch (err) {
      workspace.setError(uploadErrorMessage(err));
    }
  }

  const isCustom = event === "custom";
  const eventName = isCustom ? customEvent.trim() : FESTIVE_EVENT_OPTIONS.find((option) => option.id === event)?.label;
  const ready = jewelry.length > 0 && Boolean(eventName);
  // The event's own copy fills any line left empty — the user only types to change it.
  const suggestedCopy = EVENT_COPY[event] ?? { headline: `${eventName || "Festive"} Collection`, tagline: "" };

  async function handleGenerate() {
    if (!ready) return;
    const preview = await makeThumbnail(jewelry[0].dataUrl);

    workspace.generate(
      () =>
        festivePoster({
          jewelryImages: jewelry.map((item) => item.dataUrl),
          ...(isCustom ? { customEvent: customEvent.trim() } : { event }),
          description,
          ...(posterText.enabled
            ? {
                text: {
                  // Empty lines are written by the AI for this event.
                  headline: posterText.headline.trim(),
                  subtitle: posterText.subtitle.trim(),
                  tagline: posterText.tagline.trim(),
                  font: posterText.font,
                  placement: posterText.placement,
                },
              }
            : {}),
          aspect,
          count,
          model,
          quality,
          preview,
        }),
      {
        count,
        prompt: `${eventName} poster${description.trim() ? ` — ${description.trim()}` : ""}`,
        images: jewelry.map((item) => item.dataUrl),
      }
    );
  }

  // A reopened kit wins over the builder: arriving with ?kitId= means looking
  // at what was made, not starting something new.
  if (openKit) {
    return (
      <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8">
        <CampaignKitDeck kit={openKit} noun="poster" />
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
        busyLabel={`Styling ${count > 1 ? `${count} posters` : "your poster"}…`}
        resetLabel="New poster"
        downloadName="festive-poster.png"
        modelLabel={IMAGE_EDIT_MODELS.find((entry) => entry.id === model)?.label}
      />
    );
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <ErrorBanner message={workspace.error} />

      <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8">
        {/* Same split as Campaign Kit: what you choose from on the left, what
            you hand over — the pieces, the shape, the note — on the right. */}
        <div className="grid w-full items-start gap-6 lg:grid-cols-[65fr_35fr] lg:gap-8">
          <div className="space-y-5">
            <OptionChips label="Event" options={FESTIVE_EVENT_OPTIONS} value={event} onChange={setEvent} />
            {isCustom && (
              <input
                value={customEvent}
                onChange={(e) => setCustomEvent(e.target.value)}
                maxLength={200}
                autoFocus
                placeholder="e.g. Teachers' Day, Onam, our store anniversary…"
                className="w-full rounded-lg border border-white/[0.10] bg-white/[0.03] px-3 py-2 text-[12px] text-cream placeholder:text-faint focus:border-gold/40 focus:outline-none"
              />
            )}
            <PosterTextCard value={posterText} onChange={setPosterText} suggested={suggestedCopy} />
            <p className="text-[11px] leading-relaxed text-faint">
              The event sets the colours, props and light. Your pieces stay exactly as photographed.
            </p>
          </div>

          <div className="space-y-5 lg:sticky lg:top-0">
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-cream">
                The jewellery{" "}
                <span className="font-normal normal-case tracking-normal text-faint">
                  — {jewelry.length}/{MAX_FESTIVE_PIECES}
                </span>
              </h2>
              <UploadZone
                items={jewelry}
                onAdd={addJewelry}
                onRemove={(id) => setJewelry((current) => current.filter((item) => item.id !== id))}
                onPreview={(item) => setJewelryPreview({ src: item.dataUrl, key: item.id })}
                compact
              />
            </section>

            <AspectChips options={CAMPAIGN_ASPECTS} value={aspect} onChange={setAspect} />

            <PromptCard
              label="Anything else"
              value={description}
              onChange={setDescription}
              placeholder="Optional — e.g. more gold tones, a marble surface"
              onPasteImage={(file) => addJewelry([file])}
              footerStart={<ImageCountSelector count={count} onChange={setCount} options={FESTIVE_COUNT_OPTIONS} />}
              footerEnd={<InlineModelSelect models={IMAGE_EDIT_MODELS} value={model} onChange={setModel} showQuality quality={quality} onQualityChange={setQuality} />}
            />

            <RunButton onClick={handleGenerate} disabled={!ready} icon={<CalendarHeart size={14} />}>
              {jewelry.length === 0
                ? "Add your jewellery"
                : !eventName
                  ? "Name your event"
                  : `Make the ${eventName} poster${count > 1 ? ` · ${count} images` : ""}`}
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
      />
    </div>
  );
}
