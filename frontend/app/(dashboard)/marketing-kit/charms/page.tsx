"use client";

import { Suspense, useCallback, useState } from "react";
import { Sparkles, X } from "lucide-react";
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
  charmStory,
  refineCharmStory,
  IMAGE_EDIT_MODELS,
  DEFAULT_IMAGE_EDIT_MODEL,
  toModelOptions,
  type ImageEditModelId,
} from "@/lib/api";
import { CAMPAIGN_ASPECTS } from "@/lib/campaignOptions";
import { CHARM_COUNT_OPTIONS, CHARM_METALS, CHARM_SCENES, MAX_CHARMS } from "@/lib/charmStory";
import { makeThumbnail } from "@/lib/image";
import { useKitOpensInChat } from "@/lib/useKitOpensInChat";
import { filesToUploadItems, uploadErrorMessage } from "@/lib/uploads";
import { useGenerationWorkspace, type RefineRequest } from "@/lib/useGenerationWorkspace";
import { useAuth } from "@/lib/auth-context";
import { useModelQuality } from "@/lib/useModelQuality";
import { can } from "@/lib/permissions";

const PERMISSION = "tool.marketing_kit.run";
const MODEL_OPTIONS = toModelOptions(IMAGE_EDIT_MODELS);

const HINTS = ["Bunch the charms closer together", "More natural, softer daylight", "Less polished, more candid", "Move the camera closer"];

/** Ideas that fill the description box with one click — a starting point, not a list to choose from. */
const BRIEF_IDEAS = [
  "On a sunlit beach towel with a few seashells, soft peach light",
  "Draped over an open vintage book, warm candlelight",
  "On a marble bathroom shelf beside a perfume bottle, soft morning light",
  "Hanging from a pink peony stem, pastel blush gradient",
];

/**
 * Charm Shots: separate charm photos threaded together onto ONE chain and
 * photographed in a different aesthetic scene per image — held in a hand,
 * pooled in open palms, draped on stone, laid on silk… The person picks how
 * many images; a written description sets the scene instead. Each image can
 * then be retouched by asking, like Poster.
 *
 * A finished run always reopens here, in the chat — there is no kit view; a
 * `?kitId=` link is turned into this run's chat (see useKitOpensInChat).
 */
export default function CharmShotsPage() {
  return (
    <Suspense fallback={<div className="flex-1 px-8 py-8 text-sm text-muted">Loading…</div>}>
      <CharmShotsWorkspace />
    </Suspense>
  );
}

