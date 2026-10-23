"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { ArrowRight, Loader2, Replace, Upload, X } from "lucide-react";
import { PromptCard } from "@/components/studio/PromptCard";
import { ErrorBanner, RunButton } from "@/components/studio/ToolChrome";
import { GenerationResults } from "@/components/studio/GenerationResults";
import { InlineModelSelect } from "@/components/studio/InlineModelSelect";
import { LibraryPicker } from "@/components/studio/LibraryPicker";
import { OptionChips } from "@/components/studio/OptionChips";
import {
  replaceJewellery,
  CLEANING_MODELS,
  DEFAULT_CLEANING_MODEL,
  toModelOptions,
  resolveModelId,
  type ApiResult,
  type CleaningModelId,
  type QueuedResult,
  type ReplacementCategory,
  type ReplacementSize,
} from "@/lib/api";
import { compressImage, makeThumbnail, urlToDataUrl } from "@/lib/image";
import { useLibraryPicker } from "@/lib/library";
import { useGenerationWorkspace, type RefineRequest } from "@/lib/useGenerationWorkspace";
import { useAuth } from "@/lib/auth-context";
import { useModelQuality } from "@/lib/useModelQuality";
import { can } from "@/lib/permissions";
import { ToolAccessNotice } from "@/components/studio/ToolAccessNotice";
import { cn } from "@/lib/utils";

const PERMISSION = "tool.cleaning.run";
/** Gemini only: the answer is lined up with the photo by the frame Gemini is asked to return. */
const MODEL_OPTIONS = toModelOptions(CLEANING_MODELS);

/** What is being worn — each is fitted and sized against its own part of the body (ids as in prompts/replacement.js). */
const CATEGORIES: { id: ReplacementCategory; label: string; placeholder: string }[] = [
  { id: "ring", label: "Ring", placeholder: "e.g. a thin 1.5 mm yellow-gold band with a small 0.3 ct round solitaire" },
  { id: "earrings", label: "Earrings", placeholder: "e.g. small 4 mm round diamond studs in white gold" },
  { id: "necklace", label: "Necklace", placeholder: "e.g. a fine 1 mm gold chain with a 10 mm heart pendant" },
  { id: "bracelet", label: "Bracelet", placeholder: "e.g. a slim 2 mm tennis bracelet with round diamonds" },
];

/** "As described" leaves the size to the description — or to the piece's true size when there is none. */
const SIZES: { id: ReplacementSize | "described"; label: string }[] = [
  { id: "described", label: "As described" },
  { id: "delicate", label: "Delicate" },
  { id: "classic", label: "Classic" },
  { id: "statement", label: "Statement" },
];

/** What each piece is sized against, in the size note. */
const BODY: Record<ReplacementCategory, string> = { ring: "finger", earrings: "ear", necklace: "neck", bracelet: "wrist" };

const REFINE_HINTS = ["Make the piece smaller", "Make the metal shinier", "Add more sparkle to the stones", "Soften the shadow under the piece"];

type Slot = "photo" | "piece";

/** A stored url (a reopened run) is fetched back into bytes, which is what the model edits. */
function asDataUrl(src: string) {
  return src.startsWith("data:") ? Promise.resolve(src) : urlToDataUrl(src);
}

/**
 * Replacement: the jewellery in a photo of someone wearing it, swapped for a
 * different piece. The person drops the photo, the new piece's product shot
 * (or a description of it, or both) and how big it is; the result keeps the
 * hand, skin and background exactly as photographed — only the jewellery is
 * the model's (see the backend's services/photoComposite.js).
 */
