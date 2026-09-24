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
import { useCreditGuard } from "@/lib/credit-guard";
import { useJobs } from "@/lib/jobs-context";
import { failureMessage, useSettledJob } from "@/lib/useSettledJob";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/permissions";
import { ToolAccessNotice } from "@/components/studio/ToolAccessNotice";
import { cn } from "@/lib/utils";

const PERMISSION = "tool.image_to_video.run";

/**
 * The four angles that describe a ring, as named slots rather than a pile of
 * files.
 *
 * Two reasons, and the second is the real one. A labelled slot tells the user
 * which angles are worth photographing â€” "add another view" does not, and the
 * views people actually supplied were front-heavy. And because each slot is
 * named, the analysis pass can be *told* which photograph is the back rather
 * than inferring it, which is what makes the symmetry judgement it now makes
 * coherent: mirroring is meaningless if you don't know which side you're
 * looking at.
 *
 * Anything past these is an extra view â€” still read by the analysis, which has
 * no provider limit, and still worth uploading.
 */
const NAMED_VIEWS = [
  { id: "front", label: "Front", hint: "Face on" },
  { id: "side", label: "Side", hint: "Profile" },
  { id: "back", label: "Back", hint: "Reverse" },
  { id: "top", label: "Top", hint: "Looking down" },
] as const;

type NamedViewId = (typeof NAMED_VIEWS)[number]["id"];

/**
 * Image to Video: a piece, animated â€” from one view of it or up to three.
 *
 * The extra views are not extra clips. They are the same object photographed
 * from different angles, handed to Veo as references so that when the camera
 * swings behind the piece it films the real back rather than an invented one.
 * The cost is stated on the page, because it is not obvious: with more than
 * one view there is no pinned opening frame.
 *
 * No refine loop â€” a clip can't be edited by asking, only regenerated â€” so
 * this doesn't use the shared generate-then-refine workspace. What matters
 * most here is that the wait is minutes rather than seconds, which is
 * exactly why the run is followed through the queue: this page can be
 * closed and the clip will still be waiting.
 */