function CharmShotsWorkspace() {
  const { user } = useAuth();
  const kitLink = useKitOpensInChat("/marketing-kit/charms");

  const [charms, setCharms] = useState<UploadItem[]>([]);
  const [charmPreview, setCharmPreview] = useState<PreviewImage | null>(null);
  const [metal, setMetal] = useState<string>("match");
  const [description, setDescription] = useState("");
  const [aspect, setAspect] = useState<string>("portrait");
  const [count, setCount] = useState(4);
  const [model, setModel] = useState<ImageEditModelId>(DEFAULT_IMAGE_EDIT_MODEL);
  const [quality, setQuality] = useModelQuality(model);

  const onRefine = useCallback((body: RefineRequest) => refineCharmStory({ ...body, model, quality }), [model, quality]);

  const workspace = useGenerationWorkspace({
    tool: "marketing_kit",
    resumeLabel: "Make charm shots",
    onRefine,
  });

  if (!can(user, PERMISSION)) {
    return <ToolAccessNotice tool="Marketing Kit" />;
  }

  async function addCharms(files: File[]) {
    try {
      const added = await filesToUploadItems(files);
      setCharms((current) => {
        const next = [...current, ...added];
        if (next.length > MAX_CHARMS) {
          workspace.setError(`Up to ${MAX_CHARMS} charms at a time — the extra ones were left out.`);
        }
        return next.slice(0, MAX_CHARMS);
      });
    } catch (err) {
      workspace.setError(uploadErrorMessage(err));
    }
  }

  const brief = description.trim();
  const ready = charms.length > 0;
  // The scenes this run will use, in the backend's order — wrapping if more images than scenes.
  const scenes = Array.from({ length: count }, (_, index) => CHARM_SCENES[index % CHARM_SCENES.length]);

  async function handleGenerate() {
    if (!ready) return;
    const preview = await makeThumbnail(charms[0].dataUrl);

    workspace.generate(
      () =>
        charmStory({
          charmImages: charms.map((charm) => charm.dataUrl),
          metal,
          description: brief,
          aspect,
          count,
          model,
          quality,
          preview,
        }),
      {
        count,
        prompt: `Charm Shots — ${charms.length} charm${charms.length > 1 ? "s" : ""} on one chain${brief ? ` — ${brief}` : ""}`,
        images: charms.map((charm) => charm.dataUrl),
      }
    );
  }

  // A `?kitId=` link, while its run's chat is being looked up.
  if (kitLink.resolving) {
    return <div className="flex-1 px-8 py-8 text-sm text-muted">Opening your charm shots…</div>;
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
        busyLabel={`Styling ${count > 1 ? `${count} charm shots` : "your charm shot"}…`}
        resetLabel="New charm shots"
        downloadName="charm-shot.png"
        modelLabel={IMAGE_EDIT_MODELS.find((entry) => entry.id === model)?.label}
      />
    );
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <ErrorBanner
        message={workspace.error || (kitLink.failed ? "That run couldn't be reopened — its images weren't saved. Make new charm shots below." : "")}
      />

      <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8">
        <div className="grid w-full items-start gap-6 lg:grid-cols-[60fr_40fr] lg:gap-8">
          <div className="space-y-5">
            <section className="space-y-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-cream">
                What you&apos;ll get{" "}
                <span className="font-normal normal-case tracking-normal text-faint">
                  — {count} image{count > 1 ? "s" : ""}, every one with all your charms on a single chain
                </span>
              </p>
              {brief ? (
                <p className="text-[12px] leading-relaxed text-cream/80">
                  Your description sets the scene. Each image follows it with its own angle, framing and light.
                </p>
              ) : (
                <>
                  <ol className="flex flex-wrap gap-2">
                    {scenes.map((scene, index) => (
                      <li
                        key={`${scene}-${index}`}
                        className="rounded-full border border-gold/25 bg-gold/[0.06] px-3 py-1 text-[11px] text-cream"
                      >
                        <span className="mr-1 text-faint">{index + 1}.</span>
                        {scene}
                      </li>
                    ))}
                  </ol>
                  <p className="text-[11px] leading-relaxed text-faint">
                    Each image is set somewhere different and shot like a real photo — natural light, the charms bunched
                    together at the bottom of the chain the way they really hang. To pick the scene yourself, describe it in
                    the box on the right.
                  </p>
                </>
              )}
            </section>

            <OptionChips label="Chain metal" options={CHARM_METALS} value={metal} onChange={setMetal} />

            <AspectChips options={CAMPAIGN_ASPECTS} value={aspect} onChange={setAspect} />
          </div>

          <div className="space-y-5 lg:sticky lg:top-0">
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-cream">
                The charms{" "}
                <span className="font-normal normal-case tracking-normal text-faint">
                  — {charms.length === 1 ? "1 charm" : `${charms.length} charms`} · add as many as you like
                </span>
              </h2>
              <UploadZone items={[]} onAdd={addCharms} onRemove={() => {}} compact />
              {charms.length > 0 && (
                <ul className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                  {charms.map((charm) => (
                    <li key={charm.id} className="relative rounded-lg border border-white/[0.10] bg-white p-1">
                      <button type="button" onClick={() => setCharmPreview({ src: charm.dataUrl, key: charm.id })} className="block w-full">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={charm.dataUrl} alt={charm.name} className="aspect-square w-full object-contain" />
                      </button>
                      <button
                        type="button"
                        aria-label="Remove charm"
                        onClick={() => setCharms((current) => current.filter((entry) => entry.id !== charm.id))}
                        className="absolute right-1 top-1 rounded-full bg-black/50 p-0.5 text-white/70 hover:text-white"
                      >
                        <X size={11} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <div className="space-y-2">
              <PromptCard
                label="Describe the scene (optional)"
                value={description}
                onChange={setDescription}
                placeholder="e.g. on a sunlit beach towel with seashells, soft peach light — leave empty for our curated scenes"
                onPasteImage={(file) => addCharms([file])}
                footerStart={<ImageCountSelector count={count} onChange={setCount} options={CHARM_COUNT_OPTIONS} />}
                footerEnd={<InlineModelSelect models={IMAGE_EDIT_MODELS} value={model} onChange={setModel} showQuality quality={quality} onQualityChange={setQuality} />}
              />
              {!brief && (
                <div className="flex flex-wrap gap-1.5">
                  {BRIEF_IDEAS.map((idea) => (
                    <button
                      key={idea}
                      type="button"
                      onClick={() => setDescription(idea)}
                      className="rounded-full border border-white/[0.10] px-2.5 py-1 text-[10.5px] text-faint transition-colors hover:border-gold/30 hover:text-cream"
                    >
                      {idea}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <RunButton onClick={handleGenerate} disabled={!ready} icon={<Sparkles size={14} />}>
              {charms.length === 0 ? "Add your charms" : `Make ${count} image${count > 1 ? "s" : ""}`}
            </RunButton>
          </div>
        </div>
      </div>

      <ImagePreviewLayer
        preview={charmPreview}
        onClose={() => setCharmPreview(null)}
        onSave={(marked, key) => setCharms((current) => current.map((item) => (item.id === key ? { ...item, dataUrl: marked } : item)))}
      />
    </div>
  );
}