export default function ReplacementPage() {
  const { user } = useAuth();

  const [category, setCategory] = useState<ReplacementCategory>("ring");
  const [photo, setPhoto] = useState<string | null>(null);
  const [piece, setPiece] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [size, setSize] = useState<ReplacementSize | "described">("described");
  const [model, setModel] = useState<CleaningModelId>(DEFAULT_CLEANING_MODEL);
  const [quality, setQuality] = useModelQuality(model);
  const [dropTarget, setDropTarget] = useState<Slot | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  /** Which box the file picker — or the library — is filling. */
  const pickingFor = useRef<Slot>("photo");
  const library = useLibraryPicker(fileInput);

  const kind = CATEGORIES.find((entry) => entry.id === category)!;
  const sizeValue = size === "described" ? null : size;

  /**
   * A follow-up from the chat. The photo and the new piece go with it every
   * time: the answer is put back into the original photo, not into the
   * result it changes, so colour can't drift from turn to turn.
   */
  async function sendChange(body: RefineRequest): Promise<ApiResult<QueuedResult>> {
    if (!photo) return { status: "error", message: "The original photo isn't available — start a new replacement" };
    let original: string;
    let product: string | undefined;
    try {
      [original, product] = await Promise.all([asDataUrl(photo), piece ? asDataUrl(piece) : Promise.resolve(undefined)]);
    } catch {
      return { status: "error", message: "Could not load the original photo — start a new replacement" };
    }
    return replaceJewellery({
      photo: original,
      piece: product,
      category,
      size: sizeValue,
      description: description.trim() || undefined,
      model,
      quality,
      change: {
        image: body.refineImage,
        instruction: body.instruction,
        displayPrompt: body.displayPrompt,
        references: body.referenceImages,
        source: body.refineSource,
      },
      conversationId: body.conversationId,
      parentGenerationId: body.parentGenerationId,
    });
  }

  const workspace = useGenerationWorkspace({
    tool: "cleaning",
    resumeLabel: "Replace the jewellery",
    onRefine: sendChange,
    // A run reopened from History gets its photo, piece and settings back, so
    // the chat can go on changing it.
    onResume: ({ model: resumedModel, generations }) => {
      const resumed = resolveModelId(CLEANING_MODELS, resumedModel);
      if (resumed) setModel(resumed);

      const settings = [...generations].reverse().find((turn) => turn.replacement)?.replacement;
      if (settings) {
        setCategory(settings.category);
        setSize(settings.size ?? "described");
        setDescription(settings.description ?? "");
      }
      const inputs = generations[0]?.inputAssets ?? [];
      setPhoto(inputs.find((asset) => asset.role === "uploaded")?.url ?? null);
      setPiece(inputs.find((asset) => asset.role === "reference")?.url ?? null);
    },
  });

  if (!can(user, PERMISSION)) {
    return <ToolAccessNotice tool="Image Cleaning" />;
  }

  async function place(slot: Slot, file: File | undefined) {
    if (!file || !file.type.startsWith("image/")) return;
    try {
      const image = await compressImage(file);
      (slot === "photo" ? setPhoto : setPiece)(image);
    } catch (err) {
      workspace.setError(err instanceof Error ? err.message : "Could not read that file");
    }
  }

  function pick(slot: Slot) {
    pickingFor.current = slot;
    library.show();
  }

  const busy = workspace.isGenerating;
  // A colleague's run, opened to read: nothing on it can be changed.
  const locked = busy || Boolean(workspace.readOnly);
  const hasPiece = Boolean(piece || description.trim());
  const ready = Boolean(photo) && hasPiece;

  async function handleGenerate() {
    if (locked || !photo || !hasPiece) return;
    let original: string;
    let product: string | undefined;
    try {
      [original, product] = await Promise.all([asDataUrl(photo), piece ? asDataUrl(piece) : Promise.resolve(undefined)]);
    } catch {
      workspace.setError("Could not load your photos — add them again");
      return;
    }
    const preview = await makeThumbnail(original);
    const text = description.trim();
    workspace.generate(
      () =>
        replaceJewellery({
          photo: original,
          piece: product,
          category,
          size: sizeValue,
          description: text || undefined,
          model,
          quality,
          preview,
        }),
      {
        count: 1,
        prompt: `Replace the ${kind.label.toLowerCase()}${text ? ` — ${text}` : ""}`,
        images: product ? [original, product] : [original],
      }
    );
  }

  // The run plays out in the chat, like every other tool: the result lands on
  // the stage and is refined there. "Back to setup" returns to the photos.
  if (workspace.status === "generating" || workspace.status === "done") {
    return (
      <GenerationResults
        workspace={workspace}
        modelOptions={MODEL_OPTIONS}
        modelValue={model}
        onModelChange={setModel}
        qualityValue={quality}
        onQualityChange={setQuality}
        hints={REFINE_HINTS}
        busyLabel="Replacing…"
        resetLabel="Back to setup"
        downloadName="replacement.jpg"
        modelLabel={CLEANING_MODELS.find((entry) => entry.id === model)?.label}
      />
    );
  }

  const slots: { id: Slot; title: string; hint: string; image: string | null }[] = [
    { id: "photo", title: "Photo to change", hint: `Someone wearing the ${kind.label.toLowerCase()} to swap`, image: photo },
    {
      id: "piece",
      title: "New jewellery",
      hint: piece ? "Your product photo" : "Its product photo — optional if you describe it",
      image: piece,
    },
  ];

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
              void place(pickingFor.current, event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <LibraryPicker
            open={library.open}
            onClose={library.close}
            onFiles={(files) => void place(pickingFor.current, files[0])}
            room={1}
          />

          <section className="space-y-2">
            <h2 className="text-[10px] font-semibold uppercase tracking-wider text-faint">Jewellery</h2>
            <OptionChips options={CATEGORIES} value={category} onChange={(id) => !locked && setCategory(id)} />
          </section>

          <section className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-[10px] font-semibold uppercase tracking-wider text-faint">Photos</h2>
              <span className="text-[10px] text-faint">Only the jewellery changes — the hand, skin and background stay as photographed</span>
            </div>

            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              {slots.map((slot, index) => (
                <div key={slot.id} className="contents">
                  {index === 1 && <ArrowRight size={16} className="text-faint" aria-hidden />}
                  <div
                    onDragOver={(event) => {
                      if (locked) return;
                      event.preventDefault();
                      setDropTarget(slot.id);
                    }}
                    onDragLeave={() => setDropTarget(null)}
                    onDrop={(event) => {
                      event.preventDefault();
                      setDropTarget(null);
                      if (!locked) void place(slot.id, event.dataTransfer.files[0]);
                    }}
                    className={cn(
                      "flex min-w-0 flex-col gap-2 rounded-xl border p-2.5 transition-colors",
                      dropTarget === slot.id
                        ? "border-gold/50 bg-gold/[0.08]"
                        : slot.image
                          ? "border-white/[0.08] bg-white/[0.02]"
                          : "border-gold/30 bg-gold/[0.04]"
                    )}
                  >
                    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg border border-white/[0.06] bg-white">
                      {slot.image ? (
                        <>
                          <Image src={slot.image} alt={slot.title} fill sizes="320px" className="object-contain" />
                          <button
                            type="button"
                            hidden={locked}
                            onClick={() => (slot.id === "photo" ? setPhoto : setPiece)(null)}
                            aria-label={`Remove the ${slot.title.toLowerCase()}`}
                            className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white/85 transition-colors hover:bg-black/75"
                          >
                            <X size={12} />
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          disabled={locked}
                          onClick={() => pick(slot.id)}
                          className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-faint transition-colors hover:text-cream disabled:pointer-events-none"
                        >
                          <Upload size={18} />
                          <span className="text-[10px]">Add photo</span>
                        </button>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium text-cream">{slot.title}</p>
                      <p className="truncate text-[10px] text-faint" title={slot.hint}>
                        {slot.hint}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-[10px] font-semibold uppercase tracking-wider text-faint">Size of the new piece</h2>
            <OptionChips options={SIZES} value={size} onChange={(id) => !locked && setSize(id)} />
            <p className="text-[10px] text-faint">
              {size === "described"
                ? `Give the size in the description — "thin 1.5 mm band", "0.3 ct stone" — and it is drawn true to it against the ${BODY[category]}.`
                : `Drawn ${size} against the ${BODY[category]}.`}{" "}
              Never at the size of the piece it replaces, or how big it looks in its product photo.
            </p>
          </section>

          <div className="space-y-1">
            <PromptCard
              label={
                <>
                  Describe the new piece{" "}
                  <span className="font-normal normal-case text-faint">{piece ? "(optional — say how big it is)" : "(or add its photo)"}</span>
                </>
              }
              value={description}
              onChange={setDescription}
              rows={2}
              placeholder={kind.placeholder}
              footerEnd={
                <InlineModelSelect models={CLEANING_MODELS} value={model} onChange={setModel} showQuality quality={quality} onQualityChange={setQuality} />
              }
            />

            <RunButton
              onClick={handleGenerate}
              disabled={locked || !ready}
              icon={busy ? <Loader2 size={14} className="animate-spin" /> : <Replace size={14} />}
            >
              {workspace.readOnly
                ? `${workspace.readOnly.ownerName ?? "A colleague"}'s replacement — read only`
                : !photo
                  ? "Add the photo to change"
                  : !hasPiece
                    ? "Add the new piece's photo, or describe it"
                    : `Replace the ${kind.label.toLowerCase()}`}
            </RunButton>
          </div>
        </div>
      </div>
    </div>
  );
}
