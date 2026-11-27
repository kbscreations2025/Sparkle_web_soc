"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowUp, CalendarClock, Download, FileDown, FileSpreadsheet, FileText, ImageIcon, LayoutTemplate, Loader2, MessageSquare, PenLine, Presentation as PresentationIcon, RotateCcw, Sparkles, Upload, X } from "lucide-react";
import { ErrorBanner, RunButton } from "@/components/studio/ToolChrome";
import { Chip } from "@/components/studio/OptionChips";
import { DeckEditor } from "@/components/studio/deck-editor/DeckEditor";
import { PrintDeck } from "@/components/studio/deck-editor/PrintDeck";
import { JobProgressBar } from "@/components/studio/JobProgressBar";
import { ToolAccessNotice } from "@/components/studio/ToolAccessNotice";
import { buildPresentation, editPresentation, fetchMarketingKit, planPresentationRedesign, redesignPresentation, updateMarketingKit, type QueuedJob } from "@/lib/api";
import { isRedesignSource, layoutRedesign, planningBrief, readPlan, type RedesignPlan, type RedesignSource } from "@/lib/pptxRedesign";
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

/** The same for a redesigned PowerPoint, whose chat arranges the slides and never touches their words. */
const ARRANGE_SUGGESTIONS = [
  "Make the concept slides dark and dramatic",
  "Use the rough pencil sketches as background drama",
  "Give each design a slide of its own",
  "Try blush and rose gold",
  "Keep the inspiration pictures small in the corner",
];

