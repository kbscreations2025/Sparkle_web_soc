"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import { Loader2, PenLine, Sparkles, Wand2 } from "lucide-react";
import { UploadZone, type UploadItem } from "@/components/studio/UploadZone";
import { ModelSelector } from "@/components/studio/ModelSelector";
import { GenerationStage } from "@/components/studio/GenerationStage";
import { ChatMessages } from "@/components/studio/ChatMessages";
import { ChatInputBar } from "@/components/studio/ChatInputBar";
import { Lightbox } from "@/components/studio/Lightbox";
import { AnnotationOverlay } from "@/components/studio/AnnotationOverlay";
import { ToolHeader } from "@/components/studio/ToolHeader";
import type { ChatMsg } from "@/components/studio/chat";
import type { Attachment } from "@/components/studio/AttachmentChips";
import {
  cleanImage,
  refineImage,
  fetchConversationForTool,
  resolveModelId,
  CLEANING_MODELS,
  DEFAULT_CLEANING_MODEL,
  toModelOptions,
  type CleaningModelId,
} from "@/lib/api";
import { compressImage, urlToDataUrl } from "@/lib/image";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";

const CLEANING_PERMISSION = "tool.cleaning.run";

/** One-click fixes people ask for most on a cleaning result. */
const REFINE_SUGGESTIONS = [
  "Make background pure white",
  "Increase diamond brightness",
  "Remove background shadow",
  "Add more sparkle to stones",
];

const MODEL_OPTIONS = toModelOptions(CLEANING_MODELS);

/** One uploaded photo, its result, and the chat thread of refinements on it. */
type Job = {
  id: string;
  name: string;
  original: string;
  /** Latest cleaned version. Replaced by each refinement. */
  cleaned: string | null;
  status: "queued" | "running" | "done" | "failed";
  error?: string;
  conversationId?: string | null;
  generationId?: string | null;
  history: ChatMsg[];
};

