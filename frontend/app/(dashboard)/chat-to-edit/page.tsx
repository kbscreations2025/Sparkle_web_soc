"use client";

import { useEffect, useRef, useState } from "react";
import { ErrorBanner } from "@/components/studio/ToolChrome";
import { useSearchParams } from "next/navigation";
import { ImagePlus, Upload } from "lucide-react";
import { ChatMessages } from "@/components/studio/ChatMessages";
import { GenerationStage } from "@/components/studio/GenerationStage";
import { ChatInputBar } from "@/components/studio/ChatInputBar";
import { ReadOnlyChatNotice } from "@/components/studio/ReadOnlyChatNotice";
import { usePhotoPicker } from "@/components/studio/SinglePhotoUpload";
import { StudioSplitLayout } from "@/components/studio/StudioSplitLayout";
import { AnnotationOverlay } from "@/components/studio/AnnotationOverlay";
import { AnnotationLayer } from "@/components/studio/AnnotationLayer";
import { ToolHeader } from "@/components/studio/ToolHeader";
import { turnImages, type ChatMsg } from "@/components/studio/chat";
import {
  chatEdit,
  fetchConversationForTool,
  resolveModelId,
  IMAGE_EDIT_MODELS,
  DEFAULT_IMAGE_EDIT_MODEL,
  toModelOptions,
  REFERENCE_ROLE_OPTIONS,
  type ImageEditModelId,
  type ReferenceRole,
} from "@/lib/api";
import { compressImage, makeThumbnail, urlToDataUrl } from "@/lib/image";
import { useAttachments } from "@/lib/useAttachments";
import { useAuth } from "@/lib/auth-context";
import { useCreditGuard } from "@/lib/credit-guard";
import { useJobs } from "@/lib/jobs-context";
import { failureMessage, useSettledJob } from "@/lib/useSettledJob";
import { useModelQuality } from "@/lib/useModelQuality";
import { can } from "@/lib/permissions";
import { ToolAccessNotice } from "@/components/studio/ToolAccessNotice";

const CHAT_TO_EDIT_PERMISSION = "tool.chat_to_edit.run";

const MODEL_OPTIONS = toModelOptions(IMAGE_EDIT_MODELS);

const START_HINTS = ["Attach a jewellery photo to begin"];
// Offered before the first edit and again under every result, so the next
// common change is always one click away.
const EDIT_HINTS = [
  "Make the metal shinier",
  "Make the background pure white",
  "Remove the reflection on the stone",
  "Warm up the lighting",
];

