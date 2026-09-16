"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import { ChevronDown, ChevronRight, Wand2, X } from "lucide-react";
import { ImageCountSelector } from "@/components/studio/ImageCountSelector";
import { SpellCheckedTextarea } from "@/components/studio/SpellCheckedTextarea";
import { GenerationStage } from "@/components/studio/GenerationStage";
import { ChatMessages } from "@/components/studio/ChatMessages";
import { ChatInputBar } from "@/components/studio/ChatInputBar";
import { StudioSplitLayout } from "@/components/studio/StudioSplitLayout";
import { AnnotationOverlay } from "@/components/studio/AnnotationOverlay";
import { AnnotationLayer } from "@/components/studio/AnnotationLayer";
import { ToolHeader } from "@/components/studio/ToolHeader";
import type { ChatMsg } from "@/components/studio/chat";
import {
  textToImage,
  refineTextToImage,
  fetchConversationForTool,
  resolveModelId,
  SPARKLE_MODELS,
  DEFAULT_SPARKLE_MODEL,
  toModelOptions,
  type SparkleModelId,
} from "@/lib/api";
import {
  ASPECTS,
  STYLES,
  TEXT_COUNT_OPTIONS,
  DEFAULT_IMAGE_COUNT,
  DEFAULT_JEWELRY_TYPE,
  buildJewelryConfigurator,
  buildJewelryPrompt,
  clearJewelryTypeDependentSelections,
  type AspectId,
  type StyleId,
} from "@/lib/jewelryConfigurator";
import { urlToDataUrl } from "@/lib/image";
import { useAttachments } from "@/lib/useAttachments";
import { useJobs } from "@/lib/jobs-context";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";

const TEXT_TO_IMAGE_PERMISSION = "tool.text_to_image.run";
const MODEL_OPTIONS = toModelOptions(SPARKLE_MODELS);

const REFINE_HINTS = [
  "Change metal to rose gold",
  "Make the center stone larger",
  "Add a halo of diamonds",
  "Brighter studio lighting",
];