export default function ImageToVideoPage() {
  const { user } = useAuth();
  const { jobs, track } = useJobs();
  const creditGuard = useCreditGuard();

  /**
   * The named angles, and anything beyond them.
   *
   * Kept apart because they behave differently: a named slot holds one photo
   * and replacing it is the point, while extras are a growing list. What the
   * run actually sends is the two flattened together â€” see `photos` below.
   */
  const [slots, setSlots] = useState<Record<NamedViewId, string | null>>({
    front: null,
    side: null,
    back: null,
    top: null,
  });
  const [extras, setExtras] = useState<string[]>([]);
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

  /** The extras picker. Each named slot owns its own, so one file lands in one slot. */
  const fileInput = useRef<HTMLInputElement>(null);
  const slotInputs = useRef<Partial<Record<NamedViewId, HTMLInputElement | null>>>({});
  /**
   * The run this page is following. State rather than a ref because the
   * progress bar renders from it â€” a ref write would not re-render, so the
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

  /*
   * What the run sends: the named angles that were filled, in the order they
   * are listed, then the extras.
   *
   * The order is not cosmetic. The first entry is the primary view â€” the
   * opening frame on a single-view run â€” and the first three are what Veo
   * takes as references, so Front/Side/Back reaching the model ahead of a
   * gallery shot is the point of naming them at all.
   */
  const filledNamed = NAMED_VIEWS.filter((view) => slots[view.id]);
  const photos = [...filledNamed.map((view) => slots[view.id] as string), ...extras];
  /** Parallel to `photos` â€” tells the analysis which angle each photo is. */
  const viewLabels = [...filledNamed.map((view) => view.label), ...extras.map(() => "Additional")];

  /**
   * One named angle. Replaces whatever that slot held â€” picking a new Back is
   * how you correct a bad Back, not how you add a fifth view.
   */
  async function acceptSlot(id: NamedViewId, files: FileList | File[] | null | undefined) {
    const file = Array.from(files ?? [])[0];
    if (!file) return;

    try {
      const compressed = await compressImage(file);
      setSlots((current) => ({ ...current, [id]: compressed }));
      setVideoUrl(null);
      setStatus("idle");
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that file");
    }
  }

  /**
   * Extra angles, up to whatever the cap leaves after the named ones. Files
   * past it are ignored with a note rather than silently dropped â€” a user who
   * picked five should be told which two the clip won't see.
   */
  async function acceptExtras(files: FileList | File[] | null | undefined) {
    const picked = Array.from(files ?? []);
    if (!picked.length) return;

    const room = MAX_VIDEO_VIEWS - photos.length;
    if (room <= 0) {
      setError(`At most ${MAX_VIDEO_VIEWS} views in total â€” remove one to add another.`);
      return;
    }

    try {
      const added = await Promise.all(picked.slice(0, room).map((file) => compressImage(file)));
      setExtras((current) => [...current, ...added]);
      setVideoUrl(null);
      setStatus("idle");
      setError(picked.length > room ? `Added ${room} more â€” at most ${MAX_VIDEO_VIEWS} views in total.` : "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that file");
    }
  }

  async function handleRender() {
    if (!photos.length) return;
    setError("");
    setVideoUrl(null);
    setStatus("rendering");

    const preview = await makeThumbnail(photos[0]);
    const res = await imageToVideo({
      images: photos,
      // Which angle each photo is, so the analysis can say "the back showsâ€¦"
      // rather than working it out â€” and so its symmetry judgement has sides
      // to reason about.
      viewLabels,
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
    } else if (creditGuard(res)) {
      setStatus("idle");
    } else {
      setStatus("failed");
      setError(res.message || "Could not queue this clip");
    }
  }

  function reset() {
    setSlots({ front: null, side: null, back: null, top: null });
    setExtras([]);
    setVideoUrl(null);
    setStatus("idle");
    setError("");
    setJobId(null);
  }

  const rendering = status === "rendering";
  const multiView = photos.length > 1;
  const canAddView = photos.length < MAX_VIDEO_VIEWS;

  /*
   * With more than one view the settings are not the user's to choose â€”
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
                acceptExtras(event.target.files);
                event.target.value = "";
              }}
            />

            {/*
              Four named angles, then anything else.

              A single dropzone asked for "views" and got four photographs of
              the front. Naming the slots is the instruction: it says which
              angles are worth taking, shows at a glance which one is still
              missing, and lets a bad Back be replaced rather than removed and
              re-added at the end of a list.
            */}
            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-cream">Views</p>
                <span className="text-[10px] text-faint">
                  {photos.length}/{MAX_VIDEO_VIEWS}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {NAMED_VIEWS.map((view) => {
                  const src = slots[view.id];
                  return (
                    <div
                      key={view.id}
                      className={cn(
                        "relative overflow-hidden rounded-lg border transition-colors",
                        src ? "border-white/10 bg-white/[0.03]" : "border-dashed border-white/[0.12] bg-white/[0.02]"
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => slotInputs.current[view.id]?.click()}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                          event.preventDefault();
                          acceptSlot(view.id, event.dataTransfer.files);
                        }}
                        className="block aspect-square w-full"
                        aria-label={src ? `Replace the ${view.label} view` : `Add the ${view.label} view`}
                      >
                        {src ? (
                          <span className="relative block h-full w-full">
                            <Image
                              src={src}
                              alt={`${view.label} view of the piece`}
                              fill
                              sizes="160px"
                              className="object-contain"
                            />
                          </span>
                        ) : (
                          <span className="flex h-full w-full flex-col items-center justify-center gap-1 px-1 text-center">
                            <Plus size={14} className="text-faint" />
                            <span className="text-[10px] font-medium leading-tight text-muted">{view.label}</span>
                            <span className="text-[9px] leading-tight text-faint">{view.hint}</span>
                          </span>
                        )}
                      </button>

                      {src && (
                        <>
                          <span className="pointer-events-none absolute left-1.5 top-1.5 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white/85 backdrop-blur-sm">
                            {view.label}
                          </span>
                          <button
                            type="button"
                            onClick={() => setSlots((current) => ({ ...current, [view.id]: null }))}
                            aria-label={`Remove the ${view.label} view`}
                            className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white/85 backdrop-blur-sm transition-colors hover:bg-black/75"
                          >
                            <X size={12} />
                          </button>
                        </>
                      )}

                      <input
                        ref={(node) => {
                          slotInputs.current[view.id] = node;
                        }}
                        type="file"
                        accept="image/*"
                        hidden
                        onChange={(event) => {
                          acceptSlot(view.id, event.target.files);
                          event.target.value = "";
                        }}
                      />
                    </div>
                  );
                })}
              </div>

              {/*
                Extras are shown only once the named angles have been started,
                so an empty page offers one clear instruction rather than two
                competing ones.
              */}
              {photos.length > 0 && (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                  {extras.map((src, index) => (
                    <div
                      key={src.slice(-48) + index}
                      className="relative overflow-hidden rounded-lg border border-white/10 bg-white/[0.03]"
                    >
                      <div className="relative aspect-square w-full">
                        <Image src={src} alt={`Additional view ${index + 1}`} fill sizes="120px" className="object-contain" />
                      </div>
                      <span
                        title="Read by the analysis, which has no limit on views"
                        className="pointer-events-none absolute left-1 top-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[9px] font-medium text-white/85 backdrop-blur-sm"
                      >
                        Extra
                      </span>
                      <button
                        type="button"
                        onClick={() => setExtras((current) => current.filter((_, at) => at !== index))}
                        aria-label={`Remove additional view ${index + 1}`}
                        className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/55 text-white/85 backdrop-blur-sm transition-colors hover:bg-black/75"
                      >
                        <X size={11} />
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
                        acceptExtras(event.dataTransfer.files);
                      }}
                      className={cn(
                        "flex aspect-square w-full flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed px-1 text-center transition-colors",
                        dragging ? "border-gold/40 bg-gold/[0.06]" : "border-white/[0.12] bg-white/[0.02] hover:border-white/25"
                      )}
                    >
                      <Plus size={14} className="text-faint" />
                      <span className="text-[9px] leading-tight text-faint">More</span>
                    </button>
                  )}
                </div>
              )}

              <p className="text-[11px] leading-relaxed text-faint">
                {photos.length === 0
                  ? "Front, side, back and top of the same piece. The more angles the analysis has, the less the clip has to invent â€” and the piece is filmed, never redesigned."
                  : !multiView
                    ? "One view â€” the clip opens on this exact photo. Add a side or back so a turn shows the real thing rather than an invented one."
                    : photos.length <= VIDEO_REFERENCE_VIEWS
                      ? `${photos.length} views of one piece â€” the camera will film the real back and sides rather than inventing them. The clip won't open on any one of these photos.`
                      : `${photos.length} views of one piece. All ${photos.length} are analysed in detail to pin down the design â€” including whether it is symmetrical â€” and the first ${VIDEO_REFERENCE_VIEWS} also go to the model as visual references, which is its own limit. The clip won't open on any one of these photos.`}
              </p>
            </div>

            <OptionChips label="Camera" options={VIDEO_CAMERA_STYLES} value={camera} onChange={setCamera} />
            <p className="-mt-1 text-[11px] text-faint">
              {VIDEO_CAMERA_STYLES.find((entry) => entry.id === camera)?.description}
            </p>

            {/* The one place where what the user uploaded decides whether
                they get what they asked for: a full turn from a single
                photo means the model invents the half it was never shown. */}
            {camera === "orbit" && photos.length > 0 && !multiView && (
              <p className="-mt-1 rounded-lg border border-gold/20 bg-gold/[0.06] px-2.5 py-2 text-[11px] leading-relaxed text-gold/90">
                A full turn from one photo means the back and far side are invented â€” they won&apos;t match the real
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
              placeholder="Optional â€” extra direction for the motion"
            />

            <RunButton
              onClick={handleRender}
              disabled={!photos.length || rendering}
              icon={rendering ? <Loader2 size={14} className="animate-spin" /> : <Film size={14} />}
            >
              {rendering
                ? "Renderingâ€¦"
                : `Animate ${multiView ? `these ${photos.length} views` : "this photo"} Â· ${effective.durationSeconds}s`}
            </RunButton>

            {rendering && job && (
              <div className="space-y-1.5 rounded-xl border border-white/[0.08] bg-surface-raised p-3">
                <JobProgressBar percent={job.progress} />
                <p className="text-[11px] text-faint">
                  {job.phase === "analysing"
                    ? "Reading the piece â€” stones, setting, band â€” so the clip can't drift from itâ€¦"
                    : job.phase === "saving"
                      ? "Saving the clipâ€¦"
                      : "Rendering â€” this takes a few minutes."}{" "}
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
                      from R2 â€” so the link opened the video in the tab
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
