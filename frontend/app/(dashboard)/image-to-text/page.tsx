"use client";

import { useEffect, useRef, useState } from "react";
import { ErrorBanner, RunButton } from "@/components/studio/ToolChrome";
import Image from "next/image";
import { Check, Copy, Loader2, ScanText, Upload, X } from "lucide-react";
import { JobProgressBar } from "@/components/studio/JobProgressBar";
import { ToolHeader } from "@/components/studio/ToolHeader";
import { imageToText } from "@/lib/api";
import { compressImage, makeThumbnail } from "@/lib/image";
import { useJobs } from "@/lib/jobs-context";
import { failureMessage, useSettledJob } from "@/lib/useSettledJob";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/permissions";
import { ToolAccessNotice } from "@/components/studio/ToolAccessNotice";
import { cn } from "@/lib/utils";

const PERMISSION = "tool.image_to_text.run";

/**
 * Image to Text: a photograph read back as the prompt that would recreate it.
 *
 * The one tool here with no refine loop, so it doesn't use the shared
 * generate-then-refine workspace — the answer is a description, and a
 * follow-up would be a fresh reading of the same photo rather than an edit
 * of the last one. What it does share is the queue: the run is followed
 * through `useJobs`, so closing the tab doesn't lose the answer.
 */
export default function ImageToTextPage() {
  const { user } = useAuth();
  const { jobs, track } = useJobs();

  const [photo, setPhoto] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState<"idle" | "reading" | "done" | "failed">("idle");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);

  const fileInput = useRef<HTMLInputElement>(null);
  /**
   * The run this page is following. State rather than a ref because the
   * progress bar renders from it — a ref write would not re-render, so the
   * bar would lag a tick behind the job it is measuring.
   */
  const [jobId, setJobId] = useState<string | null>(null);

  const job = jobId ? (jobs.find((entry) => entry.id === jobId) ?? null) : null;

  /** Settles the run once the queue reports it finished. */
  useSettledJob(job, (settled) => {
    setJobId(null);

    const text = settled.status === "completed" ? (settled.result?.text ?? "") : "";
    if (text) {
      setPrompt(text);
      setStatus("done");
      return;
    }

    setStatus("failed");
    setError(
      settled.status === "completed"
        ? "The model returned no description"
        : failureMessage(settled, "Could not read that photo")
    );
  });

  // Resets itself after a moment so the button can be used again without
  // the tick getting stuck on.
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  if (!can(user, PERMISSION)) {
    return <ToolAccessNotice tool="Image to Text" />;
  }

  async function accept(file: File | undefined) {
    if (!file) return;
    try {
      setPhoto(await compressImage(file));
      setPrompt("");
      setStatus("idle");
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that file");
    }
  }

  async function handleRead() {
    if (!photo) return;
    setError("");
    setPrompt("");
    setStatus("reading");

    const preview = await makeThumbnail(photo);
    const res = await imageToText({ image: photo, preview });

    if (res.status === "queued" && res.job) {
      setJobId(res.job.id);
      track(res.job);
    } else {
      setStatus("failed");
      setError(res.message || "Could not queue this analysis");
    }
  }

  function reset() {
    setPhoto(null);
    setPrompt("");
    setStatus("idle");
    setError("");
    setJobId(null);
  }

  const reading = status === "reading";

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      {status !== "idle" && <ToolHeader onReset={reset} resetLabel="New photo" />}
      <ErrorBanner message={error} />

      <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8">
        <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                accept(event.target.files?.[0]);
                event.target.value = "";
              }}
            />

            {photo ? (
              <div className="relative overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
                <div className="relative aspect-[4/3] w-full">
                  <Image src={photo} alt="Photo to describe" fill sizes="(max-width: 1024px) 100vw, 480px" className="object-contain" />
                </div>
                <button
                  type="button"
                  onClick={() => setPhoto(null)}
                  aria-label="Remove photo"
                  className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white/85 backdrop-blur-sm transition-colors hover:bg-black/75"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  accept(event.dataTransfer.files?.[0]);
                }}
                className={cn(
                  "flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-12 transition-colors",
                  dragging ? "border-gold/40 bg-gold/[0.06]" : "border-white/[0.12] bg-white/[0.02] hover:border-white/25"
                )}
              >
                <Upload size={20} className="text-faint" />
                <p className="text-sm font-medium text-cream">Drop a photo here, or click to choose</p>
                <p className="text-[11px] text-faint">
                  It is read as a gemologist would — stone counts, settings, metal, lighting.
                </p>
              </button>
            )}

            <RunButton
              onClick={handleRead}
              disabled={!photo || reading}
              icon={reading ? <Loader2 size={14} className="animate-spin" /> : <ScanText size={14} />}
            >
              {reading ? "Reading the photo…" : "Describe this piece"}
            </RunButton>

            {reading && job && (
              <div className="space-y-1.5">
                <JobProgressBar percent={job.progress} />
                <p className="text-[11px] text-faint">{job.phase === "saving" ? "Saving…" : "Reading the photo…"}</p>
              </div>
            )}
          </div>

          <div className="flex min-h-64 flex-col rounded-xl border border-white/[0.08] bg-surface-raised">
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/[0.06] px-3 py-2">
              <p className="text-[10px] font-medium uppercase tracking-widest text-faint">Generation prompt</p>
              {prompt && (
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(prompt);
                    setCopied(true);
                  }}
                  className="flex items-center gap-1.5 rounded-lg border border-white/[0.07] px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:border-white/[0.14] hover:text-cream"
                >
                  {copied ? <Check size={11} /> : <Copy size={11} />}
                  {copied ? "Copied" : "Copy"}
                </button>
              )}
            </div>

            {/* Editable on purpose: this is a prompt to paste into another
                tool, and the first thing anyone does with one is adjust it. */}
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              readOnly={reading}
              placeholder={reading ? "Reading…" : "The description will appear here."}
              className="min-h-64 flex-1 resize-none bg-transparent px-3 py-3 text-[13px] leading-relaxed text-cream placeholder:text-faint focus:outline-none"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
