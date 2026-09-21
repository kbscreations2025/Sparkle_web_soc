"use client";

import { useRef, useState } from "react";
import { ErrorBanner, RunButton } from "@/components/studio/ToolChrome";
import Image from "next/image";
import { Download, Film, Loader2, Upload, X } from "lucide-react";
import { JobProgressBar } from "@/components/studio/JobProgressBar";
import { AspectChips } from "@/components/studio/AspectChips";
import { OptionChips } from "@/components/studio/OptionChips";
import { PromptCard } from "@/components/studio/PromptCard";
import { ToolHeader } from "@/components/studio/ToolHeader";
import {
  imageToVideo,
  DEFAULT_VIDEO_DURATION,
  DEFAULT_VIDEO_MODEL,
  VIDEO_ASPECTS,
  VIDEO_CAMERA_STYLES,
  VIDEO_DURATIONS,
  VIDEO_MODELS,
  VIDEO_MOOD_STYLES,
  VIDEO_RESOLUTIONS,
  type VideoModelId,
} from "@/lib/api";
import { compressImage, makeThumbnail } from "@/lib/image";
import { useJobs } from "@/lib/jobs-context";
import { failureMessage, useSettledJob } from "@/lib/useSettledJob";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/permissions";
import { ToolAccessNotice } from "@/components/studio/ToolAccessNotice";
import { cn } from "@/lib/utils";

const PERMISSION = "tool.image_to_video.run";

/**
 * Image to Video: one still, animated.
 *
 * No refine loop — a clip can't be edited by asking, only regenerated — so
 * this doesn't use the shared generate-then-refine workspace. What matters
 * most here is that the wait is minutes rather than seconds, which is
 * exactly why the run is followed through the queue: this page can be
 * closed and the clip will still be waiting.
 */