export default function TextToImagePage() {
  const { user } = useAuth();

  // ── input phase ──
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState<StyleId>("photorealistic");
  const [aspect, setAspect] = useState<AspectId>("square");
  const [model, setModel] = useState<SparkleModelId>(DEFAULT_SPARKLE_MODEL);
  const [count, setCount] = useState<number>(DEFAULT_IMAGE_COUNT);
  const [spellIssueCount, setSpellIssueCount] = useState(0);
  const [selections, setSelections] = useState<Record<string, string>>({ jewelryType: DEFAULT_JEWELRY_TYPE });
  const configurator = useMemo(() => buildJewelryConfigurator(selections.jewelryType), [selections.jewelryType]);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(
    Object.fromEntries(configurator.slice(0, 3).map((g) => [g.key, true]))
  );

  // ── generation / results ──
  const [status, setStatus] = useState<"idle" | "generating" | "done" | "failed">("idle");
  const [images, setImages] = useState<string[]>([]);
  const [selectedView, setSelectedView] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [refining, setRefining] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  const attach = useAttachments({ onError: setError });
  const { referenceImages, annotatedPhoto, annotating, setAnnotating } = attach;

  const conversationId = useRef<string | null>(null);
  const parentGenerationId = useRef<string | null>(null);
  const searchParams = useSearchParams();

  const { jobs: queueJobs, track } = useJobs();
  const pendingJob = useRef<{ kind: "generate" | "refine" } | null>(null);
  const pendingJobId = useRef<string | null>(null);

  const builderText = buildJewelryPrompt(selections);
  const finalDescription = [builderText, prompt.trim()].filter(Boolean).join(", ");
  const selectedCount = Object.values(selections).filter(Boolean).length;

  const resumeConversationId = searchParams.get("conversationId");

  useEffect(() => {
    if (!resumeConversationId) return;
    let cancelled = false;
    (async () => {
      const generations = await fetchConversationForTool(resumeConversationId, "text_to_image");
      if (cancelled || !generations) return;

      const historyMsgs: ChatMsg[] = generations.flatMap((turn, index) => [
        { id: `${turn.id}-user`, role: "user" as const, content: turn.userPrompt || (index === 0 ? "Generate this design" : "Refine this") },
        { id: `${turn.id}-assistant`, role: "assistant" as const, content: "Updated", image: turn.outputAssets[0]?.url },
      ]);

      const last = generations[generations.length - 1];
      const lastImages = last.outputAssets.map((a) => a.url).filter(Boolean);
      setHistory(historyMsgs);
      setImages(lastImages);
      setSelectedView(lastImages[0] ?? null);
      setStatus("done");
      conversationId.current = resumeConversationId;
      parentGenerationId.current = last.id;
      const resumedModel = resolveModelId(SPARKLE_MODELS, last.model);
      if (resumedModel) setModel(resumedModel);
    })();
    return () => {
      cancelled = true;
    };
  }, [resumeConversationId]);

  /** Mirrors CleaningWorkspace's resolver effect: settles this page's one in-flight job. */
  useEffect(() => {
    const jobId = pendingJobId.current;
    const pending = pendingJob.current;
    if (!jobId || !pending) return;
    const job = queueJobs.find((j) => j.id === jobId);
    if (!job) return;

    if (job.status === "completed" && job.result) {
      pendingJobId.current = null;
      pendingJob.current = null;
      const { outputUrl, outputUrls, conversationId: cid, generationId } = job.result;
      const urls = outputUrls && outputUrls.length ? outputUrls : outputUrl ? [outputUrl] : [];
      if (cid) conversationId.current = cid;
      if (generationId) parentGenerationId.current = generationId;

      if (pending.kind === "generate") {
        setImages(urls);
        setSelectedView(urls[0] ?? null);
        setStatus(urls.length ? "done" : "failed");
        if (!urls.length) setError("The model returned no image");
      } else {
        setImages(urls.length ? urls : images);
        setSelectedView(urls[0] ?? selectedView);
        setHistory((current) => [
          ...current,
          { id: crypto.randomUUID(), role: "assistant", content: "Updated", image: urls[0] },
        ]);
        setRefining(false);
      }
    } else if (job.status === "failed" || job.status === "cancelled") {
      pendingJobId.current = null;
      pendingJob.current = null;
      const message = job.error?.message || (job.status === "cancelled" ? "Cancelled" : "The model returned no image");

      if (pending.kind === "generate") {
        setStatus("failed");
        setError(message);
      } else {
        setHistory((current) => [
          ...current,
          { id: crypto.randomUUID(), role: "assistant", content: message, retryInstruction: chatInput || "Apply the change" },
        ]);
        setRefining(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs off queueJobs; other deps are stable refs/state read inside
  }, [queueJobs]);

  if (!can(user, TEXT_TO_IMAGE_PERMISSION)) {
    return (
      <div className="flex-1 overflow-y-auto px-8 py-8">
        <p className="text-sm text-muted">
          Text to Image isn&apos;t enabled for your account. Ask an admin to grant you access.
        </p>
      </div>
    );
  }

  function toggleSelect(key: string, val: string) {
    setSelections((prev) => {
      const next = { ...prev, [key]: prev[key] === val ? "" : val };
      return key === "jewelryType" ? clearJewelryTypeDependentSelections(next) : next;
    });
  }

  function toggleGroup(key: string) {
    setExpandedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function reset() {
    setStatus("idle");
    setImages([]);
    setSelectedView(null);
    setError("");
    setHistory([]);
    setChatInput("");
    attach.reset();
    conversationId.current = null;
    parentGenerationId.current = null;
    pendingJob.current = null;
    pendingJobId.current = null;
  }

  async function handleGenerate() {
    setError("");
    setStatus("generating");
    setImages([]);
    setSelectedView(null);
    setHistory([]);
    setChatInput("");

    const result = await textToImage({ prompt: finalDescription, model, style, aspect, count });
    if (result.status === "queued" && result.job) {
      pendingJobId.current = result.job.id;
      pendingJob.current = { kind: "generate" };
      track(result.job);
    } else {
      setStatus("failed");
      setError(result.message || "Could not queue this generation");
    }
  }

  function retry(msg: ChatMsg) {
    if (msg.retryInstruction === undefined) return;
    setChatInput(msg.retryInstruction);
  }

  async function handleRefine(text: string) {
    const trimmed = text.trim();
    const base = selectedView ?? images[0];
    if (!base || (!trimmed && !annotatedPhoto && referenceImages.length === 0) || refining) return;

    const userText = trimmed || "Apply the changes I marked on the image.";
    const imageToSend = annotatedPhoto || base;
    const refsThisTurn = referenceImages;

    setHistory((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", content: userText, refImages: refsThisTurn.length ? refsThisTurn : undefined },
    ]);
    setChatInput("");
    attach.setReferenceImages([]);
    attach.setAnnotatedPhoto(null);
    setRefining(true);
    setError("");

    let editable = imageToSend;
    if (!editable.startsWith("data:")) {
      try {
        editable = await urlToDataUrl(editable);
      } catch {
        setHistory((current) => [
          ...current,
          { id: crypto.randomUUID(), role: "assistant", content: "Could not load the image to refine", retryInstruction: trimmed },
        ]);
        setRefining(false);
        return;
      }
    }

    const result = await refineTextToImage({
      refineImage: editable,
      instruction: userText,
      displayPrompt: userText,
      model,
      referenceImages: refsThisTurn,
      conversationId: conversationId.current,
      parentGenerationId: parentGenerationId.current,
    });

    if (result.status === "queued" && result.job) {
      pendingJobId.current = result.job.id;
      pendingJob.current = { kind: "refine" };
      track(result.job);
    } else {
      setHistory((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "assistant", content: result.message || "Could not queue this refinement", retryInstruction: trimmed },
      ]);
      setRefining(false);
    }
  }

  const isGenerating = status === "generating";
  const displayImg = selectedView ?? images[0] ?? null;

  // ── Results ──
  if (status !== "idle") {
    return (
      <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
        <ToolHeader onReset={reset} resetLabel="New image" />
        {error && (
          <p className="shrink-0 border-b border-error/20 bg-error/[0.08] px-5 py-2 text-xs text-error">{error}</p>
        )}

        <StudioSplitLayout
          chatRail={
            <>
              <div className="shrink-0 space-y-2.5 px-4 pt-4 pb-3">
                <div className="flex items-center gap-2">
                  <p className="text-[10px] font-medium uppercase tracking-widest text-faint">Prompt</p>
                  <span className="rounded-full border border-gold/[0.18] bg-gold/[0.08] px-2 py-0.5 text-[9px] font-semibold leading-none text-gold/80">
                    {SPARKLE_MODELS.find((m) => m.id === model)?.label}
                  </span>
                </div>
                <div className="max-h-32 overflow-y-auto rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
                  <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-muted">{finalDescription || "—"}</p>
                </div>

                {images.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {images.map((src, i) => (
                      <button
                        key={src + i}
                        type="button"
                        onClick={() => setSelectedView(src)}
                        className={cn(
                          "relative block h-12 w-12 overflow-hidden rounded-lg border bg-white transition-colors",
                          displayImg === src ? "border-gold/50" : "border-white/[0.08] hover:border-gold/30"
                        )}
                      >
                        <Image src={src} alt="" fill sizes="48px" className="object-contain" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <ChatMessages
                history={history}
                busy={refining}
                onSelectResult={setSelectedView}
                onRetry={retry}
                hints={displayImg && history.length === 0 ? REFINE_HINTS : undefined}
                onHint={(hint) => handleRefine(hint)}
              />

              <div className="shrink-0 border-t border-white/[0.06] p-3">
                <ChatInputBar
                  value={chatInput}
                  onChange={setChatInput}
                  onSend={() => handleRefine(chatInput)}
                  busy={refining || !displayImg}
                  attachments={attach.attachments}
                  onOpenAttachment={attach.setPreviewAttachment}
                  onRemoveAttachment={attach.removeAttachment}
                  onAttachFiles={attach.addReferenceImages}
                  onPasteImage={(file) => attach.addReferenceImages([file])}
                  modelOptions={MODEL_OPTIONS}
                  modelValue={model}
                  onModelChange={setModel}
                  placeholder={displayImg ? "Describe a change…" : "Waiting for the first result…"}
                />
              </div>
            </>
          }
          stage={
            <>
              <GenerationStage
                src={displayImg}
                busy={isGenerating}
                busyLabel={`Generating ${count > 1 ? `${count} images` : "image"}…`}
                emptyLabel="Nothing yet"
                downloadName="generated.png"
                onExpand={annotating ? undefined : setLightboxSrc}
                onAnnotate={annotating || !displayImg ? undefined : (src) => setAnnotating({ src, target: "stage" })}
              />

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

  // ── Input ──
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <ToolHeader />
      {error && (
        <p className="shrink-0 border-b border-error/20 bg-error/[0.08] px-5 py-2 text-xs text-error">{error}</p>
      )}

      <div className="flex flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
        {/* ── Jewelry Builder ── */}
        <div className="flex w-full shrink-0 flex-col border-b border-white/[0.05] md:h-full md:w-3/5 md:border-b-0 md:border-r md:overflow-hidden">
          <div className="flex shrink-0 items-center justify-between border-b border-white/[0.05] px-4 py-3">
            <div>
              <p className="text-xs font-semibold text-cream">Jewelry Builder</p>
              <p className="mt-0.5 text-[10px] text-faint">Select to build description</p>
            </div>
            {selectedCount > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="rounded-full border border-gold/20 bg-gold/10 px-1.5 py-0.5 text-[9px] font-semibold text-gold/80">
                  {selectedCount}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSelections({});
                    setPrompt("");
                  }}
                  className="text-faint transition-colors hover:text-muted"
                >
                  <X size={12} />
                </button>
              </div>
            )}
          </div>

          <div className="md:flex-1 md:overflow-y-auto">
            {configurator.map((group) => {
              const active = selections[group.key];
              const open = expandedGroups[group.key];
              return (
                <div key={group.key} className="border-b border-white/[0.04]">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.key)}
                    className="flex w-full items-center justify-between px-4 py-2.5 transition-colors hover:bg-white/[0.02]"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="text-[11px] font-medium text-cream">{group.label}</span>
                      {active && (
                        <span className="max-w-[100px] truncate rounded-full border border-gold/20 bg-gold/10 px-1.5 py-0.5 text-[9px] text-gold/80">
                          {active}
                        </span>
                      )}
                    </div>
                    <ChevronRight size={11} className={cn("shrink-0 text-faint transition-transform", open && "rotate-90")} />
                  </button>
                  {open && (
                    <div className="flex flex-wrap gap-1.5 px-3 pb-3">
                      {group.options.map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => toggleSelect(group.key, opt)}
                          className={cn(
                            "rounded-lg border px-2 py-1 text-[10px] font-medium transition-all",
                            selections[group.key] === opt
                              ? "border-gold/30 bg-gold/10 text-gold"
                              : "border-white/[0.06] bg-white/[0.02] text-muted hover:border-white/[0.10] hover:text-cream"
                          )}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Generation Options ── */}
        <div className="flex-1 space-y-5 px-4 py-5 sm:px-4 md:overflow-y-auto md:px-4">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-cream">Visual Style</p>
            <div className="flex flex-wrap gap-2">
              {STYLES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStyle(s.id)}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-xs font-medium transition-all",
                    style === s.id
                      ? "border-gold/30 bg-gold/10 text-gold"
                      : "border-white/[0.07] bg-white/[0.03] text-muted hover:border-white/[0.12] hover:text-cream"
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-cream">Aspect Ratio</p>
            <div className="flex gap-2">
              {ASPECTS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setAspect(a.id)}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-2 rounded-xl border py-2.5 text-xs font-medium transition-all",
                    aspect === a.id
                      ? "border-gold/30 bg-gold/10 text-gold"
                      : "border-white/[0.07] bg-white/[0.03] text-muted hover:border-white/[0.12] hover:text-cream"
                  )}
                >
                  <span style={{ width: a.w, height: a.h }} className="shrink-0 rounded-[2px] border-2 border-current" />
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          {selectedCount > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-cream">Selected</p>
              <div className="flex flex-wrap gap-1.5">
                {configurator.map((g) =>
                  selections[g.key] ? (
                    <span
                      key={g.key}
                      className="flex items-center gap-1 rounded-full border border-gold/20 bg-gold/[0.07] px-2 py-1 text-[10px] text-gold/80"
                    >
                      <span className="text-faint">{g.label}:</span> {selections[g.key]}
                      <button type="button" onClick={() => toggleSelect(g.key, selections[g.key])} className="ml-0.5 hover:text-gold">
                        <X size={9} />
                      </button>
                    </span>
                  ) : null
                )}
              </div>
            </div>
          )}

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-cream">Description</p>
              <div className="flex items-center gap-2">
                {spellIssueCount > 0 && (
                  <span className="text-[10px] text-red-400/70">
                    {spellIssueCount} spelling{spellIssueCount > 1 ? "s" : ""}
                  </span>
                )}
                <span className="text-[10px] text-faint">{prompt.length}/3000</span>
              </div>
            </div>

            <div className="rounded-xl border border-white/[0.08] bg-surface-raised transition-colors focus-within:border-gold/30">
              <SpellCheckedTextarea
                value={prompt}
                onChange={setPrompt}
                rows={4}
                maxLength={3000}
                // Phrased without a direction: the builder is to the left on a
                // desktop and above on a phone.
                placeholder="Pick options in the Jewelry Builder, or type freely…"
                onIssueCount={setSpellIssueCount}
              />

              <div className="flex items-center justify-between gap-2 rounded-b-xl border-t border-white/[0.06] bg-surface-raised/60 px-3 py-2.5">
                <ImageCountSelector count={count} onChange={setCount} options={TEXT_COUNT_OPTIONS} />

                <div className="flex items-center gap-2">
                  <label className="flex min-w-0 flex-col items-start gap-0.5 rounded-lg border border-white/[0.07] bg-white/[0.04] px-2 py-1 transition-colors hover:border-white/[0.14] focus-within:border-gold/30">
                    <span className="text-[8px] font-semibold uppercase leading-none tracking-wide text-faint">Model</span>
                    <span className="flex items-center gap-1">
                      <select
                        value={model}
                        onChange={(event) => setModel(event.target.value as SparkleModelId)}
                        className="-ml-0.5 w-full max-w-[128px] cursor-pointer appearance-none truncate bg-transparent text-[10px] font-medium text-cream outline-none"
                      >
                        {SPARKLE_MODELS.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <ChevronDown size={10} className="shrink-0 text-faint" />
                    </span>
                  </label>

                  <div className="flex shrink-0 flex-col items-start gap-0.5 rounded-lg border border-white/[0.07] bg-white/[0.04] px-2 py-1">
                    <span className="text-[8px] font-semibold uppercase leading-none tracking-wide text-faint">Quality</span>
                    <span className="text-[10px] font-medium text-cream">
                      {SPARKLE_MODELS.find((m) => m.id === model)?.quality}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleGenerate}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-gold/30 bg-gold/15 px-4 py-3 text-xs font-semibold text-gold transition-colors hover:bg-gold/25"
            >
              <Wand2 size={14} />
              {count > 1 ? `Generate ${count} images` : "Generate image"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
