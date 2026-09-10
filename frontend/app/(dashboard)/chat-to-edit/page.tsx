"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ImagePlus, Upload } from "lucide-react";
import { ChatMessages } from "@/components/studio/ChatMessages";
import { GenerationStage } from "@/components/studio/GenerationStage";
import { ChatInputBar } from "@/components/studio/ChatInputBar";
import { Lightbox } from "@/components/studio/Lightbox";
import { AnnotationOverlay } from "@/components/studio/AnnotationOverlay";
import { ToolHeader } from "@/components/studio/ToolHeader";
import type { ChatMsg } from "@/components/studio/chat";
import type { Attachment } from "@/components/studio/AttachmentChips";
import {
  chatEdit,
  fetchConversationForTool,
  resolveModelId,
  SPARKLE_MODELS,
  DEFAULT_SPARKLE_MODEL,
  toModelOptions,
  type SparkleModelId,
} from "@/lib/api";
import { compressImage, urlToDataUrl } from "@/lib/image";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/permissions";

const CHAT_TO_EDIT_PERMISSION = "tool.chat_to_edit.run";

const MODEL_OPTIONS = toModelOptions(SPARKLE_MODELS);

/** Where an annotated copy gets written back to once the user hits Attach. */
type AnnotationTarget = "stage" | "photo" | { ref: number };

const START_HINTS = ["Attach a jewellery photo to begin"];
const EDIT_HINTS = [
  "Make the metal shinier",
  "Change the background to soft grey",
  "Remove the reflection on the stone",
  "Warm up the lighting",
];

