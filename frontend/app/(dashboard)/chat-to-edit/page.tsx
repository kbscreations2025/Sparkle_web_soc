"use client";

import { useEffect, useRef, useState } from "react";
import { ErrorBanner } from "@/components/studio/ToolChrome";
import { useSearchParams } from "next/navigation";
import { ImagePlus, Upload } from "lucide-react";
import { ChatMessages } from "@/components/studio/ChatMessages";
import { GenerationStage } from "@/components/studio/GenerationStage";
import { ChatInputBar } from "@/components/studio/ChatInputBar";
import { ReadOnlyChatNotice } from "@/components/studio/ReadOnlyChatNotice";
import { StudioSplitLayout } from "@/components/studio/StudioSplitLayout";
import { AnnotationOverlay } from "@/components/studio/AnnotationOverlay";
import { AnnotationLayer } from "@/components/studio/AnnotationLayer";
import { ToolHeader } from "@/components/studio/ToolHeader";
import { turnImages, type ChatMsg } from "@/components/studio/chat";
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
import { useAttachments } from "@/lib/useAttachments";
import { useAuth } from "@/lib/auth-context";
import { useCreditGuard } from "@/lib/credit-guard";
import { useModelQuality } from "@/lib/useModelQuality";
import { can } from "@/lib/permissions";
import { ToolAccessNotice } from "@/components/studio/ToolAccessNotice";

const CHAT_TO_EDIT_PERMISSION = "tool.chat_to_edit.run";

