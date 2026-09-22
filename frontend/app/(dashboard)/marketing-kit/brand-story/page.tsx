"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { ErrorBanner, RunButton } from "@/components/studio/ToolChrome";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { Check, FileText, Gem, Loader2, Paperclip, Pencil, Save } from "lucide-react";
import { JobProgressBar } from "@/components/studio/JobProgressBar";
import { ToolHeader } from "@/components/studio/ToolHeader";
import { BrandStoryResult } from "@/components/studio/BrandStoryResult";
import { UploadZone, type UploadItem } from "@/components/studio/UploadZone";
import { brandStory, fetchMarketingKit, updateMarketingKit, type MarketingKit } from "@/lib/api";
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
  const [kit, setKit] = useState<MarketingKit | null>(null);
  const [analysis, setAnalysis] = useState("");
  const [status, setStatus] = useState<"idle" | "writing" | "done" | "failed">("idle");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  /** Whether the raw text is showing instead of the laid-out narrative. */
  const [editing, setEditing] = useState(false);

  const sheetInput = useRef<HTMLInputElement>(null);
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

  async function addPhotos(files: File[]) {
    try {
      const added = await filesToUploadItems(files);
      setPhotos((current) => [...current, ...added]);
    } catch (err) {
      setError(uploadErrorMessage(err));
    }
  }

  /** A sheet may be a photo, a PDF or a workbook — all become page images here. */
  async function addSheets(files: File[]) {
    const { images } = await readSheetFiles(files);
    setSheetImages((current) => [...current, ...images]);
  }

  async function handleWrite() {
    if (photos.length === 0) return;
    setError("");
    setStatus("writing");
    setAnalysis("");

    const preview = await makeThumbnail(photos[0].dataUrl);
    const res = await brandStory({ images: photos.map((item) => item.dataUrl), sheetImages, preview });

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
   */
  if (status === "done" && analysis) {
    return (
      <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
        <ToolHeader onReset={reset} resetLabel="New story" />
        <ErrorBanner message={error} />

        <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8">
          <div className="mx-auto max-w-7xl space-y-3">
            <div className="flex items-center justify-end gap-2">
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

            {editing ? (
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
          <div className="space-y-5">
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-cream">
                The piece{" "}
                <span className="font-normal normal-case tracking-normal text-faint">— several angles is better</span>
              </h2>
              <UploadZone
                items={photos}
                onAdd={addPhotos}
                onRemove={(id) => setPhotos((current) => current.filter((item) => item.id !== id))}
              />
            </section>

            <section className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-cream">
                Production sheet <span className="font-normal normal-case tracking-normal text-faint">— optional</span>
              </h2>
              <p className="text-[11px] text-faint">
                Sketches, mood boards or a technical sheet. When one is attached it becomes the authority on the
                design&apos;s intent, and any printed setting code is resolved to its real terminology.
              </p>

              <input
                ref={sheetInput}
                type="file"
                accept={SHEET_FILE_ACCEPT}
                multiple
                hidden
                onChange={(event) => {
                  addSheets([...(event.target.files ?? [])]);
                  event.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => sheetInput.current?.click()}
                className="flex min-h-8 items-center gap-1.5 rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-white/[0.14] hover:text-cream"
              >
                <Paperclip size={12} /> Attach a sheet — image, PDF or spreadsheet
              </button>

              {sheetImages.length > 0 && (
                <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                  {sheetImages.map((src, index) => (
                    <li key={src.slice(-32)} className="relative aspect-square overflow-hidden rounded-lg border border-white/10">
                      <Image src={src} alt={`Sheet page ${index + 1}`} fill sizes="80px" className="object-cover" />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <RunButton
              onClick={handleWrite}
              disabled={photos.length === 0 || writing}
              icon={writing ? <Loader2 size={14} className="animate-spin" /> : <Gem size={14} />}
            >
              {writing ? "Writing the narrative…" : "Write the brand story"}
            </RunButton>

            {writing && job && <JobProgressBar percent={job.progress} />}
          </div>

        </div>
      </div>
    </div>
  );
}