/** What the description box suggests, in the words people use for this. */
const REDESIGN_PLACEHOLDER =
  "e.g. Slides 1, 2, 6, 10 and 14 are concept slides. Keep the inspiration images small in the top right corner. The R-numbered designs are the main sketches; the rough pencil sketches in the blank spaces are there for drama, so keep them in the background. Leave this empty for the standard redesign.";

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
  /** More pictures than a written deck can use. Said only when writing: a redesign uses them all. */
  const [overLimit, setOverLimit] = useState(false);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  /**
   * The PowerPoint among the uploads, kept as the file itself: a redesign
   * reads where everything sits on each slide, which the text and pictures
   * read out for writing a new deck don't keep.
   */
  const [deckFile, setDeckFile] = useState<File | null>(null);
  /** With a PowerPoint uploaded: keep its slides and redesign them (the default), or write a new deck. */
  const [mode, setMode] = useState<"redesign" | "write">("redesign");
  /** What a redesign is doing while it runs: it happens in this tab, in seconds, with no job behind it. */
  const [redesignStatus, setRedesignStatus] = useState<string | null>(null);
  const redesignMode = mode === "redesign" && Boolean(deckFile);

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
  /**
   * The open deck is a redesigned PowerPoint: its words are the person's own,
   * kept exactly. Its chat arranges (a description read into a plan) rather
   * than edits: a chat edit rewrites the outline in the model's own words.
   */
  const [redesigned, setRedesigned] = useState(false);
  /** Said once over a just-redesigned deck: anything in the file that couldn't come across. */
  const [deckNotice, setDeckNotice] = useState("");
  /**
   * A redesigned deck's slides as read from the file, and the plan it is laid
   * out from: what a description rearranges. No source (a deck redesigned
   * before these were kept) means no arranging.
   */
  const [redesignSource, setRedesignSource] = useState<RedesignSource | null>(null);
  const [redesignPlan, setRedesignPlan] = useState<RedesignPlan | null>(null);
  /** A description being read into a plan. */
  const [planJobId, setPlanJobId] = useState<string | null>(null);
  /** A just-redesigned deck waiting for its first arrangement: shown once that lands, not before. */
  const [arranging, setArranging] = useState(false);
  const canArrange = redesigned && Boolean(redesignSource);

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
  const planJob = planJobId ? (jobs.find((entry) => entry.id === planJobId) ?? null) : null;
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
      const isOwn = res.kit?.isOwn !== false;
      const source = saved.style === "redesign" && isRedesignSource(saved.redesign?.source) ? saved.redesign.source : null;
      const plan = source ? readPlan(saved.redesign?.plan, source) : null;
      // A plan that landed while the deck was closed (its description finished
      // after the person left) is laid out now, as it would have been then.
      const behind = Boolean(source && plan?.id && savedDesign?.planId !== plan.id);
      const shownDesign = behind ? layoutRedesign(source!, plan).design : (savedDesign ?? buildPresentationDesign(saved.outline, urls.length));
      // Whatever went wrong before this is over: the deck is here.
      setError("");
      setKitId(kitToOpen);
      setOutline(saved.outline);
      setDeckImages(urls);
      setDesign(shownDesign);
      latestDesign.current = shownDesign;
      setDesignKey((key) => key + 1);
      setMessages(saved.messages.map(({ role, text }) => ({ role, text })));
      setRedesigned(saved.style === "redesign");
      setRedesignSource(source);
      setRedesignPlan(plan);
      setDeckInfo({ createdAt: res.kit!.createdAt, userName: res.kit!.userName, isOwn });
      // A first open lays the deck out; kept, so it reopens exactly like this.
      // Only by its owner, the one person allowed to save it.
      if ((!savedDesign || behind) && isOwn) updateMarketingKit(kitToOpen, { design: shownDesign });
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
    setRedesigned(false);
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

  /**
   * A description read into a plan: the deck laid out again from it, words
   * untouched, and saved. Hand edits made since the last layout are replaced;
   * the chat says so before anything is sent.
   */
  useSettledJob(planJob, (settled) => {
    setPlanJobId(null);
    const first = arranging;
    setArranging(false);
    const result = settled.result?.result as { plan?: unknown; reply?: string } | undefined;
    const plan = settled.status === "completed" && redesignSource ? readPlan(result?.plan, redesignSource) : null;
    if (!plan || !redesignSource) {
      const message =
        settled.status === "completed"
          ? "That description came back without a usable plan. Try saying it another way."
          : failureMessage(settled, "Couldn't arrange the deck as described. Try saying it another way.");
      setMessages((list) => [...list, { role: "assistant", text: message }]);
      // A brand-new deck still opens, in the standard redesign, with the reason above it.
      if (first) setDeckNotice(`${message} This is the standard redesign; describe the change again in the chat.`);
      return;
    }
    const laid = layoutRedesign(redesignSource, plan);
    setRedesignPlan(plan);
    setOutline(laid.outline);
    setDesign(laid.design);
    latestDesign.current = laid.design;
    setDesignKey((key) => key + 1);
    setMessages((list) => [...list, { role: "assistant", text: result?.reply || "Done — the slides are arranged as you described." }]);
    if (kitId) updateMarketingKit(kitId, { design: laid.design });
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
  }, [messages, editJobId, planJobId]);

  async function addFiles(list: FileList | File[] | null) {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    setReading(true);
    setNotice("");
    // A PowerPoint is offered for redesign; the newest one, if several are added.
    const pptx = files.filter((file) => /\.pptx$/i.test(file.name)).pop();
    if (pptx) {
      setDeckFile(pptx);
      setMode("redesign");
    }
    try {
      const read = await readPresentationFiles(files, images.length);
      setSources((current) => [...current, ...read.sources]);
      setImages((current) => [...current, ...read.images].slice(0, MAX_IMAGES));
      setNotice(read.skipped.length ? `Couldn't read ${read.skipped.join(", ")}` : "");
      setOverLimit(images.length + read.images.length > MAX_IMAGES);
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

  /**
   * Sends a description of how a redesigned deck should be arranged, to be
   * read into a plan (see the plan job's settle handler). True once it's
   * queued; otherwise what to tell the person.
   */
  async function requestArrangement(deckId: string, source: RedesignSource, plan: RedesignPlan | null, instruction: string) {
    const res = await planPresentationRedesign({ kitId: deckId, instruction, ...planningBrief(source, plan) });
    if (res.status === "queued" && res.job) {
      setPlanJobId(res.job.id);
      track(res.job);
      return true as const;
    }
    creditGuard(res);
    return res.message || "Couldn't send that description.";
  }

  /**
   * Redesigns the uploaded PowerPoint: laid out here in the browser in a few
   * seconds, every word as written (lib/pptxRedesign.ts), then saved. With no
   * description that's all: no model, no queue, no credits. With one, the
   * description is then read into a plan and the deck opens laid out from it.
   */
  async function handleRedesign() {
    if (!deckFile) return;
    const instruction = brief.trim();
    setError("");
    setRedesignStatus("Reading your slides…");
    try {
      const { redesignPptx } = await import("@/lib/pptxRedesign");
      let result: Awaited<ReturnType<typeof redesignPptx>>;
      try {
        result = await redesignPptx(deckFile);
      } catch (err) {
        console.error("[presentation] redesign failed:", err);
        setError(`${deckFile.name} couldn't be read. Check that it opens in PowerPoint, then try again.`);
        return;
      }
      setRedesignStatus(`Saving ${result.slideCount.after} slides and ${result.images.length} pictures…`);
      const res = await redesignPresentation({
        title: result.name,
        fileName: deckFile.name,
        images: result.images,
        design: result.design,
        outline: result.outline,
        text: result.text,
        source: result.source,
        instruction,
      });
      const kit = res.status === "success" ? res.kit : null;
      const saved = kit?.presentation;
      if (!kit || !saved || !isDesign(saved.design) || !isOutline(saved.outline)) {
        setError(res.message || "Could not save the redesigned deck");
        return;
      }
      setKitId(kit.id);
      setOutline(saved.outline);
      setDeckImages(saved.images.map((image) => image.url));
      setDesign(saved.design);
      latestDesign.current = saved.design;
      setDesignKey((key) => key + 1);
      setMessages([]);
      setRedesigned(true);
      setRedesignSource(result.source);
      setRedesignPlan(null);
      setDeckInfo({ createdAt: kit.createdAt, isOwn: true });
      const notes: string[] = [];
      if (result.skipped.length) notes.push(`Couldn't carry over ${result.skipped.join(", ")}.`);
      // Never expected: every text box is placed by construction. Said plainly if it ever happens.
      if (result.missing.length) {
        notes.push(`${result.missing.length} line${result.missing.length === 1 ? "" : "s"} of text couldn't be placed: ${result.missing.slice(0, 3).join(" · ")}`);
      }

      if (instruction) {
        setMessages([{ role: "user", text: instruction }]);
        setRedesignStatus("Sending your description…");
        const sent = await requestArrangement(kit.id, result.source, null, instruction);
        if (sent === true) {
          setArranging(true);
        } else {
          // Saved all the same: it opens in the standard redesign, saying why.
          notes.push(`Couldn't arrange it as described: ${sent} This is the standard redesign.`);
          setMessages((list) => [...list, { role: "assistant", text: sent }]);
        }
      }
      setDeckNotice(notes.join(" "));
    } finally {
      setRedesignStatus(null);
    }
  }

  async function sendEdit(text: string) {
    const instruction = text.trim();
    if (!instruction || !kitId || editJobId || planJobId || readOnly) return;
    setDraft("");
    setMessages((list) => [...list, { role: "user", text: instruction }]);
    // A redesigned deck is arranged, never rewritten.
    if (canArrange && redesignSource) {
      const sent = await requestArrangement(kitId, redesignSource, redesignPlan, instruction);
      if (sent !== true) setMessages((list) => [...list, { role: "assistant", text: sent }]);
      return;
    }
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
    setOverLimit(false);
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
    setDeckFile(null);
    setMode("redesign");
    setRedesigned(false);
    setDeckNotice("");
    setRedesignSource(null);
    setRedesignPlan(null);
    setPlanJobId(null);
    setArranging(false);
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
    // Not while a new redesign is being arranged: a download then would be the layout before the description.
    showingDeck && !arranging ? (
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
  const shownNotice = [notice, overLimit && !redesignMode ? `Only the first ${MAX_IMAGES} pictures are used` : ""].filter(Boolean).join(" · ");
  /** Anything uploaded besides the PowerPoint (and the pictures read out of it), which a redesign leaves out. */
  const hasOtherFiles =
    Boolean(deckFile) &&
    (sources.some((source) => source.name !== deckFile!.name) || images.some((image) => !image.label.startsWith(`${deckFile!.name} · `)));

  // ── A new redesign being arranged as described ────────────────────────────
  // Saved already; it opens once its plan lands, so it isn't shown twice.
  if (arranging) {
    return (
      <BuildingView
        job={planJob}
        missing={false}
        title="Arranging your slides as you described"
        note="Every word and every picture stays exactly as it is in your file; only the arrangement follows your description. Your deck is already saved, and this takes about a minute."
        brief={brief}
        sourceNames={deckFile ? [deckFile.name] : []}
        pictures={[]}
        styleLabel="Redesign, every word kept"
        onStartOver={reset}
      />
    );
  }

  // ── The deck, with the chat beside it ─────────────────────────────────────
  if (showingDeck && design) {
    // Still "updating" while a large edit's outline is being read back.
    const editing = Boolean(editJobId) || reloadAfterEdit || Boolean(planJobId);
    const runningJob = editJob ?? planJob;
    const chatTitle = canArrange ? "Arrange with AI" : "Edit with AI";
    const chat = (
      <div className="flex min-h-0 flex-1 flex-col">
        <div ref={threadRef} className="thin-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
          {messages.length === 0 &&
            (canArrange ? (
              <p className="text-[11px] leading-relaxed text-faint">
                Describe how the slides should be arranged: which are concept slides, where the pictures go, the colours. Every word
                stays exactly as written. Each change lays the deck out again, so make it before editing slides by hand.
              </p>
            ) : (
              <p className="text-[11px] leading-relaxed text-faint">
                Tell me what to change — &ldquo;make slide 3 a comparison&rdquo;, &ldquo;use navy and gold&rdquo;, &ldquo;add a slide on
                pricing&rdquo;. You can also edit any slide directly; your changes stay unless you ask me to redo that slide.
              </p>
            ))}
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
              <Loader2 size={12} className="animate-spin" /> {planJobId ? "Arranging the slides…" : "Updating the deck…"}
            </div>
          )}
          {editing && runningJob && <JobProgressBar percent={runningJob.progress} />}
        </div>

        {!editing && !readOnly && (
          <div className="flex flex-wrap gap-1.5 px-3 pb-2">
            {(canArrange ? ARRANGE_SUGGESTIONS : EDIT_SUGGESTIONS).map((suggestion) => (
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
              readOnly
                ? "Only the person who made this deck can change it"
                : editing
                  ? "Wait for this change to finish…"
                  : canArrange
                    ? "Describe how to arrange it…"
                    : "Ask for a change…"
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
        {deckInfo && <DeckInfoBar {...deckInfo} redesigned={redesigned} />}
        {deckNotice && (
          <p className="shrink-0 border-b border-white/[0.06] px-4 py-1.5 text-[11px] text-gold sm:px-5" role="status">
            {deckNotice}
          </p>
        )}
        <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden lg:flex-row">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <DeckEditor key={designKey} initial={design} pieces={pieces} onSave={saveDesign} latestRef={latestDesign} />
          </div>

          {/*
            A redesigned PowerPoint keeps the person's own words: its chat arranges
            rather than edits, and one redesigned before its slides were kept has none.
          */}
          {(!redesigned || canArrange) && (
            <>
              {/* Desktop: the chat is a column beside the deck. */}
              <aside className="hidden w-[320px] shrink-0 flex-col border-l border-white/[0.06] bg-surface-raised/40 lg:flex">
                <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2.5">
                  <Sparkles size={13} className="text-gold" />
                  <p className="text-[12px] font-semibold text-cream">{chatTitle}</p>
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
                  <span className="flex-1 text-[12px] font-semibold text-cream">{chatTitle}</span>
                  {editing && <Loader2 size={13} className="animate-spin text-faint" />}
                  <span className="text-[11px] text-faint">{chatOpen ? "Hide" : messages.length ? `${messages.length} messages` : "Open"}</span>
                </button>
                {chatOpen && chat}
              </div>
            </>
          )}

          {printing && <PrintDeck design={printing} pieces={pieces} onDone={endPrint} />}
        </div>
      </div>
    );
  }

  // ── Being redesigned ───────────────────────────────────────────────────────
  // In this tab and quick, but still its own page from the moment it starts.
  if (redesignStatus && deckFile) {
    return (
      <BuildingView
        job={null}
        missing={false}
        title="Redesigning your PowerPoint"
        statusText={redesignStatus}
        note="Every word and every picture is kept exactly as it is in your file. This takes a few seconds; keep this page open until your deck appears."
        brief=""
        sourceNames={[deckFile.name]}
        pictures={[]}
        styleLabel="Redesign, every word kept"
        onStartOver={reset}
      />
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
                  internationally presentable deck, then you can change anything by chatting with it. Upload a PowerPoint and its own
                  slides can be redesigned instead, with every word kept exactly.
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
              {shownNotice && <p className="text-[11px] text-faint">{shownNotice}</p>}

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
                        {/* The count is what a written deck may use; a redesign keeps every picture, so it's left out there. */}
                        {source.imageCount && !(redesignMode && source.name === deckFile?.name)
                          ? ` · ${source.imageCount} pic${source.imageCount === 1 ? "" : "s"}`
                          : ""}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setSources((list) => list.filter((_, i) => i !== index));
                          if (deckFile && source.name === deckFile.name) setDeckFile(null);
                        }}
                        aria-label={`Remove ${source.name}`}
                        className="shrink-0 rounded-full p-0.5 text-faint transition-colors hover:text-error"
                      >
                        <X size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {/* A redesign uses every picture in the deck, where they were: nothing to pick from here. */}
              {images.length > 0 && !redesignMode && (
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

            {deckFile && (
              <section className="space-y-2">
                <p className="text-[12px] font-semibold text-cream">
                  What should happen to <span className="text-gold">{deckFile.name}</span>?
                </p>
                <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="What to do with the PowerPoint">
                  <ModeOption
                    active={mode === "redesign"}
                    onClick={() => setMode("redesign")}
                    icon={LayoutTemplate}
                    title="Redesign my slides"
                    text="Every word stays exactly as written and every picture is kept. Only the design changes."
                  />
                  <ModeOption
                    active={mode === "write"}
                    onClick={() => setMode("write")}
                    icon={PenLine}
                    title="Write a new presentation"
                    text="AI writes a fresh deck from your files, in its own words."
                  />
                </div>
                {redesignMode && hasOtherFiles && (
                  <p className="text-[11px] text-faint">
                    Only {deckFile.name} is redesigned. Your other files are used when writing a new presentation.
                  </p>
                )}
              </section>
            )}

            {redesignMode && (
              <section className="space-y-2">
                <label htmlFor="redesign-brief" className="text-[12px] font-semibold text-cream">
                  How should it be redesigned? <span className="font-normal text-faint">(optional)</span>
                </label>
                <textarea
                  id="redesign-brief"
                  value={brief}
                  onChange={(event) => setBrief(event.target.value)}
                  rows={5}
                  placeholder={REDESIGN_PLACEHOLDER}
                  className="w-full resize-y rounded-xl border border-white/10 bg-surface-raised px-3 py-2.5 text-base leading-relaxed text-cream outline-none placeholder:text-faint focus:border-gold/40 md:text-[13px]"
                />
                <p className="text-[11px] leading-relaxed text-faint">
                  Say which slides are concept slides, what the pictures are for, the colours or the mood. This only decides the arrangement:
                  the words on your slides never change.
                </p>
              </section>
            )}

            {!redesignMode && (
              <>
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
              </>
            )}

            {redesignMode ? (
              <RunButton
                onClick={handleRedesign}
                disabled={reading}
                icon={reading ? <Loader2 size={14} className="animate-spin" /> : <LayoutTemplate size={14} />}
              >
                {reading ? "Reading your files…" : brief.trim() ? "Redesign as described" : "Redesign the PowerPoint"}
              </RunButton>
            ) : (
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
            )}
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
  title = "Building your presentation",
  statusText,
  note = "You can leave this page. It keeps building in your queue, and opens right here when it's ready.",
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
  title?: string;
  /** Said instead of the job's own status, for work with no job behind it (a redesign). */
  statusText?: string;
  note?: string;
}) {
  const active = Boolean(job && (job.status === "queued" || job.status === "running"));
  const now = useNow(active);
  const status = statusText ?? (job ? describeJob(job, now).label : "Starting…");
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
              <h1 className="text-lg font-semibold text-cream">{title}</h1>
              <p className="mt-0.5 text-[12px] text-muted" role="status">
                {status}
              </p>
            </div>
          </div>
          {job && <JobProgressBar percent={job.progress} />}
          <p className="text-[11.5px] leading-relaxed text-faint">{note}</p>
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
function DeckInfoBar({
  createdAt,
  userName,
  isOwn,
  redesigned,
}: {
  createdAt: string;
  userName?: string;
  isOwn: boolean;
  redesigned?: boolean;
}) {
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
      {redesigned && (
        <>
          <span aria-hidden>·</span>
          <span>Redesigned from a PowerPoint, every word kept</span>
        </>
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

/** One of the two things an uploaded PowerPoint can become, as a choice. */
function ModeOption({
  active,
  onClick,
  icon: Icon,
  title,
  text,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Download;
  title: string;
  text: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors",
        active ? "border-gold/50 bg-gold/[0.07]" : "border-white/10 bg-surface-raised/50 hover:border-white/20"
      )}
    >
      <Icon size={15} className={cn("mt-0.5 shrink-0", active ? "text-gold" : "text-faint")} />
      <span className="min-w-0">
        <span className="block text-[12.5px] font-semibold text-cream">{title}</span>
        <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">{text}</span>
      </span>
    </button>
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