const MODEL_OPTIONS = toModelOptions(SPARKLE_MODELS);

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
  // A past result the user clicked to browse back to, without losing `currentImage`.
  const [selectedView, setSelectedView] = useState<string | null>(null);

  const [history, setHistory] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [model, setModel] = useState<SparkleModelId>(DEFAULT_SPARKLE_MODEL);
  const [quality, setQuality] = useModelQuality(model);
  const [busy, setBusy] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [error, setError] = useState("");
  /** A colleague's chat reopened to read — no composer, and `send` refuses. */
  const [readOnly, setReadOnly] = useState<{ ownerName: string | null } | null>(null);

  // An annotated *photo* goes back into whichever slot holds the base image:
  // the pending one before the first send, the annotated-copy slot after it.
  const attach = useAttachments({
    extra: !currentImage && pendingImage ? { id: "pending", src: pendingImage, label: "Photo" } : null,
    onRemoveExtra: () => setPendingImage(null),
    onSavePhoto: (marked) => (currentImage ? attach.setAnnotatedPhoto(marked) : setPendingImage(marked)),
    onError: setError,
  });
  const { referenceImages, annotatedPhoto, annotating, setAnnotating } = attach;
  const creditGuard = useCreditGuard();

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
      const thread = await fetchConversationForTool(resumeId, "chat_to_edit");
      if (cancelled || !thread) return;
      const { generations } = thread;
      setReadOnly(thread.readOnly ? { ownerName: thread.ownerName } : null);

      const resumedHistory: ChatMsg[] = generations.flatMap((turn) => {
        return [
          // Every turn with the image it edited — the upload on the first,
          // the version being changed on each after — plus its references.
          { id: `${turn.id}-user`, role: "user" as const, content: turn.userPrompt || "Edit this image", ...turnImages(turn.inputAssets) },
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
      // next edit sends whatever `currentImage` currently holds. Not needed
      // for a read-only thread, which never sends an edit.
      if (resumedImage && !thread.readOnly) {
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
    return <ToolAccessNotice tool="Chat to Edit" />;
  }

  const displayImage = selectedView ?? currentImage ?? pendingImage;
  const started = Boolean(currentImage || pendingImage || history.length > 0);

  function resetAll() {
    setCurrentImage(null);
    setPendingImage(null);
    attach.reset();
    setSelectedView(null);
    setHistory([]);
    setChatInput("");
    setError("");
    setReadOnly(null);
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

  /**
   * One turn, whether it's the first (staging a photo, no prior result) or
   * the Nth (editing the current result). Both paths go through this same
   * function — there is no separate "generate" vs "refine" handler.
   */
  async function send(instructionOverride?: string) {
    const baseImage = currentImage ?? pendingImage;
    if (!baseImage || readOnly) return;

    const instruction = (instructionOverride ?? chatInput).trim() || "Enhance this image.";
    const refsThisTurn = annotatedPhoto ? [annotatedPhoto, ...referenceImages] : referenceImages;

    const userMsg: ChatMsg = {
      id: crypto.randomUUID(),
      role: "user",
      content: instruction,
      // Every turn shows the image it edits: the staged photo on the first,
      // the current version on each after — so a request is never read
      // without knowing which picture it was about.
      image: baseImage,
      refImages: refsThisTurn.length ? refsThisTurn : undefined,
    };
    setHistory((current) => [...current, userMsg]);
    setChatInput("");
    attach.setReferenceImages([]);
    attach.setAnnotatedPhoto(null);
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
        quality,
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
      } else if (creditGuard(result)) {
        // The edit was priced and refused, so it never ran. Take the turn back
        // out of the thread and return the instruction and its attachments to
        // the composer — the dialog is the only account of what happened.
        setHistory((current) => current.slice(0, -1));
        setChatInput(instruction);
        attach.setReferenceImages(refsThisTurn);
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
    attach.setReferenceImages(msg.retryRefImages ?? []);
    // A failed *first* turn never produced a currentImage, so its image has
    // to go back into the pending slot rather than being assumed still current.
    if (!currentImage && msg.retryImage) setPendingImage(msg.retryImage);
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <ToolHeader onReset={started ? resetAll : undefined} resetLabel="New chat" />

      <ErrorBanner message={error} />

      <StudioSplitLayout
        chatRail={
          <>
            <ChatMessages
              history={history}
              busy={busy}
              onSelectResult={(src) => setSelectedView(src)}
              onRetry={readOnly ? undefined : retry}
              hints={
                !readOnly && history.length === 0 ? (currentImage || pendingImage ? EDIT_HINTS : START_HINTS) : undefined
              }
              onHint={(hint) => (currentImage || pendingImage ? send(hint) : undefined)}
            />

            <div className="shrink-0 border-t border-white/[0.06] p-3">
              {readOnly ? (
                <ReadOnlyChatNotice ownerName={readOnly.ownerName} />
              ) : (
              <ChatInputBar
                value={chatInput}
                onChange={setChatInput}
                onSend={() => send()}
                busy={busy}
                attachments={attach.attachments}
                onOpenAttachment={attach.setPreviewAttachment}
                onRemoveAttachment={attach.removeAttachment}
                onAttachFiles={attach.addReferenceImages}
                onPasteImage={(file) => attach.addReferenceImages([file])}
                modelOptions={MODEL_OPTIONS}
                modelValue={model}
                onModelChange={setModel}
                qualityValue={quality}
                onQualityChange={setQuality}
                placeholder={
                  currentImage || pendingImage
                    ? "Describe what to change…"
                    : "Attach a jewellery photo below, then describe your first edit…"
                }
              />
              )}
            </div>
          </>
        }
        stage={
          <>
            {displayImage ? (
              <GenerationStage
                src={displayImage}
                alt="Current"
                busy={busy}
                busyLabel="Applying edit…"
                // Hidden while the annotation toolbar occupies the same corner.
                downloadName={annotating ? undefined : "edited.jpg"}
                onExpand={annotating ? undefined : setLightboxSrc}
                onAnnotate={annotating || readOnly ? undefined : (src) => setAnnotating({ src, target: "stage" })}
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
                onAttach={attach.saveAnnotation}
                onClose={() => setAnnotating(null)}
              />
            )}
          </>
        }
      />

      <AnnotationLayer attachments={attach} lightboxSrc={lightboxSrc} onCloseLightbox={() => setLightboxSrc(null)} />
    </div>
  );
}
