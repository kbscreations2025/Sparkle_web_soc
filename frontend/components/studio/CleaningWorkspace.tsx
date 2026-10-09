"use client";

import { useEffect, useRef, useState } from "react";
import { ErrorBanner } from "./ToolChrome";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import { Loader2, PenLine, Sparkles, Wand2 } from "lucide-react";
import { UploadZone, type UploadItem } from "@/components/studio/UploadZone";
import { ModelSelector } from "@/components/studio/ModelSelector";
import { GenerationStage } from "@/components/studio/GenerationStage";
import { ChatMessages } from "@/components/studio/ChatMessages";
import { ChatInputBar } from "@/components/studio/ChatInputBar";
import { ReadOnlyChatNotice } from "@/components/studio/ReadOnlyChatNotice";
import { SpellCheckedTextarea } from "@/components/studio/SpellCheckedTextarea";
import { StudioSplitLayout } from "@/components/studio/StudioSplitLayout";
import { AnnotationOverlay } from "@/components/studio/AnnotationOverlay";
import { AnnotationLayer } from "@/components/studio/AnnotationLayer";
import { ToolHeader } from "@/components/studio/ToolHeader";
import { turnImages, type ChatMsg } from "@/components/studio/chat";
import {
  cleanImage,
  checkCleaningDuplicates,
  refineImage,
  fetchConversationForTool,
  resolveModelId,
  toModelOptions,
  type CleaningDuplicate,
} from "@/lib/api";
import { fingerprintDataUrl, fingerprintFile } from "@/lib/fingerprint";
import { workspacePathFor } from "@/lib/nav";
import { ConfirmDialog } from "@/components/studio/ConfirmDialog";
import { compressImage, makeThumbnail, urlToDataUrl } from "@/lib/image";
import { useAttachments } from "@/lib/useAttachments";
import { useCreditGuard } from "@/lib/credit-guard";
import { useJobs } from "@/lib/jobs-context";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/permissions";
import { ToolAccessNotice } from "./ToolAccessNotice";
import { cn } from "@/lib/utils";

const CLEANING_PERMISSION = "tool.cleaning.run";

/** One-click fixes people ask for most on a cleaning result. */
const REFINE_SUGGESTIONS = [
  "Make background pure white",
  "Increase diamond brightness",
  "Remove background shadow",
  "Add more sparkle to stones",
];

/** One uploaded photo, its result, and the chat thread of refinements on it. */
type Job = {
  id: string;
  name: string;
  original: string;
  /** Latest cleaned version. Replaced by each refinement. */
  cleaned: string | null;
  /**
   * A small preview of the run in flight, pushed the moment the model answers
   * and before the full image has been stored.
   *
   * Kept apart from `cleaned` on purpose: `cleaned` is what a refinement is
   * sent, and that must always be the full-resolution image, never the
   * downscaled stand-in shown while waiting.
   */
  preview?: string | null;
  status: "queued" | "running" | "done" | "failed";
  error?: string;
  conversationId?: string | null;
  generationId?: string | null;
  history: ChatMsg[];
  /**
   * A colleague's thread reopened from History to read. Per photo, not per
   * page: the viewer can still upload and clean their own alongside it.
   */
  readOnly?: { ownerName: string | null };
};

/**
 * A photo waiting in the upload box, with its fingerprints: the original
 * file's and the resized upload's. Either can be null where the browser
 * couldn't hash (an insecure origin) — that photo just isn't checked.
 */
type CleaningUpload = UploadItem & { sourceChecksum: string | null; checksum: string | null };

/** The first turn of a cleaning thread: the instruction, with the photo it was about. */
function openingTurn(id: string, original: string, content: string): ChatMsg {
  return { id, role: "user", content, image: original || undefined };
}

type ModelOption ={ id: string; label: string; quality: string; description: string; badge: string };

/**
 * The Image Cleaning workspace: upload, clean, then refine in chat. Shared by
 * every cleaning-flavoured tool page — Default, New Cleaning, and any future
 * mode built the same way — parametrized only by which model(s) it offers and
 * which built-in prompt it falls back to, so a preset page is a different
 * `modelOptions`/`defaultModel`/`promptVariant`, not a different copy of this
 * component. The prompt text itself is never a prop, only that variant key:
 * the backend still builds every cleaning instruction, from `customPrompt` or
 * whichever built-in prompt the key names (see backend/src/jobs/cleaning.js).
 */