export default function ImageToVideoPage() {
  const { user } = useAuth();
  const { jobs, track } = useJobs();

  const [photo, setPhoto] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [camera, setCamera] = useState<string>(VIDEO_CAMERA_STYLES[0].id);
  const [mood, setMood] = useState<string>(VIDEO_MOOD_STYLES[0].id);
  const [model, setModel] = useState<VideoModelId>(DEFAULT_VIDEO_MODEL);
  const [aspectRatio, setAspectRatio] = useState<string>(VIDEO_ASPECTS[0].id);
  const [resolution, setResolution] = useState<string>(VIDEO_RESOLUTIONS[0].id);
  const [durationSeconds, setDurationSeconds] = useState<number>(DEFAULT_VIDEO_DURATION);
  const [status, setStatus] = useState<"idle" | "rendering" | "done" | "failed">("idle");
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);

  const fileInput = useRef<HTMLInputElement>(null);
  /**
   * The run this page is following. State rather than a ref because the
   * progress bar renders from it — a ref write would not re-render, so the
   * bar would lag a tick behind the job it is measuring.
   */
  const [jobId, setJobId] = useState<string | null>(null);

  const job = jobId ? (jobs.find((entry) => entry.id === jobId) ?? null) : null;

  useSettledJob(job, (settled) => {
    setJobId(null);

    const url = settled.status === "completed" ? (settled.result?.outputUrl ?? null) : null;
    if (url) {
      setVideoUrl(url);
      setStatus("done");
      return;
    }

    setStatus("failed");
    setError(
      settled.status === "completed"
        ? "The model returned no video"
        : failureMessage(settled, "Could not render that clip")
    );
  });

  if (!can(user, PERMISSION)) {
    return <ToolAccessNotice tool="Image to Video" />;
  }

  async function accept(file: File | undefined) {
    if (!file) return;
    try {
      setPhoto(await compressImage(file));
      setVideoUrl(null);
      setStatus("idle");
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that file");
    }
  }

  async function handleRender() {
    if (!photo) return;
    setError("");
    setVideoUrl(null);
    setStatus("rendering");

    const preview = await makeThumbnail(photo);
    const res = await imageToVideo({
      image: photo,
      description,
      model,
      camera,
      mood,
      aspectRatio,
      resolution,
      durationSeconds,
      preview,
    });

    if (res.status === "queued" && res.job) {
      setJobId(res.job.id);
      track(res.job);
    } else {
      setStatus("failed");
      setError(res.message || "Could not queue this clip");
    }
  }

  function reset() {
    setPhoto(null);
    setVideoUrl(null);
    setStatus("idle");
    setError("");
    setJobId(null);
  }

  const rendering = status === "rendering";

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      {status !== "idle" && <ToolHeader onReset={reset} resetLabel="New clip" />}
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
                  <Image src={photo} alt="Photo to animate" fill sizes="(max-width: 1024px) 100vw, 480px" className="object-contain" />
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
                <p className="text-[11px] text-faint">The piece is filmed, never redesigned — only the camera moves.</p>
              </button>
            )}

            <OptionChips label="Camera" options={VIDEO_CAMERA_STYLES} value={camera} onChange={setCamera} />
            <p className="-mt-1 text-[11px] text-faint">
              {VIDEO_CAMERA_STYLES.find((entry) => entry.id === camera)?.description}
            </p>

            <OptionChips label="Mood" options={VIDEO_MOOD_STYLES} value={mood} onChange={setMood} />
            <p className="-mt-1 text-[11px] text-faint">
              {VIDEO_MOOD_STYLES.find((entry) => entry.id === mood)?.description}
            </p>

          </div>

          <div className="space-y-4">
            <div className="space-y-4 rounded-xl border border-white/[0.08] bg-surface-raised p-4">
              <Setting label="Model">
                <select
                  value={model}
                  onChange={(event) => setModel(event.target.value as VideoModelId)}
                  className="min-h-8 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-xs text-cream focus:border-gold/30 focus:outline-none"
                >
                  {VIDEO_MODELS.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </Setting>

              <Setting label="Length">
                <select
                  value={durationSeconds}
                  onChange={(event) => setDurationSeconds(Number(event.target.value))}
                  className="min-h-8 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-xs text-cream focus:border-gold/30 focus:outline-none"
                >
                  {VIDEO_DURATIONS.map((seconds) => (
                    <option key={seconds} value={seconds}>
                      {seconds}s
                    </option>
                  ))}
                </select>
              </Setting>


              <Setting label="Resolution">
                <div className="flex gap-1.5">
                  {VIDEO_RESOLUTIONS.map((entry) => (
                    <SmallChip
                      key={entry.id}
                      label={entry.label}
                      active={entry.id === resolution}
                      onClick={() => setResolution(entry.id)}
                    />
                  ))}
                </div>
              </Setting>
            </div>

            {/* The same shape picker the image tools use, out of the
                settings card and on its own: a ratio is chosen by its
                outline, which a pair of text chips in a row cannot show. */}
            <AspectChips options={VIDEO_ASPECTS} value={aspectRatio} onChange={setAspectRatio} />

            {/* No footer: this page's settings are in the card above, not
                on the box. */}
            <PromptCard
              label="Anything else"
              value={description}
              onChange={setDescription}
              placeholder="Optional — extra direction for the motion"
            />

            <RunButton
              onClick={handleRender}
              disabled={!photo || rendering}
              icon={rendering ? <Loader2 size={14} className="animate-spin" /> : <Film size={14} />}
            >
              {rendering ? "Rendering…" : `Animate this photo · ${durationSeconds}s`}
            </RunButton>

            {rendering && job && (
              <div className="space-y-1.5 rounded-xl border border-white/[0.08] bg-surface-raised p-3">
                <JobProgressBar percent={job.progress} />
                <p className="text-[11px] text-faint">
                  {job.phase === "saving" ? "Saving the clip…" : "Rendering — this takes a few minutes."} You can leave
                  this page; it will be in your queue and your history when it&apos;s done.
                </p>
              </div>
            )}

            {videoUrl && (
              <div className="space-y-2 overflow-hidden rounded-xl border border-white/10 bg-black/40">
                {/* Controls, not autoplay: this is a deliverable to inspect,
                    and a loop that starts on its own is the wrong default for
                    something the user is about to download. */}
                <video src={videoUrl} controls playsInline className="w-full" />
                <div className="flex justify-end px-3 pb-3">
                  <a
                    href={videoUrl}
                    download="jewellery.mp4"
                    className="flex items-center gap-1.5 rounded-lg border border-white/[0.07] px-2.5 py-1.5 text-[11px] font-medium text-muted transition-colors hover:border-white/[0.14] hover:text-cream"
                  >
                    <Download size={12} /> Download
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Setting({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-[10px] font-medium uppercase tracking-widest text-faint">{label}</span>
      {children}
    </div>
  );
}

function SmallChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "min-h-8 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors",
        active
          ? "border-gold/30 bg-gold/10 text-gold"
          : "border-white/[0.07] bg-white/[0.03] text-muted hover:border-white/[0.14] hover:text-cream"
      )}
    >
      {label}
    </button>
  );
}