export default function ChatToEditPage() {
  const { user } = useAuth();

  // The image actually being edited right now — null until the first send.
  const [currentImage, setCurrentImage] = useState<string | null>(null);
  // Staged before the first send; nothing is sent to the server until then.
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  // Reference images for the *next* turn — inspiration only, cleared on send.
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  // A marked-up copy of the current result (not a reference) — annotating
  // the stage again replaces this single slot instead of piling up new chips.
  const [annotatedPhoto, setAnnotatedPhoto] = useState<string | null>(null);
  // A past result the user clicked to browse back to, without losing `currentImage`.
  const [selectedView, setSelectedView] = useState<string | null>(null);

  const [history, setHistory] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [model, setModel] = useState<SparkleModelId>(DEFAULT_SPARKLE_MODEL);
  const [busy, setBusy] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  // Set instead of lightboxSrc when a chip preview is opened, so the lightbox
  // knows which slot to offer Annotate/Download for.
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null);
  // The image being marked up, and where the result should be written back
  // to — the base photo, one reference, or (from the stage) the current
  // result itself. Null when the annotation tools are closed.
  const [annotating, setAnnotating] = useState<{ src: string; target: AnnotationTarget } | null>(null);
  const [error, setError] = useState("");

  const conversationId = useRef<string | null>(null);
  const parentGenerationId = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const searchParams = useSearchParams();

  // Arriving from History with ?conversationId=... resumes that thread
  // instead of starting a blank chat — fetched once per id, not on every
  // render, since the id itself never changes for the life of this page.
  useEffect(() => {
    const resumeId = searchParams.get("conversationId");
    if (!resumeId) return;

    let cancelled = false;
    (async () => {
      const generations = await fetchConversationForTool(resumeId, "chat_to_edit");
      if (cancelled || !generations) return;

      const resumedHistory: ChatMsg[] = generations.flatMap((turn, index) => {
        const startImage = index === 0 ? turn.inputAssets.find((a) => a.role === "uploaded")?.url : undefined;
        const refImages = turn.inputAssets.filter((a) => a.role === "reference").map((a) => a.url);
        return [
          { id: `${turn.id}-user`, role: "user" as const, content: turn.userPrompt || "Edit this image", image: startImage, refImages: refImages.length ? refImages : undefined },
          { id: `${turn.id}-assistant`, role: "assistant" as const, content: "Updated", image: turn.outputAssets[0]?.url },
        ];
      });

      const last = generations[generations.length - 1];
      const resumedImage = last.outputAssets[0]?.url ?? null;
      setHistory(resumedHistory);
      setCurrentImage(resumedImage);
      conversationId.current = resumeId;
      parentGenerationId.current = last.id;
      const resumedModel = resolveModelId(SPARKLE_MODELS, last.model);
      if (resumedModel) setModel(resumedModel);

      // The stage paints instantly from the R2 URL above; swapped for the
      // data URI the backend actually requires once it's ready, since the
      // next edit sends whatever `currentImage` currently holds.
      if (resumedImage) {
        urlToDataUrl(resumedImage)
          .then((dataUrl) => setCurrentImage((current) => (current === resumedImage ? dataUrl : current)))
          .catch((err) => console.error("could not prepare resumed image for editing:", err));
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resumes once for this page's lifetime; re-running on searchParams identity changes would refetch on every unrelated navigation
  }, []);

  if (!can(user, CHAT_TO_EDIT_PERMISSION)) {
    return (
      <div className="flex-1 overflow-y-auto px-8 py-8">
        <p className="text-sm text-muted">
          Chat to Edit isn&apos;t enabled for your account. Ask an admin to grant you access.
        </p>
      </div>
    );
  }

  const displayImage = selectedView ?? currentImage ?? pendingImage;
  const started = Boolean(currentImage || pendingImage || history.length > 0);

  function resetAll() {
    setCurrentImage(null);
    setPendingImage(null);
    setReferenceImages([]);
    setAnnotatedPhoto(null);
    setSelectedView(null);
    setHistory([]);
    setChatInput("");
    setError("");
    conversationId.current = null;
    parentGenerationId.current = null;
  }

  async function stageStartImage(file: File) {
    setError("");
    try {
      setPendingImage(await compressImage(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that file");
    }
  }

  async function addReferenceImages(files: File[]) {
    setError("");
    try {
      const compressed = await Promise.all(files.map(compressImage));
      setReferenceImages((current) => [...current, ...compressed]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read those files");
    }
  }

  const attachments: Attachment[] = [
    ...(!currentImage && pendingImage ? [{ id: "pending", src: pendingImage, label: "Photo" }] : []),
    ...(annotatedPhoto ? [{ id: "photo", src: annotatedPhoto, label: "Photo" }] : []),
    ...referenceImages.map((src, i) => ({ id: `ref-${i}`, src, label: "Ref" })),
  ];

  function removeAttachment(attachment: Attachment) {
    if (attachment.id === "pending") return setPendingImage(null);
    if (attachment.id === "photo") return setAnnotatedPhoto(null);
    const index = Number(attachment.id.replace("ref-", ""));
    setReferenceImages((current) => current.filter((_, i) => i !== index));
  }

  function openAttachment(attachment: Attachment) {
    setPreviewAttachment(attachment);
  }

  /** Maps a chip back to the slot its annotated copy should be written into. */
  function targetForAttachment(attachment: Attachment): AnnotationTarget {
    if (attachment.id === "pending" || attachment.id === "photo") return "photo";
    return { ref: Number(attachment.id.replace("ref-", "")) };
  }

  /**
   * One turn, whether it's the first (staging a photo, no prior result) or
   * the Nth (editing the current result). Both paths go through this same
   * function — there is no separate "generate" vs "refine" handler.
   */
  async function send(instructionOverride?: string) {
    const baseImage = currentImage ?? pendingImage;
    if (!baseImage) return;

    const instruction = (instructionOverride ?? chatInput).trim() || "Enhance this image.";
    const refsThisTurn = annotatedPhoto ? [annotatedPhoto, ...referenceImages] : referenceImages;
    const isFirstTurn = !currentImage;

    const userMsg: ChatMsg = {
      id: crypto.randomUUID(),
      role: "user",
      content: instruction,
      // The base image is only shown as "attached" on the turn that staged
      // it; later turns are edits of what's already on screen.
      image: isFirstTurn ? baseImage : undefined,
      refImages: refsThisTurn.length ? refsThisTurn : undefined,
    };
    setHistory((current) => [...current, userMsg]);
    setChatInput("");
    setReferenceImages([]);
    setAnnotatedPhoto(null);
    setSelectedView(null);
    setError("");
    setBusy(true);

    try {
      const result = await chatEdit({
        image: baseImage,
        referenceImages: refsThisTurn,
        instruction,
        displayPrompt: instruction,
        model,
        conversationId: conversationId.current,
        parentGenerationId: parentGenerationId.current,
      });

      if (result.status === "success" && result.images?.[0]) {
        const edited = result.images[0];
        conversationId.current = result.conversationId ?? conversationId.current;
        parentGenerationId.current = result.generationId ?? parentGenerationId.current;
        setCurrentImage(edited);
        setPendingImage(null);
        setHistory((current) => [
          ...current,
          { id: crypto.randomUUID(), role: "assistant", content: "Updated", image: edited },
        ]);
      } else {
        pushFailure(result.message || "The model returned no image", { instruction, baseImage, refsThisTurn });
      }
    } catch {
      pushFailure("Could not reach the server", { instruction, baseImage, refsThisTurn });
    } finally {
      setBusy(false);
    }
  }

  function pushFailure(
    message: string,
    { instruction, baseImage, refsThisTurn }: { instruction: string; baseImage: string; refsThisTurn: string[] }
  ) {
    setHistory((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: "assistant",
        content: message,
        retryInstruction: instruction,
        retryImage: baseImage,
        retryRefImages: refsThisTurn,
      },
    ]);
  }

  /** Repopulates the input from a failed turn — the user reviews, then re-sends manually. */
  function retry(msg: ChatMsg) {
    if (msg.retryInstruction === undefined) return;
    setChatInput(msg.retryInstruction);
    setReferenceImages(msg.retryRefImages ?? []);
    // A failed *first* turn never produced a currentImage, so its image has
    // to go back into the pending slot rather than being assumed still current.
    if (!currentImage && msg.retryImage) setPendingImage(msg.retryImage);
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <ToolHeader
        title="Chat to Edit"
        description="Attach a jewellery image in chat · edit it conversationally, one message at a time"
        onReset={started ? resetAll : undefined}
        resetLabel="New chat"
      />

      {error && (
        <p className="shrink-0 border-b border-error/20 bg-error/[0.08] px-5 py-2 text-xs text-error">{error}</p>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* ── chat rail ── */}
        <div className="flex w-[300px] shrink-0 flex-col overflow-hidden border-r border-white/[0.06] xl:w-[340px]">
            <ChatMessages
              history={history}
              busy={busy}
              onSelectResult={(src) => setSelectedView(src)}
              onRetry={retry}
              hints={history.length === 0 ? (currentImage || pendingImage ? EDIT_HINTS : START_HINTS) : undefined}
              onHint={(hint) => (currentImage || pendingImage ? send(hint) : undefined)}
            />

            <div className="shrink-0 border-t border-white/[0.06] p-3">
              <ChatInputBar
              value={chatInput}
              onChange={setChatInput}
              onSend={() => send()}
              busy={busy}
              attachments={attachments}
              onOpenAttachment={openAttachment}
              onRemoveAttachment={removeAttachment}
              onAttachFiles={addReferenceImages}
              onPasteImage={(file) => addReferenceImages([file])}
              modelOptions={MODEL_OPTIONS}
              modelValue={model}
              onModelChange={setModel}
                placeholder={
                  currentImage || pendingImage
                    ? "Describe what to change…"
                    : "Attach a jewellery photo below, then describe your first edit…"
                }
              />
            </div>
        </div>

        {/* ── stage ── */}
        <div className="relative flex-1 overflow-hidden">
          {displayImage ? (
            <GenerationStage
              src={displayImage}
              alt="Current"
              busy={busy}
              busyLabel="Applying edit…"
              // Hidden while the annotation toolbar occupies the same corner.
              downloadName={annotating ? undefined : "edited.jpg"}
              onExpand={annotating ? undefined : setLightboxSrc}
              onAnnotate={annotating ? undefined : (src) => setAnnotating({ src, target: "stage" })}
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.04]">
                <ImagePlus size={20} className="text-faint" />
              </div>
              <div>
                <p className="text-sm font-medium text-cream">Attach an image to begin</p>
                <p className="mt-1 max-w-xs text-xs text-faint">
                  Upload a jewellery photo to start — no original image exists yet for this chat — then
                  describe your first edit.
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) stageStartImage(file);
                  event.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mt-1 flex items-center gap-2 rounded-xl border border-gold/25 bg-gold/10 px-4 py-2 text-xs font-medium text-gold transition-colors hover:border-gold/35 hover:bg-gold/15"
              >
                <Upload size={13} /> Upload image
              </button>
            </div>
          )}

          {annotating && annotating.target === "stage" && (
            <AnnotationOverlay
              src={annotating.src}
              onAttach={(marked) => {
                setAnnotatedPhoto(marked);
                setAnnotating(null);
              }}
              onClose={() => setAnnotating(null)}
            />
          )}
        </div>
      </div>

      {/* Reference/photo annotation replaces the preview it was opened from,
          so it stays full-screen like the Lightbox instead of jumping to the stage. */}
      {annotating && annotating.target !== "stage" && (
        <AnnotationOverlay
          fullscreen
          src={annotating.src}
          onAttach={(marked) => {
            const target = annotating.target as Exclude<AnnotationTarget, "stage">;
            if (target === "photo") {
              if (!currentImage) setPendingImage(marked);
              else setAnnotatedPhoto(marked);
            } else {
              setReferenceImages((current) => current.map((src, i) => (i === target.ref ? marked : src)));
            }
            setAnnotating(null);
          }}
          onClose={() => setAnnotating(null)}
        />
      )}

      <Lightbox
        src={previewAttachment?.src ?? lightboxSrc}
        onClose={() => {
          setLightboxSrc(null);
          setPreviewAttachment(null);
        }}
        downloadName={previewAttachment ? `${previewAttachment.label.toLowerCase()}.jpg` : undefined}
        onAnnotate={
          previewAttachment
            ? () => {
                setAnnotating({ src: previewAttachment.src, target: targetForAttachment(previewAttachment) });
                setPreviewAttachment(null);
              }
            : undefined
        }
      />
    </div>
  );
}
