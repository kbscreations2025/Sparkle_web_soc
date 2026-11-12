"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowUp, Download, FileDown, FileSpreadsheet, FileText, ImageIcon, Loader2, MessageSquare, Presentation as PresentationIcon, RotateCcw, Sparkles, Upload, X } from "lucide-react";
import { ErrorBanner, RunButton } from "@/components/studio/ToolChrome";
import { Chip } from "@/components/studio/OptionChips";
import { DeckEditor } from "@/components/studio/deck-editor/DeckEditor";
import { PrintDeck } from "@/components/studio/deck-editor/PrintDeck";
import { JobProgressBar } from "@/components/studio/JobProgressBar";
import { ToolAccessNotice } from "@/components/studio/ToolAccessNotice";
import { buildPresentation, editPresentation, fetchMarketingKit, updateMarketingKit } from "@/lib/api";
import { isDesign, type DeckDesign } from "@/lib/deckDesign";
import { exportDesignPptx } from "@/lib/exportAffinity";
import { makeThumbnail } from "@/lib/image";
import {
  LENGTH_OPTIONS,
  STYLE_OPTIONS,
  buildPresentationDesign,
  imagesAsPieces,
  isOutline,
  rebuildDesign,
  type PresentationOutline,
} from "@/lib/presentation";
import {
  MAX_IMAGES,
  PRESENTATION_FILE_ACCEPT,
  readPresentationFiles,
  type PresentationImage,
  type PresentationSource,
} from "@/lib/presentationFiles";
import { usePageActions } from "@/lib/page-toolbar-context";
import { useCreditGuard } from "@/lib/credit-guard";
import { useJobs } from "@/lib/jobs-context";
import { failureMessage, useSettledJob } from "@/lib/useSettledJob";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/permissions";
import { doubleTap } from "@/lib/doubleTap";
import { Lightbox } from "@/components/studio/Lightbox";
import { cn } from "@/lib/utils";

const PERMISSION = "tool.marketing_kit.run";

/** Ready-made edits under the chat box — the things people ask a deck for most. */
const EDIT_SUGGESTIONS = [
  "Make it more minimal and premium",
  "Switch to a dark theme",
  "Shorten the text on every slide",
  "Add an agenda slide after the cover",
  "Add a summary slide before the end",
  "Turn the key numbers into a stats slide",
];

type Message = { role: "user" | "assistant"; text: string };

/**
 * Presentation: anything in, a designed deck out, refined by chat.
 *
 * Three moments on one screen. First the inputs — files of any kind, read in
 * the browser into text and pictures, plus an optional brief. Then the run,
 * which writes an outline. Then the deck: the outline laid out into editor
 * slides, with a chat beside it where each message is an edit — and only the
 * slides an edit actually changes are laid out again, so moving things by
 * hand and asking for changes can be mixed freely.
 */