export default function CleaningDefaultPage() {
  const { user } = useAuth();

  const [items, setItems] = useState<UploadItem[]>([]);
  const [model, setModel] = useState<CleaningModelId>(DEFAULT_CLEANING_MODEL);
  const [useCustomPrompt, setUseCustomPrompt] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");

  const [jobs, setJobs] = useState<Job[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [refining, setRefining] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  // A past result the user clicked in the thread — shown on the stage without
  // losing the job's actual `cleaned` value underneath it.
  const [selectedView, setSelectedView] = useState<string | null>(null);
  // Reference images for the *next* refinement — inspiration only, cleared once sent.
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  // A marked-up copy of the result itself (not a reference) — annotating the
  // stage again replaces this single slot instead of piling up new chips.
  const [annotatedPhoto, setAnnotatedPhoto] = useState<string | null>(null);
  // Set instead of lightboxSrc when a reference chip is opened, so the
  // lightbox knows which one to offer Annotate for.
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null);
  // The image being marked up, and where the result should be written back
  // to — the current result itself, or one reference. Null when closed.
  const [annotating, setAnnotating] = useState<{ src: string; target: "stage" | "photo" | { ref: number } } | null>(null);

  const searchParams = useSearchParams();

  // Arriving from History with ?conversationId=... resumes that thread
  // instead of starting a fresh upload — fetched once per id, not on every
  // render, since the id itself never changes for the life of this page.
  useEffect(() => {
    const conversationId = searchParams.get("conversationId");
    if (!conversationId) return;

    let cancelled = false;
    (async () => {
      const generations = await fetchConversationForTool(conversationId, "cleaning");
      if (cancelled || !generations) return;

      const [first] = generations;
      const original = first.inputAssets.find((a) => a.role === "uploaded")?.url ?? first.inputAssets[0]?.url ?? "";
      const last = generations[generations.length - 1];
      const cleaned = last.outputAssets[0]?.url ?? null;

      // The full thread, from the very first clean through every refinement —
      // not just the follow-ups — so resuming reads like the conversation
      // actually happened, not like it started mid-way through.
      const history: ChatMsg[] = generations.flatMap((turn, index) => [
        {
          id: `${turn.id}-user`,
          role: "user" as const,
          content: turn.userPrompt || (index === 0 ? "Clean this image" : "Refine this"),
        },
        { id: `${turn.id}-assistant`, role: "assistant" as const, content: "Updated", image: turn.outputAssets[0]?.url },
      ]);

      setJobs([
        {
          id: conversationId,
          name: "Resumed photo",
          original,
          cleaned,
          status: "done",
          conversationId,
          generationId: last.id,
          history,
        },
      ]);
      setSelectedId(conversationId);
      const resumedModel = resolveModelId(CLEANING_MODELS, last.model);
      if (resumedModel) setModel(resumedModel);

      // The stage paints instantly from the R2 URL above; swapped for the
      // data URI the backend actually requires once it's ready, since a
      // refine call sends whatever `cleaned` currently holds.
      if (cleaned) {
        urlToDataUrl(cleaned)
          .then((dataUrl) => updateJob(conversationId, { cleaned: dataUrl }))
          .catch((err) => console.error("could not prepare resumed image for editing:", err));
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resumes once for this page's lifetime; re-running on searchParams identity changes would refetch on every unrelated navigation
  }, []);

  if (!can(user, CLEANING_PERMISSION)) {
    return (
      <div className="flex-1 overflow-y-auto px-8 py-8">
        <p className="text-sm text-muted">
          Image Cleaning isn&apos;t enabled for your account. Ask an admin to grant you access.
        </p>
      </div>
    );
  }

  function updateJob(id: string, patch: Partial<Job>) {
    setJobs((current) => current.map((job) => (job.id === id ? { ...job, ...patch } : job)));
  }

  async function handleAdd(files: File[]) {
    setError("");
    try {
      const added = await Promise.all(
        files.map(async (file) => ({
          id: crypto.randomUUID(),
          name: file.name,
          dataUrl: await compressImage(file),
        }))
      );
      setItems((current) => [...current, ...added]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read those files");
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
    ...(annotatedPhoto ? [{ id: "photo", src: annotatedPhoto, label: "Photo" }] : []),
    ...referenceImages.map((src, i) => ({ id: `ref-${i}`, src, label: "Ref" })),
  ];

  function removeAttachment(attachment: Attachment) {
    if (attachment.id === "photo") return setAnnotatedPhoto(null);
    const index = Number(attachment.id.replace("ref-", ""));
    setReferenceImages((current) => current.filter((_, i) => i !== index));
  }

  /** Maps a chip back to the slot its re-annotated copy should be written into. */
  function targetForAttachment(attachment: Attachment): "photo" | { ref: number } {
    return attachment.id === "photo" ? "photo" : { ref: Number(attachment.id.replace("ref-", "")) };
  }

  /**
   * One request per photo, in sequence. The model takes several seconds each
   * and firing them together would risk tripping the provider's rate limit,
   * so results stream in one at a time instead.
   */
  async function handleGenerate() {
    if (items.length === 0) return;

    setRunning(true);
    setError("");

    const queued: Job[] = items.map((item) => ({
      id: item.id,
      name: item.name,
      original: item.dataUrl,
      cleaned: null,
      status: "queued",
      history: [],
    }));
    setJobs(queued);
    setSelectedId(queued[0]?.id ?? null);

    for (const item of items) {
      updateJob(item.id, { status: "running" });
      try {
        const result = await cleanImage({
          image: item.dataUrl,
          model,
          ...(useCustomPrompt && customPrompt.trim() && { customPrompt: customPrompt.trim() }),
        });

        if (result.status === "success" && result.result) {
          updateJob(item.id, {
            status: "done",
            cleaned: result.result,
            conversationId: result.conversationId,
            generationId: result.generationId,
            // Empty, not seeded with the result: the initial clean already
            // shows in the big viewer, so the thread starts blank and the
            // suggestion hints (which only appear on an empty thread) are
            // visible right away rather than after the first refinement.
            history: [],
          });
        } else {
          updateJob(item.id, { status: "failed", error: result.message || "The model returned no image" });
        }
      } catch {
        updateJob(item.id, { status: "failed", error: "Could not reach the server" });
      }
    }

    setRunning(false);
  }

  /**
   * Appends one message to a job's thread via a functional update — never
   * reads `jobs` from the surrounding closure, since that snapshot can be
   * stale by the time an `await`ed request resolves.
   */
  function appendMessage(jobId: string, msg: ChatMsg) {
    setJobs((current) =>
      current.map((row) => (row.id === jobId ? { ...row, history: [...row.history, msg] } : row))
    );
  }

  /**
   * Applies a follow-up instruction to the selected result. Takes the text
   * explicitly rather than always reading `chatInput` state, so a suggestion
   * chip can fire the same request without waiting on a state update to land.
   */
  async function handleRefine(text: string) {
    const job = jobs.find((row) => row.id === selectedId);
    if (!job?.cleaned || !text.trim()) return;

    const refsThisTurn = annotatedPhoto ? [annotatedPhoto, ...referenceImages] : referenceImages;
    appendMessage(job.id, {
      id: crypto.randomUUID(),
      role: "user",
      content: text.trim(),
      refImages: refsThisTurn.length ? refsThisTurn : undefined,
    });
    setChatInput("");
    setReferenceImages([]);
    setAnnotatedPhoto(null);
    setSelectedView(null);
    setRefining(true);
    setError("");

    try {
      const result = await refineImage({
        refineImage: job.cleaned,
        instruction: text.trim(),
        model,
        referenceImages: refsThisTurn,
        conversationId: job.conversationId,
        parentGenerationId: job.generationId,
      });

      if (result.status === "success" && result.result) {
        updateJob(job.id, { cleaned: result.result, generationId: result.generationId });
        appendMessage(job.id, { id: crypto.randomUUID(), role: "assistant", content: "Updated", image: result.result });
      } else {
        appendMessage(job.id, {
          id: crypto.randomUUID(),
          role: "assistant",
          content: result.message || "The model returned no image",
          retryInstruction: text.trim(),
          retryRefImages: refsThisTurn,
        });
      }
    } catch {
      appendMessage(job.id, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "Could not reach the server",
        retryInstruction: text.trim(),
        retryRefImages: refsThisTurn,
      });
    } finally {
      setRefining(false);
    }
  }

  function retry(msg: ChatMsg) {
    if (msg.retryInstruction === undefined) return;
    setChatInput(msg.retryInstruction);
    setReferenceImages(msg.retryRefImages ?? []);
  }

  function startOver() {
    setJobs([]);
    setItems([]);
    setSelectedId(null);
    setSelectedView(null);
    setChatInput("");
    setReferenceImages([]);
    setAnnotatedPhoto(null);
  }

  const selected = jobs.find((job) => job.id === selectedId) ?? null;
  const showResults = jobs.length > 0;
  const generatingSelected = selected?.status === "running" || selected?.status === "queued";

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <ToolHeader
        title="Image Cleaning"
        description="Upload jewellery photos · get a studio-grade clean, then refine it in chat"
        onReset={showResults ? startOver : undefined}
      />

      {error && (
        <p className="shrink-0 border-b border-error/20 bg-error/[0.08] px-5 py-2 text-xs text-error">{error}</p>
      )}

      {!showResults ? (
        <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8">
          <div className="mx-auto max-w-6xl space-y-6">
            <UploadZone
              items={items}
              onAdd={handleAdd}
              onRemove={(id) => setItems((c) => c.filter((i) => i.id !== id))}
              disabled={running}
            />

            <section className="space-y-2">
              <h2 className="text-[10px] font-semibold uppercase tracking-wider text-faint">Model</h2>
              <ModelSelector value={model} onChange={setModel} disabled={running} />
            </section>

            <section className="space-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <h2 className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-faint">
                  Instructions
                </h2>
                <PromptModeButton active={!useCustomPrompt} onClick={() => setUseCustomPrompt(false)} icon={Sparkles}>
                  Default
                </PromptModeButton>
                <PromptModeButton active={useCustomPrompt} onClick={() => setUseCustomPrompt(true)} icon={PenLine}>
                  Write my own
                </PromptModeButton>
              </div>

              {useCustomPrompt ? (
                <textarea
                  value={customPrompt}
                  onChange={(event) => setCustomPrompt(event.target.value)}
                  rows={4}
                  placeholder="Describe the retouch you want. This replaces the built-in cleaning instructions entirely."
                  className="w-full resize-y rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-[12px] text-cream placeholder:text-faint outline-none focus:border-gold/40"
                />
              ) : (
                <p className="text-[11px] text-faint">
                  Uses the standard jewellery retouch — preserves the design exactly and only fixes
                  the photography.
                </p>
              )}
            </section>

            <button
              onClick={handleGenerate}
              disabled={running || items.length === 0 || (useCustomPrompt && !customPrompt.trim())}
              className="flex items-center justify-center gap-2 rounded-lg border border-gold/30 bg-gold/15 px-4 py-2.5 text-xs font-semibold text-gold transition-colors hover:bg-gold/25 disabled:opacity-50"
            >
              {running ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
              {items.length > 1 ? `Clean ${items.length} photos` : "Clean photo"}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* ── chat rail ── */}
          <div className="flex w-[300px] shrink-0 flex-col overflow-hidden border-r border-white/[0.06] xl:w-[340px]">
            {jobs.length > 1 && (
              <ul className="grid shrink-0 grid-cols-5 gap-1.5 border-b border-white/[0.06] p-3">
                {jobs.map((job) => (
                  <li key={job.id}>
                    <button
                      onClick={() => {
                        setSelectedId(job.id);
                        setSelectedView(null);
                      }}
                      className={cn(
                        "relative block aspect-square w-full overflow-hidden rounded-lg border transition-colors",
                        job.id === selectedId ? "border-gold/50" : "border-white/10 hover:border-gold/25"
                      )}
                    >
                      <Image src={job.cleaned ?? job.original} alt={job.name} fill sizes="60px" className="object-cover" />
                      {job.status !== "done" && (
                        <span className="absolute inset-0 flex items-center justify-center bg-black/50">
                          {job.status === "running" && <Loader2 size={12} className="animate-spin text-white" />}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <ChatMessages
              history={selected?.history ?? []}
              busy={refining || generatingSelected}
              onSelectResult={setSelectedView}
              onRetry={retry}
              hints={selected?.cleaned && selected.history.length === 0 ? REFINE_SUGGESTIONS : undefined}
              onHint={(hint) => handleRefine(hint)}
            />

            <div className="shrink-0 border-t border-white/[0.06] p-3">
              <ChatInputBar
                value={chatInput}
                onChange={setChatInput}
                onSend={() => handleRefine(chatInput)}
                busy={refining || !selected?.cleaned}
                attachments={attachments}
                onOpenAttachment={setPreviewAttachment}
                onRemoveAttachment={removeAttachment}
                onAttachFiles={addReferenceImages}
                onPasteImage={(file) => addReferenceImages([file])}
                modelOptions={MODEL_OPTIONS}
                modelValue={model}
                onModelChange={setModel}
                placeholder={selected?.cleaned ? "Describe a change…" : "Waiting for the first result…"}
              />
            </div>
          </div>

          {/* ── stage ── */}
          <section className="relative flex-1 overflow-hidden">
            <GenerationStage
              src={selectedView ?? selected?.cleaned ?? null}
              busy={generatingSelected}
              busyLabel="Generating…"
              emptyLabel={selected?.error ?? "Nothing yet"}
              downloadName={selected ? `cleaned-${selected.name}` : undefined}
              // Hidden while the annotation toolbar occupies the same corner.
              onExpand={annotating ? undefined : setLightboxSrc}
              onAnnotate={
                annotating || !selected?.cleaned ? undefined : (src) => setAnnotating({ src, target: "stage" })
              }
            />

            {annotating && annotating.target === "stage" && selected && (
              <AnnotationOverlay
                src={annotating.src}
                onAttach={(marked) => {
                  setAnnotatedPhoto(marked);
                  setAnnotating(null);
                }}
                onClose={() => setAnnotating(null)}
              />
            )}
          </section>
        </div>
      )}

      {/* Reference annotation replaces the preview it was opened from, so it
          stays full-screen like the Lightbox instead of jumping to the stage. */}
      {annotating && annotating.target !== "stage" && (
        <AnnotationOverlay
          fullscreen
          src={annotating.src}
          onAttach={(marked) => {
            if (annotating.target === "photo") {
              setAnnotatedPhoto(marked);
            } else {
              const refIndex = (annotating.target as { ref: number }).ref;
              setReferenceImages((current) => current.map((src, i) => (i === refIndex ? marked : src)));
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

function PromptModeButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Sparkles;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] transition-colors",
        active
          ? "border-gold/40 bg-gold/15 text-gold"
          : "border-white/10 text-muted hover:bg-white/[0.07] hover:text-cream"
      )}
    >
      <Icon size={11} />
      {children}
    </button>
  );
}