export function CleaningWorkspace<TModel extends string>({
  modelOptions,
  defaultModel,
  promptVariant = "default",
}: {
  modelOptions: readonly (ModelOption & { id: TModel })[];
  defaultModel: TModel;
  /** Which built-in prompt "Default" instructions resolve to — see above. */
  promptVariant?: "default" | "new";
}) {
  const { user } = useAuth();

  const [items, setItems] = useState<CleaningUpload[]>([]);
  /** Photos from the latest drop that were cleaned before, waiting on the person's answer. */
  const [duplicates, setDuplicates] = useState<{
    added: CleaningUpload[];
    flagged: { item: CleaningUpload; inBatch: string | null; earlier: CleaningDuplicate | null }[];
  } | null>(null);
  const [model, setModel] = useState<TModel>(defaultModel);
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

  const attach = useAttachments({ onError: setError });
  const { referenceImages, setReferenceImages, annotatedPhoto, setAnnotatedPhoto, annotating, setAnnotating } = attach;

  const searchParams = useSearchParams();
  const modelOptionsForInput = toModelOptions(modelOptions);

  // Renamed: `jobs` in this component is the photos on screen, not the queue.
  const { jobs: queueJobs, track } = useJobs();
  const creditGuard = useCreditGuard();
  /**
   * Which queued job belongs to which photo on screen.
   *
   * A ref, not state: this is bookkeeping the render doesn't read, and putting
   * it in state would re-run the resolver effect on every write it makes.
   */
  const pendingJobs = useRef<Record<string, { kind: "generate" | "refine"; localJobId: string }>>({});

  /**
   * Arriving with ?conversationId=... resumes that thread instead of starting
   * a fresh upload — from History, or from the queue rail.
   *
   * Keyed on the id itself rather than on mount. Landing here from another
   * route remounts the component, but clicking a queue row while already on
   * this page only swaps the query string, and Next reuses the component for
   * that — so an effect that ran once per mount would change the url and load
   * nothing. Depending on the extracted string (not the `searchParams` object,
   * whose identity churns on unrelated navigations) re-runs exactly when the
   * conversation actually changes.
   */
  const resumeConversationId = searchParams.get("conversationId");

  useEffect(() => {
    const conversationId = resumeConversationId;
    if (!conversationId) return;

    let cancelled = false;
    (async () => {
      const thread = await fetchConversationForTool(conversationId, "cleaning");
      if (cancelled || !thread) return;
      const { generations } = thread;
      const readOnly = thread.readOnly ? { ownerName: thread.ownerName } : undefined;

      const [first] = generations;
      const original = first.inputAssets.find((a) => a.role === "uploaded")?.url ?? first.inputAssets[0]?.url ?? "";
      const last = generations[generations.length - 1];
      const cleaned = last.outputAssets[0]?.url ?? null;

      // The full thread, from the very first clean through every refinement —
      // not just the follow-ups — so resuming reads like the conversation
      // actually happened, not like it started mid-way through.
      const history: ChatMsg[] = generations.flatMap((turn, index) => [
        index === 0
          ? openingTurn(`${turn.id}-user`, original, turn.userPrompt || "Clean this image")
          : {
              id: `${turn.id}-user`,
              role: "user" as const,
              content: turn.userPrompt || "Refine this",
              // The version this refinement worked on, plus its references.
              ...turnImages(turn.inputAssets),
            },
        { id: `${turn.id}-assistant`, role: "assistant" as const, content: "Updated", image: turn.outputAssets[0]?.url },
      ]);

      setJobs([
        {
          id: conversationId,
          name: readOnly ? `${readOnly.ownerName || "Colleague"}'s photo` : "Resumed photo",
          original,
          cleaned,
          status: "done",
          conversationId,
          generationId: last.id,
          history,
          readOnly,
        },
      ]);
      setSelectedId(conversationId);
      const resumedModel = resolveModelId(modelOptions, last.model);
      if (resumedModel) setModel(resumedModel);

      // The stage paints instantly from the R2 URL above; swapped for the
      // data URI the backend actually requires once it's ready, since a
      // refine call sends whatever `cleaned` currently holds. A read-only
      // thread is never refined, so it keeps the url and skips the download.
      if (cleaned && !readOnly) {
        urlToDataUrl(cleaned)
          .then((dataUrl) => updateJob(conversationId, { cleaned: dataUrl }))
          .catch((err) => console.error("could not prepare resumed image for editing:", err));
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the conversation id is the only input that should trigger a re-resume; modelOptions/updateJob are stable per render and listing them would refetch the thread for unrelated reasons
  }, [resumeConversationId]);

  /**
   * Turns finished queue jobs back into what's on screen.
   *
   * The work now completes somewhere else entirely, so this is the seam where
   * it comes home: a job this page queued settles, and the photo it belongs to
   * gets its result — whether that took two seconds or outlived a navigation.
   *
   * `updateJob`/`appendMessage` are hoisted function declarations further down;
   * this only runs after render, so they exist by the time it does.
   */
  useEffect(() => {
    for (const queueJob of queueJobs) {
      const pending = pendingJobs.current[queueJob.id];
      if (!pending) continue;

      // Shown while the rest of the run finishes, so the wait ends when the
      // model answers rather than when the upload does.
      if (queueJob.status === "running" && queueJob.partials?.length) {
        updateJob(pending.localJobId, { preview: queueJob.partials[queueJob.partials.length - 1] });
      }

      if (queueJob.status === "completed" && queueJob.result) {
        delete pendingJobs.current[queueJob.id];
        const { outputUrl, conversationId, generationId, intentLabel } = queueJob.result;

        if (pending.kind === "generate") {
          updateJob(pending.localJobId, {
            status: "done",
            cleaned: outputUrl,
            // The stored image is here; the stand-in has done its job.
            preview: null,
            conversationId,
            generationId,
          });
          // The result answers the opening turn in the thread, so the
          // conversation reads in order: the photo sent on the right, the
          // clean that came back on the left — the same shape a resumed
          // thread already has.
          appendMessage(pending.localJobId, {
            id: crypto.randomUUID(),
            role: "assistant",
            content: "Cleaned",
            image: outputUrl ?? undefined,
          });
        } else {
          updateJob(pending.localJobId, { cleaned: outputUrl, preview: null, generationId });
          appendMessage(pending.localJobId, {
            id: crypto.randomUUID(),
            role: "assistant",
            content: "Updated",
            image: outputUrl ?? undefined,
            note: intentLabel ?? undefined,
          });
          setRefining(false);
        }
      } else if (queueJob.status === "failed" || queueJob.status === "cancelled") {
        delete pendingJobs.current[queueJob.id];
        const message =
          queueJob.error?.message || (queueJob.status === "cancelled" ? "Cancelled" : "The model returned no image");

        if (pending.kind === "generate") {
          updateJob(pending.localJobId, { status: "failed", error: message });
        } else {
          appendMessage(pending.localJobId, {
            id: crypto.randomUUID(),
            role: "assistant",
            content: message,
            retryInstruction: queueJob.request?.instruction || "",
          });
          setRefining(false);
        }
      }
    }
  }, [queueJobs]);

  if (!can(user, CLEANING_PERMISSION)) {
    return <ToolAccessNotice tool="Image Cleaning" />;
  }

  function updateJob(id: string, patch: Partial<Job>) {
    setJobs((current) => current.map((job) => (job.id === id ? { ...job, ...patch } : job)));
  }

  /**
   * Reads the dropped photos, then checks whether any of them has been
   * cleaned before — already in this batch, or by anyone in the organization
   * — and asks before adding those. Never blocks: a failed check just adds
   * them, and confirming adds them anyway. Whether to pay for it twice is the
   * person's call; the point is that they know.
   */
  async function handleAdd(files: File[]) {
    setError("");
    let added: CleaningUpload[];
    try {
      added = await Promise.all(
        files.map(async (file) => {
          const dataUrl = await compressImage(file);
          const [sourceChecksum, checksum] = await Promise.all([fingerprintFile(file), fingerprintDataUrl(dataUrl)]);
          return { id: crypto.randomUUID(), name: file.name, dataUrl, sourceChecksum, checksum };
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read those files");
      return;
    }

    // Already waiting in this batch — or picked twice in the same drop.
    const inBatch = new Map<string, string>();
    for (const item of items) {
      const key = item.sourceChecksum ?? item.checksum;
      if (key) inBatch.set(key, item.name);
    }
    const repeats: Record<string, string> = {};
    for (const item of added) {
      const key = item.sourceChecksum ?? item.checksum;
      if (!key) continue;
      if (inBatch.has(key)) repeats[item.id] = inBatch.get(key)!;
      else inBatch.set(key, item.name);
    }

    // Cleaned before, anywhere in the organization.
    let earlier: Record<string, CleaningDuplicate> = {};
    const checks = added.flatMap((item) =>
      item.sourceChecksum && item.checksum
        ? [{ id: item.id, sourceChecksum: item.sourceChecksum, checksum: item.checksum }]
        : []
    );
    if (checks.length) {
      try {
        const res = await checkCleaningDuplicates(checks);
        if (res.status === "success") earlier = res.matches ?? {};
      } catch {
        // No answer is no warning — the upload goes ahead as it always did.
      }
    }

    const flagged = added
      .filter((item) => repeats[item.id] || earlier[item.id])
      .map((item) => ({ item, inBatch: repeats[item.id] ?? null, earlier: earlier[item.id] ?? null }));

    if (!flagged.length) {
      setItems((current) => [...current, ...added]);
      return;
    }
    setDuplicates({ added, flagged });
  }

  /** The person's answer to the "used before" dialog. */
  function resolveDuplicates(uploadAnyway: boolean) {
    if (!duplicates) return;
    const skipped = new Set(duplicates.flagged.map(({ item }) => item.id));
    const keep = uploadAnyway ? duplicates.added : duplicates.added.filter((item) => !skipped.has(item.id));
    setItems((current) => [...current, ...keep]);
    setDuplicates(null);
  }

  /**
   * Hands every photo to the queue and returns.
   *
   * Used to run them one at a time and wait: the request itself was the only
   * record that work was happening, so firing them together risked the
   * provider's rate limit and closing the tab lost everything. Now the worker
   * owns both concerns — it decides how many run at once (WORKER_CONCURRENCY)
   * and it keeps running whatever this page does next.
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
      // Opens with what was sent, photo included, so the thread shows the
      // before as well as the after.
      history: [openingTurn(item.id, item.dataUrl, customPrompt.trim() && useCustomPrompt ? customPrompt.trim() : "Clean this image")],
    }));
    setJobs(queued);
    setSelectedId(queued[0]?.id ?? null);

    for (const item of items) {
      try {
        const result = await cleanImage({
          image: item.dataUrl,
          model,
          // So the queue rail can show this photo rather than a bare spinner.
          preview: await makeThumbnail(item.dataUrl),
          // Stored with the upload, so the next time this photo is dropped
          // here it is recognised — see handleAdd.
          sourceChecksum: item.sourceChecksum,
          ...(useCustomPrompt && customPrompt.trim() ? { customPrompt: customPrompt.trim() } : { variant: promptVariant }),
        });

        if (result.status === "queued" && result.job) {
          pendingJobs.current[result.job.id] = { kind: "generate", localJobId: item.id };
          // Into the shared queue immediately, so the nav indicator shows it
          // without waiting for the first socket update.
          track(result.job);
          updateJob(item.id, { status: "running" });
        } else if (creditGuard(result)) {
          /*
           * Out of credits, so every photo still to come would be refused for
           * the same reason. Stopping here keeps that from becoming a request
           * per photo and a dialog that reopens behind itself — and the ones
           * already queued keep running, since they were paid for.
           */
          const from = items.indexOf(item);
          for (const remaining of items.slice(from)) {
            updateJob(remaining.id, { status: "failed", error: "Not enough credits" });
          }
          break;
        } else {
          updateJob(item.id, { status: "failed", error: result.message || "Could not queue this photo" });
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
    if (!job?.cleaned || job.readOnly || !text.trim()) return;

    // A marked-up copy IS the image this turn edits — the marks are the
    // instruction — not an extra reference beside the clean one. Sending it as
    // a reference showed two near-identical pictures in the thread and told
    // the model to treat the marks as mere inspiration. Same as every other
    // tool's refine (see useGenerationWorkspace).
    const source = annotatedPhoto || job.cleaned;
    const refsThisTurn = referenceImages;
    appendMessage(job.id, {
      id: crypto.randomUUID(),
      role: "user",
      content: text.trim(),
      // The version this turn changes — or its marked-up copy — so each
      // request shows what it was about.
      image: source,
      refImages: refsThisTurn.length ? refsThisTurn : undefined,
    });
    setChatInput("");
    setReferenceImages([]);
    setAnnotatedPhoto(null);
    setSelectedView(null);
    setRefining(true);
    setError("");

    try {
      // A completed job hands back a stored url, but the backend edits bytes,
      // not links — so a result that hasn't been converted yet is fetched now.
      // Same conversion resuming a thread from History already does.
      let editable = source;
      if (!editable.startsWith("data:")) {
        editable = await urlToDataUrl(editable);
        // Only the clean result is cached back; a marked-up copy is this turn's alone.
        if (source === job.cleaned) updateJob(job.id, { cleaned: editable });
      }

      const result = await refineImage({
        refineImage: editable,
        instruction: text.trim(),
        model,
        referenceImages: refsThisTurn,
        annotated: Boolean(annotatedPhoto),
        conversationId: job.conversationId,
        parentGenerationId: job.generationId,
        // The image being refined, so the rail shows the piece rather than the
        // photo this thread originally started from.
        preview: await makeThumbnail(editable),
      });

      if (result.status === "queued" && result.job) {
        pendingJobs.current[result.job.id] = { kind: "refine", localJobId: job.id };
        track(result.job);
        // `refining` stays true until the resolver effect sees this settle —
        // the thread keeps its skeleton bubble in the meantime.
      } else {
        appendMessage(job.id, {
          id: crypto.randomUUID(),
          role: "assistant",
          content: result.message || "Could not queue this change",
          retryInstruction: text.trim(),
          retryRefImages: refsThisTurn,
        });
        setRefining(false);
      }
    } catch {
      appendMessage(job.id, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "Could not reach the server",
        retryInstruction: text.trim(),
        retryRefImages: refsThisTurn,
      });
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
    attach.reset();
  }

  const selected = jobs.find((job) => job.id === selectedId) ?? null;
  const showResults = jobs.length > 0;
  const generatingSelected = selected?.status === "running" || selected?.status === "queued";

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <ToolHeader onReset={showResults ? startOver : undefined} />

      <ErrorBanner message={error} />

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
              <ModelSelector models={modelOptions} value={model} onChange={setModel} disabled={running} />
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
                <SpellCheckedTextarea
                  value={customPrompt}
                  onChange={setCustomPrompt}
                  rows={4}
                  // Grows as it is written instead of needing the drag handle
                  // the plain textarea had.
                  autoGrowMaxHeight={320}
                  placeholder="Describe the retouch you want. This replaces the built-in cleaning instructions entirely."
                  className="rounded-lg border border-white/10 bg-white/[0.06] transition-colors focus-within:border-gold/40"
                  textClassName="w-full px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap break-words"
                />
              ) : (
                <p className="text-[11px] text-faint">
                  {/* TODO: describe New Cleaning's own instructions once NEW_CLEANING_PROMPT is
                      written — this line is what "Default" (the built-in-prompt option) shows
                      as its description on this page. */}
                  {promptVariant === "new"
                    ? "Uses this mode's own retouch instructions."
                    : "Uses the standard jewellery retouch — preserves the design exactly and only fixes the photography."}
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
        <StudioSplitLayout
          chatRail={
            <>
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
                        <Image
                          src={job.cleaned ?? job.preview ?? job.original}
                          alt={job.name}
                          fill
                          sizes="60px"
                          className="object-cover"
                        />
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
                busyImages={selected?.preview ? [selected.preview] : undefined}
                onSelectResult={setSelectedView}
                onRetry={selected?.readOnly ? undefined : retry}
                hints={
                  // Under the first clean, until the user sends a follow-up of their own.
                  !selected?.readOnly && selected?.cleaned && selected.history.filter((msg) => msg.role === "user").length <= 1
                    ? REFINE_SUGGESTIONS
                    : undefined
                }
                onHint={(hint) => handleRefine(hint)}
              />

              <div className="shrink-0 border-t border-white/[0.06] p-3">
                {selected?.readOnly ? (
                  <ReadOnlyChatNotice ownerName={selected.readOnly.ownerName} />
                ) : (
                <ChatInputBar
                  value={chatInput}
                  onChange={setChatInput}
                  onSend={() => handleRefine(chatInput)}
                  busy={refining || !selected?.cleaned}
                  attachments={attach.attachments}
                  onOpenAttachment={attach.setPreviewAttachment}
                  onRemoveAttachment={attach.removeAttachment}
                  onAttachFiles={attach.addReferenceImages}
                  onPasteImage={(file) => attach.addReferenceImages([file])}
                  modelOptions={modelOptionsForInput}
                  modelValue={model}
                  onModelChange={setModel}
                  placeholder={selected?.cleaned ? "Describe a change…" : "Waiting for the first result…"}
                />
                )}
              </div>
            </>
          }
          stage={
            <>
              <GenerationStage
                src={selectedView ?? selected?.cleaned ?? selected?.preview ?? null}
                // Only until the preview lands — after that the stage has the
                // result to show, dimmed behind nothing.
                busy={generatingSelected && !selected?.preview}
                busyLabel="Generating…"
                emptyLabel={selected?.error ?? "Nothing yet"}
                downloadName={selected ? `cleaned-${selected.name}` : undefined}
                // Hidden while the annotation toolbar occupies the same corner.
                onExpand={annotating ? undefined : setLightboxSrc}
                onAnnotate={
                  annotating || !selected?.cleaned || selected.readOnly
                    ? undefined
                    : (src) => setAnnotating({ src, target: "stage" })
                }
              />

              {annotating && annotating.target === "stage" && selected && (
                <AnnotationOverlay
                  src={annotating.src}
                  // The shared writer handles the stage target now, so this no
                  // longer needs its own copy of "put it in the photo slot".
                  onAttach={attach.saveAnnotation}
                  onClose={() => setAnnotating(null)}
                />
              )}
            </>
          }
        />
      )}

      <AnnotationLayer attachments={attach} lightboxSrc={lightboxSrc} onCloseLightbox={() => setLightboxSrc(null)} />

      <ConfirmDialog
        open={Boolean(duplicates)}
        title={
          duplicates && duplicates.flagged.length > 1
            ? `${duplicates.flagged.length} of these photos were used before`
            : "This photo was used before"
        }
        message={duplicates ? <DuplicateList flagged={duplicates.flagged} /> : null}
        confirmLabel="Upload anyway"
        cancelLabel={duplicates && duplicates.flagged.length > 1 ? "Skip these" : "Don't upload"}
        destructive={false}
        onConfirm={() => resolveDuplicates(true)}
        onCancel={() => resolveDuplicates(false)}
      />
    </div>
  );
}

/**
 * What the "used before" dialog says about each photo: who cleaned it and
 * when, or that it is already in this batch — with a way to look at the
 * earlier result, which opens in a new tab so the upload in progress here
 * isn't lost.
 */
function DuplicateList({
  flagged,
}: {
  flagged: { item: CleaningUpload; inBatch: string | null; earlier: CleaningDuplicate | null }[];
}) {
  return (
    <div className="space-y-3">
      <ul className="max-h-60 space-y-2 overflow-y-auto">
        {flagged.map(({ item, inBatch, earlier }) => {
          const href =
            earlier?.latest.conversationId && workspacePathFor("cleaning", earlier.latest.modelLabel)
              ? `${workspacePathFor("cleaning", earlier.latest.modelLabel)}?conversationId=${earlier.latest.conversationId}`
              : null;
          const others = earlier ? earlier.people.filter((person) => person !== earlier.latest.userName) : [];

          return (
            <li key={item.id} className="flex items-start gap-2.5">
              <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md border border-white/10 bg-surface-raised">
                <Image src={item.dataUrl} alt={item.name} fill sizes="40px" className="object-cover" />
              </span>
              <span className="min-w-0 space-y-0.5">
                <span className="block truncate text-[11px] font-medium text-cream">{item.name}</span>
                {earlier && (
                  <span className="block text-[11px] text-muted">
                    Cleaned by{" "}
                    <span className="font-medium text-cream">
                      {earlier.latest.isOwn ? "you" : earlier.latest.userName}
                    </span>{" "}
                    on {formatDay(earlier.latest.createdAt)}
                    {earlier.times > 1 && ` · ${earlier.times} times`}
                    {others.length > 0 && ` · also ${others.join(", ")}`}
                    {href && (
                      <>
                        {" · "}
                        <a href={href} target="_blank" rel="noreferrer" className="text-gold hover:underline">
                          View result
                        </a>
                      </>
                    )}
                  </span>
                )}
                {inBatch && (
                  <span className="block text-[11px] text-muted">
                    Already added in this batch{inBatch !== item.name ? ` as ${inBatch}` : ""}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-[11px] text-faint">Cleaning it again uses credits again. You can still upload it if you need to.</p>
    </div>
  );
}

/** "3 Oct" this year, "3 Oct 2025" otherwise. */
function formatDay(iso: string) {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
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
