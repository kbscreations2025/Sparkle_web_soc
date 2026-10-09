"use client";

import { Suspense, useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { ErrorBanner, RunButton } from "@/components/studio/ToolChrome";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { Check, FileText, Gem, ImagePlus, Loader2, Pencil, Plus, Save, X, type LucideIcon } from "lucide-react";
import { ToolHeader } from "@/components/studio/ToolHeader";
import { BrandStoryResult } from "@/components/studio/BrandStoryResult";
import { Chip } from "@/components/studio/OptionChips";
import type { UploadItem } from "@/components/studio/UploadZone";
import {
  brandStory,
  fetchMarketingKit,
  updateMarketingKit,
  type BrandStoryLength,
  type BrandStoryTone,
  type MarketingKit,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { makeThumbnail } from "@/lib/image";
import { filesToUploadItems, uploadErrorMessage } from "@/lib/uploads";
import { readSheetFiles, SHEET_FILE_ACCEPT } from "@/lib/sheetFiles";
import { useCreditGuard } from "@/lib/credit-guard";
import { useJobs } from "@/lib/jobs-context";
import { failureMessage, useSettledJob } from "@/lib/useSettledJob";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/permissions";
import { ToolAccessNotice } from "@/components/studio/ToolAccessNotice";

const PERMISSION = "tool.marketing_kit.run";

/** The voices on offer, with the line shown under the chips for the one picked. */
const TONES: { id: BrandStoryTone; label: string; description: string }[] = [
  { id: "classic", label: "Classic luxury", description: "Elegant, refined and timeless — the voice of a great maison." },
  { id: "romantic", label: "Romantic", description: "Warm and emotive — love, devotion, a future heirloom." },
  { id: "modern", label: "Modern", description: "Clean, confident and understated — contemporary luxury." },
  { id: "poetic", label: "Poetic", description: "Lyrical and rich in imagery, like an art-book essay." },
  { id: "bold", label: "Bold & glamorous", description: "A statement voice with red-carpet energy." },
  { id: "heritage", label: "Heritage craft", description: "The artisan's hand, technique and tradition." },
];

const LENGTHS: { id: BrandStoryLength; label: string; words: string }[] = [
  { id: "short", label: "Short", words: "~100 words" },
  { id: "medium", label: "Medium", words: "~200 words" },
  { id: "long", label: "Long", words: "~400 words" },
];

export default function BrandStoryPage() {
  // `useSearchParams` suspends, and a kit link arrives as `?kitId=` — without
  // a boundary the whole route falls back to client rendering.
  return (
    <Suspense fallback={<div className="flex-1 px-8 py-8 text-sm text-muted">Loading…</div>}>
      <BrandStoryWorkspace />
    </Suspense>
  );
}

/**
 * Brand Story: several photos of one piece, read as a design narrative.
 *
 * The narrative is a document, not a result — it is saved as a kit, reopened
 * from the rail and edited in place. What the model first wrote is kept
 * separately and never overwritten, so an edited kit can still show which
 * words are whose.
 */
function BrandStoryWorkspace() {
  const { user } = useAuth();
  const { jobs, track } = useJobs();
  const creditGuard = useCreditGuard();
  const searchParams = useSearchParams();
  const openKitId = searchParams.get("kitId");

  const [photos, setPhotos] = useState<UploadItem[]>([]);
  const [sheetImages, setSheetImages] = useState<string[]>([]);
  const [tone, setTone] = useState<BrandStoryTone>("classic");
  const [length, setLength] = useState<BrandStoryLength>("medium");
  const [kit, setKit] = useState<MarketingKit | null>(null);
  const [analysis, setAnalysis] = useState("");
  const [status, setStatus] = useState<"idle" | "writing" | "done" | "failed">("idle");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  /** Whether the raw text is showing instead of the laid-out narrative. */
  const [editing, setEditing] = useState(false);

  /**
   * The run this page is following. State rather than a ref because the
   * progress bar renders from it — a ref write would not re-render, so the
   * bar would lag a tick behind the job it is measuring.
   */
  const [jobId, setJobId] = useState<string | null>(null);

  const job = jobId ? (jobs.find((entry) => entry.id === jobId) ?? null) : null;

  /**
   * The kit a finished run wrote, so an edit has a document to save back to.
   * Held as state and fetched below rather than at the moment the run
   * settles: settling happens during render, where a network call has no
   * business.
   */
  const [resultKitId, setResultKitId] = useState<string | null>(null);

  /**
   * Loads the document being worked on — a kit reopened from the rail
   * (`?kitId=`), or the one a run just wrote.
   *
   * A reopened kit also restores the narrative, since there is nothing else
   * on the page to restore it from; a freshly written one leaves the text
   * alone, because it is already on screen.
   */
  const loadKitId = openKitId ?? resultKitId;

  useEffect(() => {
    if (!loadKitId) return;
    let cancelled = false;

    fetchMarketingKit(loadKitId).then((res) => {
      if (cancelled || res.status !== "success" || !res.kit) return;
      setKit(res.kit);
      if (loadKitId === openKitId) {
        setAnalysis(res.kit.brandStory?.analysis ?? "");
        setStatus("done");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [loadKitId, openKitId]);

  useSettledJob(job, (settled) => {
    setJobId(null);

    if (settled.status !== "completed") {
      setStatus("failed");
      setError(failureMessage(settled, "Could not write that narrative"));
      return;
    }

    const text = settled.result?.text ?? "";
    setAnalysis(text);
    setStatus(text ? "done" : "failed");
    if (!text) setError("The model returned no narrative");
    if (settled.result?.kitId) setResultKitId(settled.result.kitId);
  });

  const save = useCallback(async () => {
    if (!kit) return;
    setSaving("saving");
    const res = await updateMarketingKit(kit.id, { analysis });
    setSaving(res.status === "success" ? "saved" : "idle");
    if (res.status !== "success") setError(res.message || "Could not save that edit");
  }, [kit, analysis]);

  useEffect(() => {
    if (saving !== "saved") return;
    const timer = setTimeout(() => setSaving("idle"), 1800);
    return () => clearTimeout(timer);
  }, [saving]);

  if (!can(user, PERMISSION)) {
    return <ToolAccessNotice tool="Marketing Kit" />;
  }

  /** One photo of the piece: a new one replaces whatever was there. */
  async function addPhoto(file: File | undefined) {
    if (!file) return;
    try {
      const [added] = await filesToUploadItems([file]);
      if (added) setPhotos([added]);
    } catch (err) {
      setError(uploadErrorMessage(err));
    }
  }

  /** A sheet may be a photo, a PDF or a workbook — all become page images here. */
  async function addSheets(files: File[]) {
    try {
      const { images } = await readSheetFiles(files);
      setSheetImages((current) => [...current, ...images]);
    } catch (err) {
      setError(uploadErrorMessage(err));
    }
  }

  async function handleWrite() {
    if (photos.length === 0) return;
    setError("");
    setStatus("writing");
    setAnalysis("");

    const preview = await makeThumbnail(photos[0].dataUrl);
    const res = await brandStory({ images: photos.map((item) => item.dataUrl), sheetImages, preview, tone, length });

    if (res.status === "queued" && res.job) {
      setJobId(res.job.id);
      track(res.job);
    } else if (creditGuard(res)) {
      setStatus("idle");
    } else {
      setStatus("failed");
      setError(res.message || "Could not queue this narrative");
    }
  }

  function reset() {
    setPhotos([]);
    setSheetImages([]);
    setKit(null);
    setAnalysis("");
    setStatus("idle");
    setError("");
    setJobId(null);
    setEditing(false);
  }

  const writing = status === "writing";
  const edited = Boolean(kit && analysis !== kit.brandStory?.analysis);

  /**
   * The photos to set the narrative beside — the ones just uploaded, or the
   * stored copies when a saved kit was reopened and there is nothing on the
   * page to have uploaded.
   */
  const storyImages = photos.length
    ? photos.map((item) => ({ url: item.dataUrl }))
    : (kit?.brandStory?.images.map((image) => ({ url: image.url, thumbnailUrl: image.thumbnailUrl })) ?? []);

  /*
   * A finished narrative gets the whole width and the editorial layout —
   * this is the deliverable, and reading it in a textarea beside the upload
   * form is reading a manuscript through a letterbox.
   *
   * Editing is still a click away rather than gone: a kit is a working
   * document, and the raw text is where a person adjusts the model's words.
   *
   * The same page opens the moment a run starts, not when it ends: the photo
   * is already known, so it goes in straight away, and the text side waits
   * with placeholder lines and the run's progress until the words arrive.
   * A run that fails drops back to the form, with the reason in the banner.
   */
  if (writing || (status === "done" && analysis)) {
    return (
      <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
        <ToolHeader onReset={reset} resetLabel="New story" />
        <ErrorBanner message={error} />

        <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8">
          {/* Capped so the narrative's lines stay a readable length on a
              wide screen — at full width they ran past 120 characters. */}
          <div className="mx-auto max-w-5xl space-y-3">
            {/* Nothing to edit or save until there is text. */}
            <div className={cn("flex items-center justify-end gap-2", writing && "invisible")}>
              <button
                type="button"
                onClick={() => setEditing((open) => !open)}
                className="flex min-h-8 items-center gap-1.5 rounded-lg border border-white/[0.07] px-2.5 py-1.5 text-[11px] font-medium text-muted transition-colors hover:border-white/[0.14] hover:text-cream"
              >
                {editing ? <FileText size={11} /> : <Pencil size={11} />}
                {editing ? "Done editing" : "Edit text"}
              </button>

              {kit && (
                <button
                  type="button"
                  onClick={save}
                  disabled={!edited || saving === "saving"}
                  className="flex min-h-8 items-center gap-1.5 rounded-lg border border-white/[0.07] px-2.5 py-1.5 text-[11px] font-medium text-muted transition-colors hover:border-white/[0.14] hover:text-cream disabled:opacity-40"
                >
                  {saving === "saved" ? <Check size={11} /> : <Save size={11} />}
                  {saving === "saved" ? "Saved" : saving === "saving" ? "Saving…" : "Save"}
                </button>
              )}
            </div>

            {writing ? (
              <BrandStoryResult images={storyImages} pending={{ percent: job?.progress ?? null }} />
            ) : editing ? (
              <textarea
                value={analysis}
                onChange={(event) => setAnalysis(event.target.value)}
                className="min-h-[60vh] w-full resize-none rounded-xl border border-white/[0.08] bg-surface-raised px-4 py-3 text-[13px] leading-relaxed text-cream focus:border-gold/30 focus:outline-none"
              />
            ) : (
              <BrandStoryResult text={analysis} images={storyImages} />
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      {status !== "idle" && <ToolHeader onReset={reset} resetLabel="New story" />}
      <ErrorBanner message={error} />

      <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8">
        {/* One column: this screen is only the inputs now. The narrative
            has its own full-width layout once a run lands, so there is
            nothing to sit beside the form while it is being filled in. */}
        <div className="mx-auto max-w-2xl">
          <div className="space-y-6">
            {/* The two things this run reads, side by side as equal squares:
                what the piece looks like, and — optionally — what it was
                meant to be. Each says what goes in it, so the empty page
                explains itself. */}
            <div className="flex flex-wrap gap-3">
              <UploadSquare
                icon={ImagePlus}
                title="Photo of the piece"
                hint="One clear photo"
                formats="JPG or PNG"
                accept="image/*"
                single
                thumbs={photos.map((item) => ({ key: item.id, src: item.dataUrl, label: item.name }))}
                onFiles={(files) => addPhoto(files.find((file) => file.type.startsWith("image/")))}
                onRemove={() => setPhotos([])}
              />
              <UploadSquare
                icon={FileText}
                title="Production sheet"
                optional
                hint="Sketch or tech sheet — guides the story"
                accept={SHEET_FILE_ACCEPT}
                thumbs={sheetImages.map((src, index) => ({ key: `${index}-${src.slice(-24)}`, src, label: `Sheet page ${index + 1}` }))}
                onFiles={addSheets}
                onRemove={(index) => setSheetImages((current) => current.filter((_, at) => at !== index))}
                formats="Image, PDF, sheet"
              />
            </div>

            <section className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-cream">Tone</h2>
              <div className="flex flex-wrap gap-1.5">
                {TONES.map((option) => (
                  <Chip key={option.id} label={option.label} active={tone === option.id} onClick={() => setTone(option.id)} />
                ))}
              </div>
              <p className="text-[11px] text-faint">{TONES.find((option) => option.id === tone)?.description}</p>
            </section>

            <section className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-cream">Length</h2>
              {/* Segmented rather than chips: three steps along one scale,
                  and the word count under each says what the step means. */}
              <div className="grid grid-cols-3 overflow-hidden rounded-lg border border-white/[0.08]">
                {LENGTHS.map((option, index) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setLength(option.id)}
                    aria-pressed={length === option.id}
                    className={cn(
                      "flex flex-col items-center gap-0.5 px-2 py-2 text-xs transition-colors",
                      index > 0 && "border-l border-white/[0.08]",
                      length === option.id ? "bg-gold/10 text-gold" : "text-muted hover:bg-white/[0.04] hover:text-cream"
                    )}
                  >
                    <span className="font-medium">{option.label}</span>
                    <span className={cn("text-[10px]", length === option.id ? "text-gold/80" : "text-faint")}>
                      {option.words}
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <RunButton
              onClick={handleWrite}
              disabled={photos.length === 0 || writing}
              icon={writing ? <Loader2 size={14} className="animate-spin" /> : <Gem size={14} />}
            >
              {writing ? "Writing the narrative…" : "Write the brand story"}
            </RunButton>
            {/* Says why the button is off, rather than leaving a faded button
                to be clicked at and wondered about. */}
            {photos.length === 0 && !writing && (
              <p className="-mt-3 text-center text-[11px] text-faint">Add a photo of the piece to write its story.</p>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

/**
 * One square upload target: empty, it says what belongs in it; filled, it
 * shows what was added as small tiles inside the same square, with a "+" to
 * add more. Click or drop, either way.
 *
 * Square and equal to its neighbour so the two inputs read as a pair at a
 * glance — the photos the story is about, and the optional sheet behind it.
 */
function UploadSquare({
  icon: Icon,
  title,
  hint,
  optional = false,
  single = false,
  formats,
  accept,
  thumbs,
  onFiles,
  onRemove,
}: {
  icon: LucideIcon;
  title: string;
  hint: string;
  optional?: boolean;
  /**
   * Takes one file: the picker allows only one, and once filled the square
   * is that picture, edge to edge, with Replace and remove on it.
   */
  single?: boolean;
  /** Which files it takes, said in the empty square. */
  formats: string;
  accept: string;
  thumbs: { key: string; src: string; label: string }[];
  onFiles: (files: File[]) => void;
  onRemove: (index: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const filled = thumbs.length > 0;

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    const files = [...event.dataTransfer.files];
    if (files.length) onFiles(files);
  }

  return (
    <div
      onDrop={handleDrop}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      className={cn(
        "relative flex h-40 w-40 shrink-0 flex-col overflow-hidden rounded-xl border transition-colors",
        dragging
          ? "border-gold/50 bg-gold/[0.06]"
          : filled
            ? "border-white/[0.1] bg-surface-raised"
            : "border-dashed border-white/15 hover:border-gold/30 hover:bg-white/[0.03]"
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={!single}
        hidden
        onChange={(event) => {
          onFiles([...(event.target.files ?? [])]);
          // Cleared so picking the same file twice still fires onChange.
          event.target.value = "";
        }}
      />

      {filled && single ? (
        <div className="group relative flex-1">
          <Image src={thumbs[0].src} alt={thumbs[0].label} fill sizes="160px" className="object-cover" />
          <div className="absolute inset-x-1.5 bottom-1.5 flex items-center justify-between gap-1">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="rounded-md bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white/90 backdrop-blur-sm transition-colors hover:bg-black/75"
            >
              Replace
            </button>
            <button
              type="button"
              onClick={() => onRemove(0)}
              title={`Remove ${thumbs[0].label}`}
              aria-label={`Remove ${thumbs[0].label}`}
              className="flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white/85 backdrop-blur-sm transition-colors hover:text-white"
            >
              <X size={10} />
            </button>
          </div>
        </div>
      ) : filled ? (
        <>
          <div className="flex shrink-0 items-center justify-between gap-2 px-3 pt-2.5">
            <p className="min-w-0 truncate text-[11px] font-medium text-cream">
              {title} <span className="text-faint">· {thumbs.length}</span>
            </p>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-gold/80 transition-colors hover:bg-gold/10 hover:text-gold"
            >
              <Plus size={11} /> Add
            </button>
          </div>
          <ul className="thin-scrollbar grid min-h-0 flex-1 auto-rows-min grid-cols-3 gap-1.5 overflow-y-auto p-3">
            {thumbs.map((thumb, index) => (
              <li
                key={thumb.key}
                className="group relative aspect-square overflow-hidden rounded-md border border-white/10 bg-surface-deep"
              >
                <Image src={thumb.src} alt={thumb.label} fill sizes="100px" className="object-cover" />
                <button
                  type="button"
                  onClick={() => onRemove(index)}
                  title={`Remove ${thumb.label}`}
                  aria-label={`Remove ${thumb.label}`}
                  className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white/85 opacity-0 transition-opacity hover:text-white focus:opacity-100 group-hover:opacity-100"
                >
                  <X size={10} />
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex flex-1 flex-col items-center justify-center gap-1.5 p-3 text-center"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.04]">
            <Icon size={15} className="text-gold/80" />
          </span>
          <span className="text-[12px] font-medium leading-tight text-cream">
            {title}
            {optional && <span className="block text-[10px] font-normal text-faint">optional</span>}
          </span>
          <span className="text-[10px] leading-snug text-faint">{hint}</span>
          <span className="text-[10px] font-medium leading-snug text-gold/70">Click or drop · {formats}</span>
        </button>
      )}
    </div>
  );
}
