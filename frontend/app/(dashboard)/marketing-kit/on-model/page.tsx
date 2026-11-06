"use client";

import { Suspense, useCallback, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { GenerationResults } from "@/components/studio/GenerationResults";
import { ImageCountSelector } from "@/components/studio/ImageCountSelector";
import { InlineModelSelect } from "@/components/studio/InlineModelSelect";
import { AspectChips } from "@/components/studio/AspectChips";
import { Chip, OptionChips } from "@/components/studio/OptionChips";
import { PromptCard } from "@/components/studio/PromptCard";
import { ErrorBanner, RunButton } from "@/components/studio/ToolChrome";
import { UploadZone, type UploadItem } from "@/components/studio/UploadZone";
import { ImagePreviewLayer, type PreviewImage } from "@/components/studio/ImagePreviewLayer";
import { ToolAccessNotice } from "@/components/studio/ToolAccessNotice";
import {
  styledOnModel,
  refineStyledOnModel,
  IMAGE_EDIT_MODELS,
  DEFAULT_IMAGE_EDIT_MODEL,
  toModelOptions,
  type ImageEditModelId,
} from "@/lib/api";
import { CAMPAIGN_ASPECTS } from "@/lib/campaignOptions";
import {
  ARRANGEMENTS,
  MAX_ON_MODEL_PIECES,
  ON_MODEL_BRIEF_IDEAS,
  ON_MODEL_COUNT_OPTIONS,
  ON_MODEL_POSES,
  ON_MODEL_SOFT_LIMIT,
  PIECE_TYPES,
  TONES,
  type PieceType,
} from "@/lib/onModel";
import { makeThumbnail } from "@/lib/image";
import { useKitOpensInChat } from "@/lib/useKitOpensInChat";
import { filesToUploadItems, uploadErrorMessage } from "@/lib/uploads";
import { useGenerationWorkspace, type RefineRequest } from "@/lib/useGenerationWorkspace";
import { useAuth } from "@/lib/auth-context";
import { useModelQuality } from "@/lib/useModelQuality";
import { can } from "@/lib/permissions";

const PERMISSION = "tool.marketing_kit.run";
const MODEL_OPTIONS = toModelOptions(IMAGE_EDIT_MODELS);

const HINTS = ["Warmer, more golden light", "Move the camera closer to the jewellery", "Change her outfit to a black silk top", "More candid, less posed"];

type Piece = UploadItem & { type: PieceType };

/**
 * Styled on Model: any mix of jewellery — a matching set, several pendants to
 * layer, rings and bracelets to stack, a charm collection, or one piece —
 * worn together by one model in cinematic editorial shots, a different pose
 * per image. Each image can then be retouched by asking, like Poster.
 *
 * A finished run always reopens here, in the chat — there is no kit view; a
 * `?kitId=` link is turned into this run's chat (see useKitOpensInChat).
 */
export default function StyledOnModelPage() {
  return (
    <Suspense fallback={<div className="flex-1 px-8 py-8 text-sm text-muted">Loading…</div>}>
      <StyledOnModelWorkspace />
    </Suspense>
  );
}

function StyledOnModelWorkspace() {
  const { user } = useAuth();
  const kitLink = useKitOpensInChat("/marketing-kit/on-model");

  const [pieces, setPieces] = useState<Piece[]>([]);
  const [piecePreview, setPiecePreview] = useState<PreviewImage | null>(null);
  const [arrangement, setArrangement] = useState<string>("auto");
  const [tone, setTone] = useState<string>("warm_cinematic");
  const [description, setDescription] = useState("");
  const [aspect, setAspect] = useState<string>("portrait");
  const [count, setCount] = useState(4);
  const [model, setModel] = useState<ImageEditModelId>(DEFAULT_IMAGE_EDIT_MODEL);
  const [quality, setQuality] = useModelQuality(model);

  const onRefine = useCallback((body: RefineRequest) => refineStyledOnModel({ ...body, model, quality }), [model, quality]);

  const workspace = useGenerationWorkspace({
    tool: "marketing_kit",
    resumeLabel: "Style on a model",
    onRefine,
  });

  if (!can(user, PERMISSION)) {
    return <ToolAccessNotice tool="Marketing Kit" />;
  }

  async function addPieces(files: File[]) {
    try {
      const added = (await filesToUploadItems(files)).map((item) => ({ ...item, type: "auto" as PieceType }));
      setPieces((current) => {
        const next = [...current, ...added];
        if (next.length > MAX_ON_MODEL_PIECES) {
          workspace.setError(`Up to ${MAX_ON_MODEL_PIECES} pieces in one look — the extra ones were left out.`);
        }
        return next.slice(0, MAX_ON_MODEL_PIECES);
      });
    } catch (err) {
      workspace.setError(uploadErrorMessage(err));
    }
  }

  function setPieceType(id: string, type: PieceType) {
    setPieces((current) => current.map((piece) => (piece.id === id ? { ...piece, type } : piece)));
  }

  const brief = description.trim();
  const ready = pieces.length > 0;
  const poses = Array.from({ length: count }, (_, index) => ON_MODEL_POSES[index % ON_MODEL_POSES.length]);
  const arrangementHint = ARRANGEMENTS.find((entry) => entry.id === arrangement)?.hint;

  async function handleGenerate() {
    if (!ready) return;
    const preview = await makeThumbnail(pieces[0].dataUrl);

    workspace.generate(
      () =>
        styledOnModel({
          jewelryImages: pieces.map((piece) => piece.dataUrl),
          types: pieces.map((piece) => piece.type),
          arrangement,
          tone,
          description: brief,
          aspect,
          count,
          model,
          quality,
          preview,
        }),
      {
        count,
        prompt: `Styled on Model — ${pieces.length} piece${pieces.length > 1 ? "s" : ""}${brief ? ` — ${brief}` : ""}`,
        images: pieces.map((piece) => piece.dataUrl),
      }
    );
  }

  // A `?kitId=` link, while its run's chat is being looked up.
  if (kitLink.resolving) {
    return <div className="flex-1 px-8 py-8 text-sm text-muted">Opening your looks…</div>;
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
        busyLabel={`Styling ${count > 1 ? `${count} looks` : "your look"}…`}
        resetLabel="New look"
        downloadName="styled-on-model.png"
        modelLabel={IMAGE_EDIT_MODELS.find((entry) => entry.id === model)?.label}
      />
    );
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <ErrorBanner
        message={workspace.error || (kitLink.failed ? "That run couldn't be reopened — its images weren't saved. Start a new look below." : "")}
      />

      <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8">
        <div className="grid w-full items-start gap-6 lg:grid-cols-[60fr_40fr] lg:gap-8">
          <div className="space-y-5">
            <div className="space-y-2">
              <OptionChips label="How to wear them" options={ARRANGEMENTS} value={arrangement} onChange={setArrangement} />
              {arrangementHint && <p className="text-[11px] leading-relaxed text-faint">{arrangementHint}</p>}
            </div>

            <section className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-cream">Colour &amp; mood</p>
              <div className="flex flex-wrap gap-2">
                {TONES.map((entry) => (
                  <Chip
                    key={entry.id}
                    label={entry.label}
                    active={tone === entry.id}
                    onClick={() => setTone(entry.id)}
                    leading={<span className="inline-block h-3 w-3 rounded-full border border-white/20" style={{ background: entry.swatch }} />}
                  />
                ))}
              </div>
            </section>

            <section className="space-y-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-cream">
                What you&apos;ll get{" "}
                <span className="font-normal normal-case tracking-normal text-faint">
                  — {count} image{count > 1 ? "s" : ""}, one model wearing every piece
                </span>
              </p>
              {brief ? (
                <p className="text-[12px] leading-relaxed text-cream/80">
                  Your description leads — the model, outfit and place follow it, and each image takes its own pose.
                </p>
              ) : (
                <ol className="flex flex-wrap gap-2">
                  {poses.map((pose, index) => (
                    <li
                      key={`${pose}-${index}`}
                      className="rounded-full border border-gold/25 bg-gold/[0.06] px-3 py-1 text-[11px] text-cream"
                    >
                      <span className="mr-1 text-faint">{index + 1}.</span>
                      {pose}
                    </li>
                  ))}
                </ol>
              )}
              <p className="text-[11px] leading-relaxed text-faint">
                Shot like a real editorial: every piece at its true size and exactly as photographed, the model always
                tastefully dressed.
              </p>
            </section>

            <AspectChips options={CAMPAIGN_ASPECTS} value={aspect} onChange={setAspect} />
          </div>

          <div className="space-y-5 lg:sticky lg:top-0">
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-cream">
                The jewellery{" "}
                <span className="font-normal normal-case tracking-normal text-faint">
                  — {pieces.length === 1 ? "1 piece" : `${pieces.length} pieces`} · one piece or a whole collection
                </span>
              </h2>
              <UploadZone items={[]} onAdd={addPieces} onRemove={() => {}} compact />
              {pieces.length > 0 && (
                <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {pieces.map((piece) => (
                    <li key={piece.id} className="space-y-1">
                      <div className="relative rounded-lg border border-white/[0.10] bg-white p-1">
                        <button type="button" onClick={() => setPiecePreview({ src: piece.dataUrl, key: piece.id })} className="block w-full">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={piece.dataUrl} alt={piece.name} className="aspect-square w-full object-contain" />
                        </button>
                        <button
                          type="button"
                          aria-label="Remove piece"
                          onClick={() => setPieces((current) => current.filter((entry) => entry.id !== piece.id))}
                          className="absolute right-1 top-1 rounded-full bg-black/50 p-0.5 text-white/70 hover:text-white"
                        >
                          <X size={11} />
                        </button>
                      </div>
                      <select
                        aria-label="What this piece is"
                        value={piece.type}
                        onChange={(e) => setPieceType(piece.id, e.target.value as PieceType)}
                        className="w-full rounded-md border border-white/[0.10] bg-white/[0.03] px-1.5 py-1 text-[10.5px] text-cream focus:border-gold/40 focus:outline-none"
                      >
                        {PIECE_TYPES.map((type) => (
                          <option key={type.id} value={type.id}>
                            {type.label}
                          </option>
                        ))}
                      </select>
                    </li>
                  ))}
                </ul>
              )}
              {pieces.length > ON_MODEL_SOFT_LIMIT && (
                <p className="text-[11px] leading-relaxed text-faint">
                  Tip: past {ON_MODEL_SOFT_LIMIT} pieces in one look, look-alike pieces can blur together. For a big
                  collection, a few smaller looks give the most faithful results.
                </p>
              )}
            </section>

            <div className="space-y-2">
              <PromptCard
                label="Describe the model or scene (optional)"
                value={description}
                onChange={setDescription}
                placeholder="e.g. South Asian model with long dark hair, black silk top, a Paris balcony at dusk — leave empty for our styling"
                onPasteImage={(file) => addPieces([file])}
                footerStart={<ImageCountSelector count={count} onChange={setCount} options={ON_MODEL_COUNT_OPTIONS} />}
                footerEnd={<InlineModelSelect models={IMAGE_EDIT_MODELS} value={model} onChange={setModel} showQuality quality={quality} onQualityChange={setQuality} />}
              />
              {!brief && (
                <div className="flex flex-wrap gap-1.5">
                  {ON_MODEL_BRIEF_IDEAS.map((idea) => (
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
              {pieces.length === 0 ? "Add your jewellery" : `Make ${count} image${count > 1 ? "s" : ""}`}
            </RunButton>
          </div>
        </div>
      </div>

      <ImagePreviewLayer
        preview={piecePreview}
        onClose={() => setPiecePreview(null)}
        onSave={(marked, key) => setPieces((current) => current.map((item) => (item.id === key ? { ...item, dataUrl: marked } : item)))}
      />
    </div>
  );
}
