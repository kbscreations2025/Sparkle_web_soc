"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowUp, CalendarClock, Download, FileDown, FileSpreadsheet, FileText, ImageIcon, Loader2, MessageSquare, Presentation as PresentationIcon, RotateCcw, Sparkles, Upload, X } from "lucide-react";
import { ErrorBanner, RunButton } from "@/components/studio/ToolChrome";
import { Chip } from "@/components/studio/OptionChips";
import { DeckEditor } from "@/components/studio/deck-editor/DeckEditor";
import { PrintDeck } from "@/components/studio/deck-editor/PrintDeck";
import { JobProgressBar } from "@/components/studio/JobProgressBar";
import { ToolAccessNotice } from "@/components/studio/ToolAccessNotice";
import { buildPresentation, editPresentation, fetchMarketingKit, updateMarketingKit, type QueuedJob } from "@/lib/api";
import { describeJob, useNow } from "@/lib/job-progress";
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
  const { jobs, track, refresh } = useJobs();
  const creditGuard = useCreditGuard();
  const router = useRouter();
  const searchParams = useSearchParams();
  const openKitId = searchParams.get("kitId");
  /** A deck still being built, named in the address so a reload or a link comes back to it. */
  const openJobId = searchParams.get("job");

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
  const [jobId, setJobId] = useState<string | null>(openJobId);
  /** The build request is still on its way up (files and all), before there's a job to show. */
  const [starting, setStarting] = useState(false);
  /**
   * Whether the queue has been read since this page opened on a `?job=` link.
   * Until then a job that isn't listed may simply not have loaded yet; after,
   * it has left the queue (finished long ago, or not this person's).
   */
  const [queueChecked, setQueueChecked] = useState(false);
  const [kitId, setKitId] = useState<string | null>(null);
  const [outline, setOutline] = useState<PresentationOutline | null>(null);
  /** The deck's pictures, as stored — what `pieceIndex` in the design points at. */
  const [deckImages, setDeckImages] = useState<string[]>([]);
  const [design, setDesign] = useState<DeckDesign | null>(null);
  const [designKey, setDesignKey] = useState(0);
  const latestDesign = useRef<DeckDesign | null>(null);
  const [loadingKit, setLoadingKit] = useState(Boolean(openKitId));
  /**
   * A deck a run just built but couldn't hand back inline, opened from where
   * it was saved instead. The job runner keeps only a result's ids once it
   * passes 32KB (backend/src/worker.js, withinResultBudget), and a long deck
   * passes that easily. The deck itself is always saved first.
   */
  const [builtKitId, setBuiltKitId] = useState<string | null>(null);
  const kitToOpen = openKitId ?? builtKitId;
  /** Same for an edit: its outline is re-read from the saved deck. */
  const [reloadAfterEdit, setReloadAfterEdit] = useState(false);
  /**
   * When the deck on screen was made, and by whom. Shown above it, and
   * `isOwn` decides whether it can be saved: only the owner may change a kit,
   * so a teammate's deck opens view-only instead of failing every autosave
   * with "kit not found".
   */
  const [deckInfo, setDeckInfo] = useState<{ createdAt: string; userName?: string; isOwn: boolean } | null>(null);
  const readOnly = deckInfo?.isOwn === false;

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

  /** A saved deck reopened from History or the queue, or one a run just built (see builtKitId). */
  useEffect(() => {
    if (!kitToOpen || kitToOpen === kitId) return;
    let cancelled = false;
    fetchMarketingKit(kitToOpen).then((res) => {
      if (cancelled) return;
      setLoadingKit(false);
      setBuiltKitId(null);
      const saved = res.status === "success" ? res.kit?.presentation : null;
      if (!saved || !isOutline(saved.outline)) {
        setError("That presentation could not be opened");
        return;
      }
      const urls = saved.images.map((image) => image.url);
      const savedDesign = isDesign(saved.design) ? saved.design : null;
      const shownDesign = savedDesign ?? buildPresentationDesign(saved.outline, urls.length);
      // Whatever went wrong before this is over: the deck is here.
      setError("");
      setKitId(kitToOpen);
      setOutline(saved.outline);
      setDeckImages(urls);
      setDesign(shownDesign);
      latestDesign.current = shownDesign;
      setDesignKey((key) => key + 1);
      setMessages(saved.messages.map(({ role, text }) => ({ role, text })));
      const isOwn = res.kit?.isOwn !== false;
      setDeckInfo({ createdAt: res.kit!.createdAt, userName: res.kit!.userName, isOwn });
      // A first open lays the deck out; kept, so it reopens exactly like this.
      // Only by its owner, the one person allowed to save it.
      if (!savedDesign && isOwn) updateMarketingKit(kitToOpen, { design: shownDesign });
    });
    return () => {
      cancelled = true;
    };
  }, [kitToOpen, kitId]);

  /** Saves the laid-out slides, so the deck reopens exactly as it is now. */
  const saveDesign = useCallback(
    async (next: DeckDesign) => {
      latestDesign.current = next;
      // A teammate's deck can be rearranged on screen, but only its owner can
      // save it: nothing is sent, and the bar above says so.
      if (!kitId || readOnly) return;
      const res = await updateMarketingKit(kitId, { design: next });
      if (res.status !== "success") setError(res.message || "Could not save that edit");
    },
    [kitId, readOnly]
  );

  useSettledJob(job, (settled) => {
    setJobId(null);
    if (settled.status !== "completed") {
      setError(failureMessage(settled, "Could not build that presentation"));
      return;
    }
    const result = settled.result?.result as { outline?: unknown; images?: { url: string }[] } | undefined;
    const newKitId = settled.result?.kitId ? String(settled.result.kitId) : null;
    if (!result || !isOutline(result.outline)) {
      // Built and saved, just too large to come back inline (see builtKitId):
      // opened from where it was saved. "No slides" was shown here for every
      // long deck, with the deck sitting in History all along.
      if (newKitId) {
        setLoadingKit(true);
        setBuiltKitId(newKitId);
        return;
      }
      setError("The model returned no slides — please try again");
      return;
    }
    const urls = (result.images ?? []).map((image) => image.url);
    // A deck whose save failed still shows, from the pictures it was sent.
    const shown = urls.length ? urls : images.map((image) => image.src);
    const built = buildPresentationDesign(result.outline, shown.length);
    setOutline(result.outline);
    setDeckImages(shown);
    setDesign(built);
    latestDesign.current = built;
    setDesignKey((key) => key + 1);
    setMessages([]);
    // Just made, by this person: theirs to change.
    setDeckInfo({ createdAt: settled.finishedAt ?? new Date().toISOString(), isOwn: true });
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

  // A build that failed goes back to the form, so its `?job=` goes too —
  // otherwise a reload would reopen the building view of a finished failure.
  useEffect(() => {
    if (openJobId && !jobId && !kitId) router.replace("/marketing-kit/presentation");
  }, [openJobId, jobId, kitId, router]);

  // Opened on a `?job=` link: read the queue once, so a job that has left it
  // can be told apart from one that simply hasn't loaded yet.
  useEffect(() => {
    if (!openJobId) return;
    let cancelled = false;
    refresh().finally(() => {
      if (!cancelled) setQueueChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [openJobId, refresh]);

  useSettledJob(editJob, (settled) => {
    setEditJobId(null);
    if (settled.status !== "completed") {
      setMessages((list) => [...list, { role: "assistant", text: failureMessage(settled, "That edit didn't go through — try saying it another way.") }]);
      return;
    }
    const result = settled.result?.result as { outline?: unknown; reply?: string } | undefined;
    if (!result || !isOutline(result.outline)) {
      // Saved, just too large to come back inline: the edited outline is
      // re-read from the deck (see the effect below), not reported as empty.
      if (settled.result?.kitId) {
        setReloadAfterEdit(true);
        return;
      }
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

  // An edit too large to come back inline (see builtKitId): its outline is
  // read back from the saved deck and applied exactly as an inline one is.
  useEffect(() => {
    if (!reloadAfterEdit || !kitId) return;
    let cancelled = false;
    fetchMarketingKit(kitId).then((res) => {
      if (cancelled) return;
      setReloadAfterEdit(false);
      const saved = res.status === "success" ? res.kit?.presentation : null;
      if (!saved || !isOutline(saved.outline)) {
        setMessages((list) => [
          ...list,
          { role: "assistant", text: "The deck was updated, but couldn't be reloaded here. Reopen it from History to see the change." },
        ]);
        return;
      }
      const next = rebuildDesign(saved.outline, deckImages.length, outline, latestDesign.current ?? design);
      setOutline(saved.outline);
      setDesign(next);
      latestDesign.current = next;
      setDesignKey((key) => key + 1);
      const last = saved.messages[saved.messages.length - 1];
      setMessages((list) => [
        ...list,
        { role: "assistant", text: last?.role === "assistant" && last.text ? last.text : "Done — the deck is updated." },
      ]);
      updateMarketingKit(kitId, { design: next });
    });
    return () => {
      cancelled = true;
    };
  }, [reloadAfterEdit, kitId, deckImages.length, outline, design]);

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
    setStarting(true);
    try {
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
        // Straight to the deck's own page, showing it being built, rather
        // than leaving the form on screen with a spinner in its button. The
        // address names the job, so a reload comes back here too.
        setJobId(res.job.id);
        track(res.job);
        router.replace(`/marketing-kit/presentation?job=${res.job.id}`);
      } else if (!creditGuard(res)) {
        setError(res.message || "Could not start this presentation");
      }
    } finally {
      setStarting(false);
    }
  }

  async function sendEdit(text: string) {
    const instruction = text.trim();
    if (!instruction || !kitId || editJobId || readOnly) return;
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
    setDeckInfo(null);
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

  const hasInput = sources.length > 0 || images.length > 0 || brief.trim().length >= 10;

  // ── The deck, with the chat beside it ─────────────────────────────────────
  if (showingDeck && design) {
    // Still "updating" while a large edit's outline is being read back.
    const editing = Boolean(editJobId) || reloadAfterEdit;
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

        {!editing && !readOnly && (
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
            placeholder={
              readOnly ? "Only the person who made this deck can change it" : editing ? "Wait for this edit to finish…" : "Ask for a change…"
            }
            disabled={editing || !kitId || readOnly}
            className="thin-scrollbar max-h-32 min-h-[40px] flex-1 resize-none rounded-lg border border-white/10 bg-surface-raised px-2.5 py-2 text-base text-cream outline-none placeholder:text-faint focus:border-gold/40 disabled:opacity-60 md:text-[12px]"
          />
          <button
            type="submit"
            disabled={editing || !draft.trim() || !kitId || readOnly}
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
        {deckInfo && <DeckInfoBar {...deckInfo} />}
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

  // ── Being built ────────────────────────────────────────────────────────────
  // Its own page from the moment Build is pressed, until the deck replaces it.
  if (jobId) {
    return (
      <BuildingView
        job={job}
        missing={!job && queueChecked}
        brief={brief}
        sourceNames={sources.map((source) => source.name)}
        pictures={images.map((image) => image.src)}
        styleLabel={STYLE_OPTIONS.find((option) => option.id === style)?.label}
        lengthLabel={LENGTH_OPTIONS.find((option) => option.id === length)?.label}
        onStartOver={reset}
      />
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
              disabled={!hasInput || starting || reading}
              icon={starting || reading ? <Loader2 size={14} className="animate-spin" /> : <PresentationIcon size={14} />}
            >
              {starting
                ? "Sending your files…"
                : reading
                  ? "Reading your files…"
                  : hasInput
                    ? "Build the presentation"
                    : "Add files or describe the presentation to begin"}
            </RunButton>
          </>
        )}
      </div>
      <Lightbox src={previewSrc} onClose={() => setPreviewSrc(null)} />
    </div>
  );
}

/**
 * The deck's page while it's being built: what's happening and how far
 * along, placeholders where the slides will appear, and what was asked for.
 *
 * Shown from the moment Build is pressed. Before, the form stayed up with a
 * spinner in its button, which read as nothing having happened yet. The
 * build runs in the queue, so leaving is fine, and the page says so.
 */
function BuildingView({
  job,
  missing,
  brief,
  sourceNames,
  pictures,
  styleLabel,
  lengthLabel,
  onStartOver,
}: {
  job: QueuedJob | null;
  /** Opened on a link to a job that isn't in the queue any more. */
  missing: boolean;
  brief: string;
  sourceNames: string[];
  pictures: string[];
  styleLabel?: string;
  lengthLabel?: string;
  onStartOver: () => void;
}) {
  const active = Boolean(job && (job.status === "queued" || job.status === "running"));
  const now = useNow(active);
  const status = job ? describeJob(job, now).label : "Starting…";
  // Only what this tab still holds: after a reload the request itself is gone.
  const asked = [
    sourceNames.length ? `${sourceNames.length} file${sourceNames.length === 1 ? "" : "s"}` : null,
    pictures.length ? `${pictures.length} picture${pictures.length === 1 ? "" : "s"}` : null,
    styleLabel ? `Style: ${styleLabel}` : null,
    lengthLabel ? `Length: ${lengthLabel}` : null,
  ].filter(Boolean);
  const hasSummary = Boolean(brief.trim() || sourceNames.length || pictures.length);

  if (missing) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <PresentationIcon size={26} className="text-gold/80" />
        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold text-cream">This presentation isn&apos;t building any more</h1>
          <p className="mx-auto max-w-sm text-[13px] leading-relaxed text-muted">
            It may have finished a while ago. Finished decks are kept in History, under Marketing Kits.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Link
            href="/history?view=kits"
            className="rounded-lg border border-gold/30 bg-gold/10 px-4 py-2 text-[13px] font-medium text-gold transition-colors hover:bg-gold/15"
          >
            Open History
          </Link>
          <button
            type="button"
            onClick={onStartOver}
            className="rounded-lg border border-white/10 bg-surface-raised px-4 py-2 text-[13px] font-medium text-cream transition-colors hover:border-white/20"
          >
            Make a new one
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-7">
      <div className="mx-auto max-w-4xl space-y-6">
        <section className="space-y-3">
          <div className="flex items-start gap-3">
            <Loader2 size={18} className="mt-1 shrink-0 animate-spin text-gold" />
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-cream">Building your presentation</h1>
              <p className="mt-0.5 text-[12px] text-muted" role="status">
                {status}
              </p>
            </div>
          </div>
          {job && <JobProgressBar percent={job.progress} />}
          <p className="text-[11.5px] leading-relaxed text-faint">
            You can leave this page. It keeps building in your queue, and opens right here when it&apos;s ready.
          </p>
        </section>

        {/* Where the slides will be. */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-hidden>
          {Array.from({ length: 6 }, (_, index) => (
            <div
              key={index}
              className="aspect-video animate-pulse rounded-lg border border-white/10 bg-white/[0.04]"
              style={{ animationDelay: `${index * 120}ms` }}
            />
          ))}
        </div>

        {hasSummary && (
          <section className="space-y-2 rounded-xl border border-white/10 bg-surface-raised/50 p-4">
            <p className="text-[12px] font-semibold text-cream">What you asked for</p>
            {brief.trim() && <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-muted">{brief.trim()}</p>}
            {asked.length > 0 && <p className="text-[11px] text-faint">{asked.join(" · ")}</p>}
            {pictures.length > 0 && (
              <ul className="flex flex-wrap gap-1.5 pt-1">
                {pictures.slice(0, 12).map((src, index) => (
                  <li key={index} className="h-10 w-10 overflow-hidden rounded-md border border-white/10 bg-white">
                    {/* eslint-disable-next-line @next/next/no-img-element -- local data URI preview */}
                    <img src={src} alt="" className="h-full w-full object-cover" />
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

/**
 * A slim line above the deck: when it was made, and for a teammate's deck,
 * who made it and that it can only be looked at. In the viewer's own time
 * zone and language, e.g. "Made on 26 Nov 2026, 10:29 am".
 */
function DeckInfoBar({ createdAt, userName, isOwn }: { createdAt: string; userName?: string; isOwn: boolean }) {
  const made = new Date(createdAt);
  const when = Number.isNaN(made.getTime())
    ? null
    : made.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <p className="flex shrink-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 border-b border-white/[0.06] px-4 py-1.5 text-[11px] text-faint sm:px-5">
      <CalendarClock size={12} className="shrink-0" aria-hidden />
      {when && (
        <span>
          Made on <time dateTime={made.toISOString()} className="text-muted">{when}</time>
        </span>
      )}
      {!isOwn && (
        <>
          {userName && (
            <span>
              by <span className="text-muted">{userName}</span>
            </span>
          )}
          <span aria-hidden>·</span>
          <span className="text-gold">View only, changes here aren&apos;t saved</span>
        </>
      )}
    </p>
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