// Shown once something is attached: what an attachment can do, set on its chip.
const ATTACHMENT_HINTS = [
  "Replace the centre stone with this one",
  "Give the band this texture",
  "Put this ring on the hand",
  "Replace the ring with this one",
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
  const [model, setModel] = useState<ImageEditModelId>(DEFAULT_IMAGE_EDIT_MODEL);
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

  /*
   * The turn this page is waiting on: its queued job, and what to hand back to
   * the composer if it fails. The edit runs in the queue, so it shows in the
   * rail with its progress and carries on through a reload.
   */
  const { jobs: queueJobs, track } = useJobs();
  const [waiting, setWaiting] = useState<{ jobId: string; instruction: string; baseImage: string; refsThisTurn: string[] } | null>(null);
  const waitingJob = waiting ? (queueJobs.find((job) => job.id === waiting.jobId) ?? null) : null;

  useSettledJob(waitingJob, (job) => {
    const turn = waiting!;
    setWaiting(null);
    setBusy(false);
    const urls = job.result?.outputUrls?.length ? job.result.outputUrls : job.result?.outputUrl ? [job.result.outputUrl] : [];
    if (job.status !== "completed" || !urls.length) {
      // A failed turn, keeping what to put back in the composer on retry.
      setHistory((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: failureMessage(job, "The model returned no image"),
          retryInstruction: turn.instruction,
          retryImage: turn.baseImage,
          retryRefImages: turn.refsThisTurn,
        },
      ]);
      return;
    }
    conversationId.current = job.result?.conversationId ?? conversationId.current;
    parentGenerationId.current = job.result?.generationId ?? parentGenerationId.current;
    // The stored url — shown at once; the next edit fetches its bytes (see send).
    setCurrentImage(urls[0]);
    setPendingImage(null);
    setHistory((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "Updated",
        image: urls[0],
        // Several when the turn asked for more design options.
        images: urls,
        note: job.result?.intentLabel ?? undefined,
      },
    ]);
  });

  async function stageStartImage(file: File) {
    setError("");
    try {
      setPendingImage(await compressImage(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that file");
    }
  }

  // The photo to start from can be an earlier upload or result — see UploadZone.
  const startPicker = usePhotoPicker((file) => file && stageStartImage(file));

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
      const resumedModel = resolveModelId(IMAGE_EDIT_MODELS, last.model);
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
    // A turn still running carries on in the queue and lands in History;
    // this chat just stops waiting for it.
    setWaiting(null);
    setBusy(false);
    conversationId.current = null;
    parentGenerationId.current = null;
  }

  /**
   * One turn, whether it's the first (staging a photo, no prior result) or
   * the Nth (editing the current result). Both paths go through this same
   * function — there is no separate "generate" vs "refine" handler.
   */
  async function send(instructionOverride?: string) {
    // The picked option is the one edited next — after "more designs" there
    // are several, and the user continues from whichever they chose.
    const baseImage = selectedView ?? currentImage ?? pendingImage;
    if (!baseImage || readOnly || waiting) return;

    const instruction = (instructionOverride ?? chatInput).trim() || "Enhance this image.";
    const refsThisTurn = annotatedPhoto ? [annotatedPhoto, ...referenceImages] : referenceImages;
    // A marked-up copy of the photo only shows where — every other image goes
    // as its chip says (see REFERENCE_ROLE_OPTIONS).
    const pickedRoles = referenceImages.map((_, index) => (attach.referenceRoles[index] ?? "auto") as ReferenceRole);
    const rolesThisTurn: ReferenceRole[] = annotatedPhoto ? ["marks", ...pickedRoles] : pickedRoles;

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
    attach.setReferenceRoles([]);
    attach.setAnnotatedPhoto(null);
    setSelectedView(null);
    setError("");
    setBusy(true);

    try {
      // The backend edits bytes, not links: a result shown from its stored url
      // (every finished turn, and a resumed thread) is fetched here.
      const editable = baseImage.startsWith("data:") ? baseImage : await urlToDataUrl(baseImage);
      const result = await chatEdit({
        image: editable,
        referenceImages: refsThisTurn,
        referenceRoles: rolesThisTurn,
        instruction,
        displayPrompt: instruction,
        model,
        quality,
        conversationId: conversationId.current,
        parentGenerationId: parentGenerationId.current,
        // So the queue rail shows this photo rather than a bare spinner.
        preview: await makeThumbnail(editable),
      });

      if (result.status === "queued" && result.job) {
        // `busy` stays on until the job settles — see useSettledJob above.
        setWaiting({ jobId: result.job.id, instruction, baseImage, refsThisTurn });
        track(result.job);
        return;
      }
      if (creditGuard(result)) {
        // The edit was priced and refused, so it never ran. Take the turn back
        // out of the thread and return the instruction and its attachments to
        // the composer — the dialog is the only account of what happened.
        setHistory((current) => current.slice(0, -1));
        setChatInput(instruction);
        // Each back in its own slot, with the roles that were picked for it.
        attach.setReferenceImages(referenceImages);
        attach.setReferenceRoles(pickedRoles);
        attach.setAnnotatedPhoto(annotatedPhoto);
      } else {
        pushFailure(result.message || "Could not start this edit", { instruction, baseImage, refsThisTurn });
      }
    } catch {
      pushFailure("Could not reach the server", { instruction, baseImage, refsThisTurn });
    }
    // Only a turn that never reached the queue ends here; a queued one ends
    // when its job settles.
    setBusy(false);
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
    attach.setReferenceRoles([]);
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
              // The edit's own preview, pushed the moment the model answers.
              busyImages={waitingJob?.partials}
              onSelectResult={setSelectedView}
              onRetry={readOnly ? undefined : retry}
              hints={
                // Not on a colleague's thread, which can't be edited. With a
                // photo in play — before the first edit or under the latest
                // result (ChatMessages hides them while one is running) — the
                // edits that fit what's attached; with none yet, how to start.
                readOnly
                  ? undefined
                  : currentImage || pendingImage
                    ? referenceImages.length
                      ? ATTACHMENT_HINTS
                      : EDIT_HINTS
                    : history.length === 0
                      ? START_HINTS
                      : undefined
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
                roleOptions={REFERENCE_ROLE_OPTIONS}
                onAttachmentRoleChange={(attachment, role) =>
                  attach.setReferenceRole(Number(attachment.id.replace("ref-", "")), role)
                }
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
                // The edit's preview takes the stage the moment it lands; the
                // stored result replaces it when the job finishes.
                src={waitingJob?.partials?.at(-1) ?? displayImage}
                alt="Current"
                busy={busy && !waitingJob?.partials?.length}
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
                <button
                  type="button"
                  onClick={startPicker.show}
                  className="mt-1 flex items-center gap-2 rounded-xl border border-gold/25 bg-gold/10 px-4 py-2 text-xs font-medium text-gold transition-colors hover:border-gold/35 hover:bg-gold/15"
                >
                  <Upload size={13} /> {startPicker.available ? "Choose image" : "Upload image"}
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
      {startPicker.inputs}
    </div>
  );
}