export function PresentationWorkspace() {
  const { user } = useAuth();
  const { jobs, track } = useJobs();
  const creditGuard = useCreditGuard();
  const router = useRouter();
  const searchParams = useSearchParams();
  const openKitId = searchParams.get("kitId");

  // ── inputs
  const [sources, setSources] = useState<PresentationSource[]>([]);
  const [images, setImages] = useState<PresentationImage[]>([]);
  const [brief, setBrief] = useState("");
  const [style, setStyle] = useState("auto");
  const [length, setLength] = useState("auto");
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState("");
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // ── run and result
  const [error, setError] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [kitId, setKitId] = useState<string | null>(null);
  const [outline, setOutline] = useState<PresentationOutline | null>(null);
  /** The deck's pictures, as stored — what `pieceIndex` in the design points at. */
  const [deckImages, setDeckImages] = useState<string[]>([]);
  const [design, setDesign] = useState<DeckDesign | null>(null);
  const [designKey, setDesignKey] = useState(0);
  const latestDesign = useRef<DeckDesign | null>(null);
  const [loadingKit, setLoadingKit] = useState(Boolean(openKitId));

  // ── chat
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [editJobId, setEditJobId] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  const [exporting, setExporting] = useState(false);
  const [printing, setPrinting] = useState<DeckDesign | null>(null);

  const job = jobId ? (jobs.find((entry) => entry.id === jobId) ?? null) : null;
  const editJob = editJobId ? (jobs.find((entry) => entry.id === editJobId) ?? null) : null;
  const pieces = useMemo(() => imagesAsPieces(deckImages), [deckImages]);

  /** A saved deck reopened from History or the queue. */
  useEffect(() => {
    if (!openKitId || openKitId === kitId) return;
    let cancelled = false;
    fetchMarketingKit(openKitId).then((res) => {
      if (cancelled) return;
      setLoadingKit(false);
      const saved = res.status === "success" ? res.kit?.presentation : null;
      if (!saved || !isOutline(saved.outline)) {
        setError("That presentation could not be opened");
        return;
      }
      const urls = saved.images.map((image) => image.url);
      setKitId(openKitId);
      setOutline(saved.outline);
      setDeckImages(urls);
      setDesign(isDesign(saved.design) ? saved.design : buildPresentationDesign(saved.outline, urls.length));
      setDesignKey((key) => key + 1);
      setMessages(saved.messages.map(({ role, text }) => ({ role, text })));
    });
    return () => {
      cancelled = true;
    };
  }, [openKitId, kitId]);

  /** Saves the laid-out slides, so the deck reopens exactly as it is now. */
  const saveDesign = useCallback(
    async (next: DeckDesign) => {
      latestDesign.current = next;
      if (!kitId) return;
      const res = await updateMarketingKit(kitId, { design: next });
      if (res.status !== "success") setError(res.message || "Could not save that edit");
    },
    [kitId]
  );

  useSettledJob(job, (settled) => {
    setJobId(null);
    if (settled.status !== "completed") {
      setError(failureMessage(settled, "Could not build that presentation"));
      return;
    }
    const result = settled.result?.result as { outline?: unknown; images?: { url: string }[] } | undefined;
    if (!result || !isOutline(result.outline)) {
      setError("The model returned no slides — please try again");
      return;
    }
    const urls = (result.images ?? []).map((image) => image.url);
    // A deck whose save failed still shows, from the pictures it was sent.
    const shown = urls.length ? urls : images.map((image) => image.src);
    const built = buildPresentationDesign(result.outline, shown.length);
    const newKitId = settled.result?.kitId ? String(settled.result.kitId) : null;
    setOutline(result.outline);
    setDeckImages(shown);
    setDesign(built);
    latestDesign.current = built;
    setDesignKey((key) => key + 1);
    setMessages([]);
    if (newKitId) {
      setKitId(newKitId);
      updateMarketingKit(newKitId, { design: built });
    }
  });

  // The address names the deck, so a reload or a shared link reopens it. In
  // an effect: the settle handler above runs during render, where updating
  // the router is not allowed.
  useEffect(() => {
    if (kitId && kitId !== openKitId) router.replace(`/marketing-kit/presentation?kitId=${kitId}`);
  }, [kitId, openKitId, router]);

  useSettledJob(editJob, (settled) => {
    setEditJobId(null);
    if (settled.status !== "completed") {
      setMessages((list) => [...list, { role: "assistant", text: failureMessage(settled, "That edit didn't go through — try saying it another way.") }]);
      return;
    }
    const result = settled.result?.result as { outline?: unknown; reply?: string } | undefined;
    if (!result || !isOutline(result.outline)) {
      setMessages((list) => [...list, { role: "assistant", text: "That edit came back empty — please try again." }]);
      return;
    }
    const next = rebuildDesign(result.outline, deckImages.length, outline, latestDesign.current ?? design);
    setOutline(result.outline);
    setDesign(next);
    latestDesign.current = next;
    setDesignKey((key) => key + 1);
    setMessages((list) => [...list, { role: "assistant", text: result.reply || "Done — the deck is updated." }]);
    if (kitId) updateMarketingKit(kitId, { design: next });
  });

  // The thread follows the newest message.
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, editJobId]);

  async function addFiles(list: FileList | File[] | null) {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    setReading(true);
    setNotice("");
    try {
      const read = await readPresentationFiles(files, images.length);
      setSources((current) => [...current, ...read.sources]);
      setImages((current) => [...current, ...read.images].slice(0, MAX_IMAGES));
      const parts = [];
      if (read.skipped.length) parts.push(`Couldn't read ${read.skipped.join(", ")}`);
      if (images.length + read.images.length > MAX_IMAGES) parts.push(`Only the first ${MAX_IMAGES} pictures are used`);
      setNotice(parts.join(" · "));
    } finally {
      setReading(false);
    }
  }

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    addFiles(event.target.files);
    event.target.value = "";
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    addFiles(event.dataTransfer.files);
  }

  async function handleBuild() {
    setError("");
    const preview = images[0] ? await makeThumbnail(images[0].src) : null;
    const res = await buildPresentation({
      sources: sources.map(({ name, kind, text }) => ({ name, kind, text })),
      images: images.map(({ src, label }) => ({ src, label })),
      brief,
      style,
      length,
      preview,
    });
    if (res.status === "queued" && res.job) {
      setJobId(res.job.id);
      track(res.job);
    } else if (!creditGuard(res)) {
      setError(res.message || "Could not start this presentation");
    }
  }

  async function sendEdit(text: string) {
    const instruction = text.trim();
    if (!instruction || !kitId || editJobId) return;
    setDraft("");
    setMessages((list) => [...list, { role: "user", text: instruction }]);
    const res = await editPresentation({ kitId, instruction });
    if (res.status === "queued" && res.job) {
      setEditJobId(res.job.id);
      track(res.job);
    } else {
      creditGuard(res);
      setMessages((list) => [...list, { role: "assistant", text: res.message || "Could not send that edit." }]);
    }
  }

  function onSubmitEdit(event: FormEvent) {
    event.preventDefault();
    sendEdit(draft);
  }

  function reset() {
    setSources([]);
    setImages([]);
    setBrief("");
    setStyle("auto");
    setLength("auto");
    setNotice("");
    setError("");
    setJobId(null);
    setKitId(null);
    setOutline(null);
    setDeckImages([]);
    setDesign(null);
    latestDesign.current = null;
    setMessages([]);
    setEditJobId(null);
    router.replace("/marketing-kit/presentation");
  }

  async function downloadPptx() {
    const current = latestDesign.current ?? design;
    if (!current) return;
    setExporting(true);
    try {
      await exportDesignPptx({ design: current, pieces, collectionName: outline?.title || "presentation" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not build the PowerPoint");
    } finally {
      setExporting(false);
    }
  }

  const endPrint = useCallback(() => setPrinting(null), []);
  const showingDeck = Boolean(design && outline);

  usePageActions(
    showingDeck ? (
      <div className="flex items-center gap-1.5" data-app-chrome>
        <HeaderPill onClick={reset} icon={RotateCcw} label="New" />
        <HeaderPill onClick={downloadPptx} icon={FileDown} label="PPTX" busy={exporting} />
        <HeaderPill onClick={() => setPrinting(latestDesign.current ?? design)} icon={Download} label="PDF" busy={Boolean(printing)} />
      </div>
    ) : sources.length || images.length ? (
      <HeaderPill onClick={reset} icon={RotateCcw} label="Start over" />
    ) : null
  );

  if (!can(user, PERMISSION)) return <ToolAccessNotice tool="Marketing Kit" />;

  const building = Boolean(jobId);
  const hasInput = sources.length > 0 || images.length > 0 || brief.trim().length >= 10;

  // ── The deck, with the chat beside it ─────────────────────────────────────
  if (showingDeck && design) {
    const editing = Boolean(editJobId);
    const chat = (
      <div className="flex min-h-0 flex-1 flex-col">
        <div ref={threadRef} className="thin-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
          {messages.length === 0 && (
            <p className="text-[11px] leading-relaxed text-faint">
              Tell me what to change — &ldquo;make slide 3 a comparison&rdquo;, &ldquo;use navy and gold&rdquo;, &ldquo;add a slide on
              pricing&rdquo;. You can also edit any slide directly; your changes stay unless you ask me to redo that slide.
            </p>
          )}
          {messages.map((message, index) => (
            <div key={index} className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
              <p
                className={cn(
                  "max-w-[88%] whitespace-pre-wrap rounded-xl px-2.5 py-1.5 text-[11.5px] leading-snug",
                  message.role === "user"
                    ? "rounded-br-sm border border-gold/25 bg-gold/[0.08] text-cream"
                    : "rounded-bl-sm border border-white/10 bg-white/[0.04] text-muted"
                )}
              >
                {message.text}
              </p>
            </div>
          ))}
          {editing && (
            <div className="flex items-center gap-2 text-[11px] text-faint">
              <Loader2 size={12} className="animate-spin" /> Updating the deck…
            </div>
          )}
          {editing && editJob && <JobProgressBar percent={editJob.progress} />}
        </div>

        {!editing && (
          <div className="flex flex-wrap gap-1.5 px-3 pb-2">
            {EDIT_SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => sendEdit(suggestion)}
                className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-left text-[10.5px] text-gold transition-colors hover:bg-white/[0.08]"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}

        <form onSubmit={onSubmitEdit} className="flex items-end gap-2 border-t border-white/[0.06] p-2.5">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                sendEdit(draft);
              }
            }}
            rows={2}
            placeholder={editing ? "Wait for this edit to finish…" : "Ask for a change…"}
            disabled={editing || !kitId}
            className="thin-scrollbar max-h-32 min-h-[40px] flex-1 resize-none rounded-lg border border-white/10 bg-surface-raised px-2.5 py-2 text-base text-cream outline-none placeholder:text-faint focus:border-gold/40 disabled:opacity-60 md:text-[12px]"
          />
          <button
            type="submit"
            disabled={editing || !draft.trim() || !kitId}
            aria-label="Send"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold text-[#2A1E0C] transition-opacity disabled:opacity-40"
          >
            {editing ? <Loader2 size={15} className="animate-spin" /> : <ArrowUp size={16} />}
          </button>
        </form>
        {!kitId && <p className="px-3 pb-2 text-[10px] text-error">This deck wasn&apos;t saved, so it can&apos;t be edited by chat.</p>}
      </div>
    );

    return (
      <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
        <ErrorBanner message={error} />
        <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden lg:flex-row">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <DeckEditor key={designKey} initial={design} pieces={pieces} onSave={saveDesign} latestRef={latestDesign} />
          </div>

          {/* Desktop: the chat is a column beside the deck. */}
          <aside className="hidden w-[320px] shrink-0 flex-col border-l border-white/[0.06] bg-surface-raised/40 lg:flex">
            <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2.5">
              <Sparkles size={13} className="text-gold" />
              <p className="text-[12px] font-semibold text-cream">Edit with AI</p>
            </div>
            {chat}
          </aside>

          {/* Below desktop: a bar under the deck that opens into the thread. */}
          <div className={cn("flex flex-col border-t border-white/[0.06] bg-surface-raised lg:hidden", chatOpen ? "h-[52dvh]" : "")}>
            <button
              type="button"
              onClick={() => setChatOpen((open) => !open)}
              className="flex items-center gap-2 px-3 py-2.5 text-left"
            >
              <MessageSquare size={14} className="text-gold" />
              <span className="flex-1 text-[12px] font-semibold text-cream">Edit with AI</span>
              {editing && <Loader2 size={13} className="animate-spin text-faint" />}
              <span className="text-[11px] text-faint">{chatOpen ? "Hide" : messages.length ? `${messages.length} messages` : "Open"}</span>
            </button>
            {chatOpen && chat}
          </div>

          {printing && <PrintDeck design={printing} pieces={pieces} onDone={endPrint} />}
        </div>
      </div>
    );
  }

  // ── Inputs ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-7">
      <div className="mx-auto max-w-3xl space-y-6">
        <ErrorBanner message={error} />

        {loadingKit ? (
          <div className="flex justify-center py-20">
            <Loader2 size={18} className="animate-spin text-faint" />
          </div>
        ) : (
          <>
            <section className="space-y-3">
              <div>
                <h1 className="text-lg font-semibold text-cream">Make a presentation</h1>
                <p className="mt-1 text-[12px] leading-relaxed text-muted">
                  Drop in whatever you have — a price list, last season&apos;s deck, a brochure, notes, photos. You&apos;ll get a clean,
                  internationally presentable deck, then you can change anything by chatting with it.
                </p>
              </div>

              <div
                role="button"
                tabIndex={0}
                onClick={() => fileInput.current?.click()}
                onKeyDown={(event) => (event.key === "Enter" || event.key === " ") && fileInput.current?.click()}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                className={cn(
                  "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-9 text-center transition-colors",
                  dragging ? "border-gold/60 bg-gold/[0.06]" : "border-white/15 bg-surface-raised/50 hover:border-gold/40"
                )}
              >
                {reading ? <Loader2 size={22} className="animate-spin text-gold" /> : <Upload size={22} className="text-faint" />}
                <p className="text-[13px] text-cream">{reading ? "Reading your files…" : "Drop files here, or tap to choose"}</p>
                <p className="text-[11px] text-faint">Excel · CSV · PowerPoint · PDF · Word · text · photos — any mix, up to {MAX_IMAGES} pictures</p>
              </div>
              <input ref={fileInput} type="file" multiple accept={PRESENTATION_FILE_ACCEPT} onChange={onPick} className="hidden" />
              {notice && <p className="text-[11px] text-faint">{notice}</p>}

              {sources.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {sources.map((source, index) => (
                    <li
                      key={`${source.name}-${index}`}
                      className="flex max-w-full items-center gap-2 rounded-lg border border-white/10 bg-surface-raised px-2.5 py-1.5"
                    >
                      {source.kind === "Excel" || source.kind === "Table" ? (
                        <FileSpreadsheet size={13} className="shrink-0 text-gold/80" />
                      ) : source.kind === "PowerPoint" ? (
                        <PresentationIcon size={13} className="shrink-0 text-gold/80" />
                      ) : (
                        <FileText size={13} className="shrink-0 text-gold/80" />
                      )}
                      <span className="truncate text-[11.5px] text-cream">{source.name}</span>
                      <span className="shrink-0 text-[10px] text-faint">
                        {source.kind}
                        {source.imageCount ? ` · ${source.imageCount} pic${source.imageCount === 1 ? "" : "s"}` : ""}
                      </span>
                      <button
                        type="button"
                        onClick={() => setSources((list) => list.filter((_, i) => i !== index))}
                        aria-label={`Remove ${source.name}`}
                        className="shrink-0 rounded-full p-0.5 text-faint transition-colors hover:text-error"
                      >
                        <X size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {images.length > 0 && (
                <div className="space-y-1.5">
                  <p className="flex items-center gap-1.5 text-[11px] text-faint">
                    <ImageIcon size={12} /> {images.length} picture{images.length === 1 ? "" : "s"} the deck can use · double-tap to preview
                  </p>
                  <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
                    {images.map((image, index) => (
                      <li key={`${image.label}-${index}`} className="group relative aspect-square overflow-hidden rounded-lg border border-white/10 bg-white">
                        {/* eslint-disable-next-line @next/next/no-img-element -- local data URI preview */}
                        <img
                          src={image.src}
                          alt={image.label}
                          title={image.label}
                          {...doubleTap(`p-${index}`, () => setPreviewSrc(image.src))}
                          className="h-full w-full cursor-zoom-in object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => setImages((list) => list.filter((_, i) => i !== index))}
                          aria-label={`Remove ${image.label}`}
                          className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white/85 opacity-0 transition-opacity hover:text-white group-hover:opacity-100 touch:opacity-100"
                        >
                          <X size={11} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            <section className="space-y-2">
              <label htmlFor="presentation-brief" className="text-[12px] font-semibold text-cream">
                What should it say? <span className="font-normal text-faint">(optional)</span>
              </label>
              <textarea
                id="presentation-brief"
                value={brief}
                onChange={(event) => setBrief(event.target.value)}
                rows={4}
                placeholder="e.g. A 10-slide pitch of our bridal collection for a buyer in Dubai — lead with the best sellers, show prices in USD, end with ordering terms. Leave empty and AI will decide."
                className="w-full resize-y rounded-xl border border-white/10 bg-surface-raised px-3 py-2.5 text-base leading-relaxed text-cream outline-none placeholder:text-faint focus:border-gold/40 md:text-[13px]"
              />
            </section>

            <section className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <p className="text-[12px] font-semibold text-cream">Style</p>
                <div className="flex flex-wrap gap-1.5">
                  {STYLE_OPTIONS.map((option) => (
                    <Chip key={option.id} label={option.label} active={style === option.id} onClick={() => setStyle(option.id)} size="sm" />
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-[12px] font-semibold text-cream">Length</p>
                <div className="flex flex-wrap gap-1.5">
                  {LENGTH_OPTIONS.map((option) => (
                    <Chip key={option.id} label={option.label} active={length === option.id} onClick={() => setLength(option.id)} size="sm" />
                  ))}
                </div>
              </div>
            </section>

            <RunButton
              onClick={handleBuild}
              disabled={!hasInput || building || reading}
              icon={building || reading ? <Loader2 size={14} className="animate-spin" /> : <PresentationIcon size={14} />}
            >
              {building
                ? "Designing your presentation…"
                : reading
                  ? "Reading your files…"
                  : hasInput
                    ? "Build the presentation"
                    : "Add files or describe the presentation to begin"}
            </RunButton>
            {building && job && <JobProgressBar percent={job.progress} />}
          </>
        )}
      </div>
      <Lightbox src={previewSrc} onClose={() => setPreviewSrc(null)} />
    </div>
  );
}

function HeaderPill({ onClick, icon: Icon, label, busy }: { onClick: () => void; icon: typeof Download; label: string; busy?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={label}
      aria-label={label}
      className="flex h-7 w-7 shrink-0 items-center justify-center gap-1.5 rounded-full border border-white/10 bg-surface-raised text-[11px] font-medium text-cream transition-colors hover:border-white/20 disabled:opacity-50 sm:w-auto sm:px-3 md:h-8"
    >
      {busy ? <Loader2 size={13} className="animate-spin text-faint" /> : <Icon size={13} className="text-faint" />}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
