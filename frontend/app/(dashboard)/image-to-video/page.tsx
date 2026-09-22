"use client";

import { useRef, useState } from "react";
import { ErrorBanner, RunButton } from "@/components/studio/ToolChrome";
import Image from "next/image";
import { Download, Film, Loader2, Plus, Upload, X } from "lucide-react";
import { JobProgressBar } from "@/components/studio/JobProgressBar";
import { AspectChips } from "@/components/studio/AspectChips";
import { OptionChips } from "@/components/studio/OptionChips";
import { PromptCard } from "@/components/studio/PromptCard";
import { ToolHeader } from "@/components/studio/ToolHeader";
import {
  imageToVideo,
  MAX_VIDEO_VIEWS,
  VIDEO_REFERENCE_VIEWS,
  VIDEO_REFERENCE_MODE,
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
import { compressImage, downloadImage, downloadName, makeThumbnail } from "@/lib/image";
import { useJobs } from "@/lib/jobs-context";
import { failureMessage, useSettledJob } from "@/lib/useSettledJob";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/permissions";
import { ToolAccessNotice } from "@/components/studio/ToolAccessNotice";
import { cn } from "@/lib/utils";

const PERMISSION = "tool.image_to_video.run";

/**
 * Image to Video: a piece, animated — from one view of it or up to three.
 *
 * The extra views are not extra clips. They are the same object photographed
 * from different angles, handed to Veo as references so that when the camera
 * swings behind the piece it films the real back rather than an invented one.
 * The cost is stated on the page, because it is not obvious: with more than
 * one view there is no pinned opening frame.
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

  /** Views of one piece, in upload order — the first is the primary view. */
  const [photos, setPhotos] = useState<string[]>([]);
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

  /**
   * Adds views up to the cap. Files past it are ignored with a note rather
   * than silently dropped — a user who picked five angles should be told
   * which two the clip won't see.
   */
  async function accept(files: FileList | File[] | null | undefined) {
    const picked = Array.from(files ?? []);
    if (!picked.length) return;

    const room = MAX_VIDEO_VIEWS - photos.length;
    if (room <= 0) {
      setError(`A clip can be built from at most ${MAX_VIDEO_VIEWS} views — remove one to add another.`);
      return;
    }

    try {
      const added = await Promise.all(picked.slice(0, room).map(compressImage));
      setPhotos((current) => [...current, ...added]);
      setVideoUrl(null);
      setStatus("idle");
      setError(
        picked.length > room
          ? `Added ${room} more — a clip can be built from at most ${MAX_VIDEO_VIEWS} views.`
          : ""
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that file");
    }
  }

  function removeView(index: number) {
    setPhotos((current) => current.filter((_, at) => at !== index));
  }

  async function handleRender() {
    if (!photos.length) return;
    setError("");
    setVideoUrl(null);
    setStatus("rendering");

    const preview = await makeThumbnail(photos[0]);
    const res = await imageToVideo({
      images: photos,
      description,
      camera,
      mood,
      preview,
      // Multi-view runs send the locked combination, matching what the
      // settings card is showing and what the backend will enforce anyway.
      ...(photos.length > 1
        ? VIDEO_REFERENCE_MODE
        : { model, aspectRatio, resolution, durationSeconds }),
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
    setPhotos([]);
    setVideoUrl(null);
    setStatus("idle");
    setError("");
    setJobId(null);
  }

  const rendering = status === "rendering";
  const multiView = photos.length > 1;
  const canAddView = photos.length < MAX_VIDEO_VIEWS;

  /*
   * With more than one view the settings are not the user's to choose —
   * reference mode accepts exactly one combination. They are shown as the
   * locked values rather than left displaying picks the run would ignore.
   */
  const effective = multiView
    ? VIDEO_REFERENCE_MODE
    : { model, aspectRatio, resolution, durationSeconds };

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
              multiple
              hidden
              onChange={(event) => {
                accept(event.target.files);
                event.target.value = "";
              }}
            />

            {photos.length === 0 ? (
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
                  accept(event.dataTransfer.files);
                }}
                className={cn(
                  "flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-12 transition-colors",
                  dragging ? "border-gold/40 bg-gold/[0.06]" : "border-white/[0.12] bg-white/[0.02] hover:border-white/25"
                )}
              >
                <Upload size={20} className="text-faint" />
                <p className="text-sm font-medium text-cream">Drop photos here, or click to choose</p>
                <p className="text-[11px] text-faint">
                  Up to {MAX_VIDEO_VIEWS} views of the same piece — front, side, back, gallery, underside. The piece is
                  filmed, never redesigned.
                </p>
              </button>
            ) : (
              <div className="space-y-2">
                {/* The primary view stays large: at one view it is the opening
                    frame, and at several it is still the angle the piece is
                    recognised by. The others sit under it as a strip. */}
                <div className="relative overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
                  <div className="relative aspect-[4/3] w-full">
                    <Image
                      src={photos[0]}
                      alt="Primary view of the piece"
                      fill
                      sizes="(max-width: 1024px) 100vw, 480px"
                      className="object-contain"
                    />
                  </div>
                  {multiView && (
                    <span className="absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white/85 backdrop-blur-sm">
                      View 1
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => removeView(0)}
                    aria-label="Remove this view"
                    className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white/85 backdrop-blur-sm transition-colors hover:bg-black/75"
                  >
                    <X size={14} />
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {photos.slice(1).map((view, index) => (
                    <div
                      key={view.slice(-48) + index}
                      className="relative overflow-hidden rounded-lg border border-white/10 bg-white/[0.03]"
                    >
                      <div className="relative aspect-square w-full">
                        <Image src={view} alt={`View ${index + 2} of the piece`} fill sizes="160px" className="object-contain" />
                      </div>
                      <span
                        title={
                          index + 2 <= VIDEO_REFERENCE_VIEWS
                            ? "Sent to the model as a visual reference"
                            : "Read by the analysis, which has no limit on views"
                        }
                        className="absolute left-1.5 top-1.5 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white/85 backdrop-blur-sm"
                      >
                        {index + 2 <= VIDEO_REFERENCE_VIEWS ? `View ${index + 2}` : "Analysed"}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeView(index + 1)}
                        aria-label={`Remove view ${index + 2}`}
                        className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white/85 backdrop-blur-sm transition-colors hover:bg-black/75"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}

                  {canAddView && (
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
                        accept(event.dataTransfer.files);
                      }}
                      className={cn(
                        "flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-2 text-center transition-colors",
                        dragging ? "border-gold/40 bg-gold/[0.06]" : "border-white/[0.12] bg-white/[0.02] hover:border-white/25"
                      )}
                    >
                      <Plus size={16} className="text-faint" />
                      <span className="text-[10px] leading-tight text-faint">
                        Add another
                        <br />
                        angle
                      </span>
                    </button>
                  )}
                </div>

                {/* The one thing a user cannot guess: extra views buy a real
                    back and side, and cost the guaranteed opening frame. */}
                <p className="text-[11px] text-faint">
                  {!multiView
                    ? "One view — the clip opens on this exact photo. Add a side or back angle so an orbit shows the real thing."
                    : photos.length <= VIDEO_REFERENCE_VIEWS
                      ? `${photos.length} views of one piece — the camera will film the real back and sides rather than inventing them. The clip won't open on any one of these photos.`
                      : `${photos.length} views of one piece. All ${photos.length} are analysed in detail to pin down the design; the first ${VIDEO_REFERENCE_VIEWS} are also sent to the model as visual references, which is its own limit. The clip won't open on any one of these photos.`}
                </p>
              </div>
            )}

            <OptionChips label="Camera" options={VIDEO_CAMERA_STYLES} value={camera} onChange={setCamera} />
            <p className="-mt-1 text-[11px] text-faint">
              {VIDEO_CAMERA_STYLES.find((entry) => entry.id === camera)?.description}
            </p>

            {/* The one place where what the user uploaded decides whether
                they get what they asked for: a full turn from a single
                photo means the model invents the half it was never shown. */}
            {camera === "orbit" && photos.length > 0 && !multiView && (
              <p className="-mt-1 rounded-lg border border-gold/20 bg-gold/[0.06] px-2.5 py-2 text-[11px] leading-relaxed text-gold/90">
                A full turn from one photo means the back and far side are invented — they won&apos;t match the real
                piece. Add a side and a back view and the rotation is built from your photos instead.
              </p>
            )}

            <OptionChips label="Mood" options={VIDEO_MOOD_STYLES} value={mood} onChange={setMood} />
            <p className="-mt-1 text-[11px] text-faint">
              {VIDEO_MOOD_STYLES.find((entry) => entry.id === mood)?.description}
            </p>

          </div>

          <div className="space-y-4">
            <div className="space-y-4 rounded-xl border border-white/[0.08] bg-surface-raised p-4">
              {/* Locked rather than hidden with more than one view: the
                  values still matter to the user, they just aren't a choice
                  in reference mode. */}
              {multiView && (
                <p className="rounded-lg border border-gold/20 bg-gold/[0.06] px-2.5 py-2 text-[11px] leading-relaxed text-gold/90">
                  Multiple views need Veo&apos;s reference mode, which only runs on Veo 3.1 Standard at 8s, 720p and
                  16:9. Drop back to one view for the other models, lengths and shapes.
                </p>
              )}

              <Setting label="Model">
                <select
                  value={effective.model}
                  disabled={multiView}
                  onChange={(event) => setModel(event.target.value as VideoModelId)}
                  className="min-h-8 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-xs text-cream focus:border-gold/30 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
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
                  value={effective.durationSeconds}
                  disabled={multiView}
                  onChange={(event) => setDurationSeconds(Number(event.target.value))}
                  className="min-h-8 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-xs text-cream focus:border-gold/30 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
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
                      active={entry.id === effective.resolution}
                      disabled={multiView}
                      onClick={() => setResolution(entry.id)}
                    />
                  ))}
                </div>
              </Setting>
            </div>

            {/* The same shape picker the image tools use, out of the
                settings card and on its own: a ratio is chosen by its
                outline, which a pair of text chips in a row cannot show. */}
            <AspectChips
              options={VIDEO_ASPECTS}
              value={effective.aspectRatio}
              onChange={setAspectRatio}
              disabled={multiView}
            />

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
              disabled={!photos.length || rendering}
              icon={rendering ? <Loader2 size={14} className="animate-spin" /> : <Film size={14} />}
            >
              {rendering
                ? "Rendering…"
                : `Animate ${multiView ? `these ${photos.length} views` : "this photo"} · ${effective.durationSeconds}s`}
            </RunButton>

            {rendering && job && (
              <div className="space-y-1.5 rounded-xl border border-white/[0.08] bg-surface-raised p-3">
                <JobProgressBar percent={job.progress} />
                <p className="text-[11px] text-faint">
                  {job.phase === "analysing"
                    ? "Reading the piece — stones, setting, band — so the clip can't drift from it…"
                    : job.phase === "saving"
                      ? "Saving the clip…"
                      : "Rendering — this takes a few minutes."}{" "}
                  You can leave
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
                  {/* A button, not `<a download>`. The download attribute is
                      ignored on a cross-origin url, and the clip is served
                      from R2 — so the link opened the video in the tab
                      instead of saving it. downloadImage pulls it through
                      our own backend, which marks it as an attachment. */}
                  <button
                    type="button"
                    onClick={() => downloadImage(videoUrl, downloadName(videoUrl, "jewellery", "video"))}
                    className="flex items-center gap-1.5 rounded-lg border border-white/[0.07] px-2.5 py-1.5 text-[11px] font-medium text-muted transition-colors hover:border-white/[0.14] hover:text-cream"
                  >
                    <Download size={12} /> Download
                  </button>
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

function SmallChip({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "min-h-8 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        active
          ? "border-gold/30 bg-gold/10 text-gold"
          : "border-white/[0.07] bg-white/[0.03] text-muted hover:border-white/[0.14] hover:text-cream"
      )}
    >
      {label}
    </button>
  );
}
