"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { turnImages, type ChatMsg } from "@/components/studio/chat";
import { fetchConversationForTool, type ApiResult, type QueuedResult } from "@/lib/api";
import { urlToDataUrl } from "@/lib/image";
import { useAttachments } from "@/lib/useAttachments";
import { useCreditGuard } from "@/lib/credit-guard";
import { useJobs } from "@/lib/jobs-context";

/**
 * Everything a generate-then-refine tool does that isn't its own input form.
 *
 * All of these tools work the same way once the request is made: queue a job,
 * follow it to completion, show what came back, then talk to it. That is the
 * state machine here — the queue bookkeeping, the conversation, the staged
 * attachments and resuming a past thread — so a page only has to describe what
 * it asks for.
 *
 * Results arrive through the shared job queue, never from the request itself:
 * the browser can be closed, reloaded or navigated away from and the work
 * carries on, which is why the resolver below watches the queue rather than
 * awaiting a response.
 */

export type RefineRequest = {
  refineImage: string;
  instruction: string;
  displayPrompt: string;
  referenceImages: string[];
  conversationId: string | null;
  parentGenerationId: string | null;
};

export function useGenerationWorkspace({
  tool,
  onRefine,
  /** Opening turn of a resumed thread, when the stored prompt is empty. */
  resumeLabel = "Generate this design",
  onResume,
}: {
  tool: string;
  onRefine: (body: RefineRequest) => Promise<ApiResult<QueuedResult>>;
  resumeLabel?: string;
  /**
   * Called with the model a reopened thread was last run on, so a page can put
   * its own picker back where the conversation left it. Everything else about
   * resuming is identical across tools and handled here.
   */
  onResume?: (details: { model: string | null }) => void;
}) {
  const [status, setStatus] = useState<"idle" | "generating" | "done" | "failed">("idle");
  const [images, setImages] = useState<string[]>([]);
  /** How many results this run asked for — what the placeholders count against. */
  const [requestedCount, setRequestedCount] = useState(0);
  const [selectedView, setSelectedView] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [refining, setRefining] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  /**
   * Set when the reopened thread is a colleague's, opened to read. The page
   * drops its composer; `refine` refuses too, and so does the server.
   */
  const [readOnly, setReadOnly] = useState<{ ownerName: string | null } | null>(null);

  const attach = useAttachments({ onError: setError });

  const conversationId = useRef<string | null>(null);
  const parentGenerationId = useRef<string | null>(null);
  const pendingJobId = useRef<string | null>(null);
  const pendingKind = useRef<"generate" | "refine" | null>(null);

  // Held in a ref so a caller passing an inline arrow doesn't re-run the
  // resume effect — and re-fetch the conversation — on every render. Kept
  // current in an effect rather than during render, which is the only point
  // at which writing a ref is safe under concurrent rendering.
  const onResumeRef = useRef(onResume);
  useEffect(() => {
    onResumeRef.current = onResume;
  });

  const { jobs: queueJobs, track } = useJobs();
  const creditGuard = useCreditGuard();
  const searchParams = useSearchParams();
  const resumeConversationId = searchParams.get("conversationId");

  // Arriving with ?conversationId=… reopens that thread instead of starting a
  // blank one — from History, or from the queue rail.
  useEffect(() => {
    if (!resumeConversationId) return;
    let cancelled = false;

    (async () => {
      const thread = await fetchConversationForTool(resumeConversationId, tool);
      if (cancelled || !thread) return;
      const { generations } = thread;

      const resumed: ChatMsg[] = generations.flatMap((turn, index) => [
        {
          id: `${turn.id}-user`,
          role: "user" as const,
          content: turn.userPrompt || (index === 0 ? resumeLabel : "Refine this"),
          ...turnImages(turn.inputAssets),
        },
        {
          id: `${turn.id}-assistant`,
          role: "assistant" as const,
          content: "Updated",
          image: turn.outputAssets[0]?.url,
          // Every variation the turn produced, not just the first.
          images: turn.outputAssets.map((asset) => asset.url).filter(Boolean),
        },
      ]);

      const last = generations[generations.length - 1];
      const lastImages = last.outputAssets.map((asset) => asset.url).filter(Boolean);

      setHistory(resumed);
      setImages(lastImages);
      setRequestedCount(lastImages.length);
      setSelectedView(lastImages[0] ?? null);
      setStatus("done");
      setReadOnly(thread.readOnly ? { ownerName: thread.ownerName } : null);
      conversationId.current = resumeConversationId;
      parentGenerationId.current = last.id;
      onResumeRef.current?.({ model: last.model ?? null });
    })();

    return () => {
      cancelled = true;
    };
  }, [resumeConversationId, tool, resumeLabel]);

  // What the run has produced so far, as the small previews the worker pushes
  // out the moment each image lands. This is the difference between watching a
  // spinner for the whole run and watching it fill in.
  const [liveImages, setLiveImages] = useState<string[]>([]);
  const [deliveredCount, setDeliveredCount] = useState(0);

  /** Settles this page's one in-flight job once the queue reports it finished. */
  useEffect(() => {
    const jobId = pendingJobId.current;
    const kind = pendingKind.current;
    if (!jobId || !kind) return;

    const job = queueJobs.find((entry) => entry.id === jobId);
    if (!job) return;

    if (job.status === "running") {
      if (job.partials?.length) setLiveImages(job.partials);
      if (typeof job.completedCount === "number") setDeliveredCount(job.completedCount);
    }

    if (job.status === "completed" && job.result) {
      pendingJobId.current = null;
      pendingKind.current = null;

      const { outputUrl, outputUrls, conversationId: cid, generationId } = job.result;
      const urls = outputUrls?.length ? outputUrls : outputUrl ? [outputUrl] : [];
      if (cid) conversationId.current = cid;
      if (generationId) parentGenerationId.current = generationId;

      if (urls.length === 0) {
        setStatus("failed");
        setError("The model returned no image");
        setRefining(false);
        return;
      }

      setImages(urls);
      setSelectedView(urls[0]);
      setStatus("done");
      setRefining(false);
      // The stored urls have arrived, so the previews they stood in for are
      // done: keeping them would hold a few megabytes of base64 for nothing.
      setLiveImages([]);
      setDeliveredCount(0);
      setHistory((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: kind === "generate" ? "Generated" : "Updated",
          image: urls[0],
          images: urls,
        },
      ]);
    } else if (job.status === "failed" || job.status === "cancelled") {
      pendingJobId.current = null;
      pendingKind.current = null;
      const message = job.error?.message || (job.status === "cancelled" ? "Cancelled" : "The model returned no image");

      if (kind === "generate") {
        setStatus("failed");
        setError(message);
      } else {
        setHistory((current) => [
          ...current,
          { id: crypto.randomUUID(), role: "assistant", content: message, retryInstruction: "" },
        ]);
        setRefining(false);
      }
    }
  }, [queueJobs]);

  /**
   * Starts a run. `send` makes the tool's own request; everything around it —
   * clearing the last result, opening the thread with what was asked for, and
   * following the job — is the same for every tool.
   */
  const generate = useCallback(
    async (
      send: () => Promise<ApiResult<QueuedResult>>,
      {
        count,
        prompt,
        images: sentImages = [],
      }: {
        count: number;
        prompt: string;
        /**
         * What the run was given — the sketch, the photo, the reference, the
         * pieces — shown on the opening turn so the thread has the before as
         * well as the after. The first is shown large, the rest small.
         */
        images?: string[];
      }
    ) => {
      setError("");
      setStatus("generating");
      setImages([]);
      setLiveImages([]);
      setDeliveredCount(0);
      setSelectedView(null);
      setChatInput("");
      setRequestedCount(count);
      const [firstImage, ...otherImages] = sentImages.filter(Boolean);
      setHistory([
        {
          id: crypto.randomUUID(),
          role: "user",
          content: prompt || "Generate a design",
          image: firstImage,
          refImages: otherImages.length ? otherImages : undefined,
        },
      ]);

      const result = await send();
      if (result.status === "queued" && result.job) {
        pendingJobId.current = result.job.id;
        pendingKind.current = "generate";
        track(result.job);
      } else if (creditGuard(result)) {
        // Refused on price, so nothing was queued and nothing was charged. The
        // dialog says so; this puts the page back exactly as it was before the
        // click, rather than leaving a failed run and an opening chat turn for
        // work that never started.
        setStatus("idle");
        setHistory([]);
        setRequestedCount(0);
      } else {
        setStatus("failed");
        setError(result.message || "Could not queue this generation");
      }
    },
    [creditGuard, track]
  );

  /** One follow-up turn on whichever result is currently shown. */
  const refine = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      const base = selectedView ?? images[0];
      if (!base || refining || readOnly) return;
      if (!trimmed && !attach.annotatedPhoto && attach.referenceImages.length === 0) return;

      const instruction = trimmed || "Apply the changes I marked on the image.";
      const source = attach.annotatedPhoto || base;
      const references = attach.referenceImages;

      setHistory((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "user",
          content: instruction,
          // The image this turn changes — the picked result, or its marked-up copy.
          image: source,
          refImages: references.length ? references : undefined,
        },
      ]);
      setChatInput("");
      attach.setReferenceImages([]);
      attach.setAnnotatedPhoto(null);
      setRefining(true);
      setLiveImages([]);
      setDeliveredCount(0);
      setError("");

      // A stored result is a url, but the model edits bytes — so one that
      // hasn't been converted yet is fetched now.
      let editable = source;
      if (!editable.startsWith("data:")) {
        try {
          editable = await urlToDataUrl(editable);
        } catch {
          setHistory((current) => [
            ...current,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content: "Could not load the image to refine",
              retryInstruction: trimmed,
            },
          ]);
          setRefining(false);
          return;
        }
      }

      const result = await onRefine({
        refineImage: editable,
        instruction,
        displayPrompt: instruction,
        referenceImages: references,
        conversationId: conversationId.current,
        parentGenerationId: parentGenerationId.current,
      });

      if (result.status === "queued" && result.job) {
        pendingJobId.current = result.job.id;
        pendingKind.current = "refine";
        track(result.job);
      } else if (creditGuard(result)) {
        // The dialog carries the explanation, so the thread doesn't also need a
        // failure turn — but the instruction goes back in the box, because it
        // was never sent and retyping it is the last thing anyone wants.
        setHistory((current) => current.slice(0, -1));
        setChatInput(trimmed);
        setRefining(false);
      } else {
        setHistory((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: result.message || "Could not queue this refinement",
            retryInstruction: trimmed,
          },
        ]);
        setRefining(false);
      }
    },
    [attach, creditGuard, images, onRefine, readOnly, refining, selectedView, track]
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setImages([]);
    setLiveImages([]);
    setDeliveredCount(0);
    setRequestedCount(0);
    setSelectedView(null);
    setError("");
    setHistory([]);
    setChatInput("");
    setReadOnly(null);
    attach.reset();
    conversationId.current = null;
    parentGenerationId.current = null;
    pendingJobId.current = null;
    pendingKind.current = null;
  }, [attach]);

  const retry = useCallback((msg: ChatMsg) => {
    if (msg.retryInstruction === undefined) return;
    setChatInput(msg.retryInstruction);
  }, []);

  const isGenerating = status === "generating";

  return {
    // state
    status,
    isGenerating,
    images,
    // Falls through to a live preview while a run is in flight, so the stage
    // shows the first finished image instead of a spinner until the last one.
    displayImg: selectedView ?? images[0] ?? liveImages[liveImages.length - 1] ?? null,
    selectedView,
    setSelectedView,
    /** Results expected for this run — a resumed thread counts its own images. */
    tileCount: Math.max(requestedCount, images.length),
    /** Small previews of what this run has produced so far, newest last. */
    liveImages,
    /** How many variations have actually come back. The exact figure behind the bar. */
    deliveredCount,
    error,
    setError,
    history,
    chatInput,
    setChatInput,
    refining,
    lightboxSrc,
    setLightboxSrc,
    /** Non-null for a colleague's thread opened to read: no composer. */
    readOnly,
    attach,
    // actions
    generate,
    refine,
    reset,
    retry,
  };
}
