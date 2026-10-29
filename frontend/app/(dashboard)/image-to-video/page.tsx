"use client";

import { useRef, useState } from "react";
import { ErrorBanner, RunButton } from "@/components/studio/ToolChrome";
import Image from "next/image";
import { Download, Film, Loader2, Plus, X } from "lucide-react";
import { JobProgressBar } from "@/components/studio/JobProgressBar";
import { AspectChips } from "@/components/studio/AspectChips";
import { OptionChips } from "@/components/studio/OptionChips";
import { PromptCard } from "@/components/studio/PromptCard";
import { InlineDropdown } from "@/components/studio/InlineDropdown";
import { LibraryPicker } from "@/components/studio/LibraryPicker";
import { ToolHeader } from "@/components/studio/ToolHeader";
import {
  imageToVideo,
  VIDEO_REFERENCE_VIEWS,
  VIDEO_REFERENCE_MODE,
  DEFAULT_VIDEO_DURATION,
  DEFAULT_VIDEO_MODEL,
  VIDEO_ASPECTS,
  VIDEO_CAMERA_STYLES,
  VIDEO_MODELS,
  VIDEO_MOOD_STYLES,
  VIDEO_RESOLUTIONS,
  VIDEO_TURNTABLE,
  type VideoModelId,
} from "@/lib/api";
import { compressImage, downloadImage, downloadName, makeThumbnail } from "@/lib/image";
import { useCreditGuard } from "@/lib/credit-guard";
import { useJobs } from "@/lib/jobs-context";
import { failureMessage, useSettledJob } from "@/lib/useSettledJob";
import { useAuth } from "@/lib/auth-context";
import { LIBRARY_PERMISSION } from "@/lib/library";
import { can } from "@/lib/permissions";
import { ToolAccessNotice } from "@/components/studio/ToolAccessNotice";
import { cn } from "@/lib/utils";

const PERMISSION = "tool.image_to_video.run";

/**
 * The angles that describe a ring, as named slots rather than a pile of
 * files.
 *
 * Two reasons, and the second is the real one. A labelled slot tells the user
 * which angles are worth photographing — "add another view" does not, and the
 * views people actually supplied were front-heavy. And because each slot is
 * named, the analysis pass can be *told* which photograph is the back rather
 * than inferring it, which is what makes the symmetry judgement it now makes
 * coherent: mirroring is meaningless if you don't know which side you're
 * looking at.
 *
 * Only the four angles a pinned 360° turns through (VIDEO_TURNTABLE) — Top
 * and loose extra views are gone, as they never reached the clip itself.
 * Their labels must stay as the backend reads them. Other side is its own
 * photo rather than a mirrored Side: a bypass shank or a one-sided pavé is
 * not the same from both sides.
 *
 * Each empty slot shows a faded example of its angle, so it is clear which
 * photo goes where. Back and Other side are the Front and Side examples
 * mirrored — how a typical ring looks from behind and from its other side.
 */
const NAMED_VIEWS = [
  { id: "front", label: "Front", hint: "Standing, facing you", example: "/product-views/upright.jpg", mirror: false },
  { id: "side", label: "Side", hint: "Profile", example: "/product-views/side.jpg", mirror: false },
  { id: "back", label: "Back", hint: "From behind", example: "/product-views/upright.jpg", mirror: true },
  { id: "other-side", label: "Other side", hint: "Opposite profile", example: "/product-views/side.jpg", mirror: true },
] as const;

type NamedViewId = (typeof NAMED_VIEWS)[number]["id"];

const EMPTY_SLOTS: Record<NamedViewId, string | null> = { front: null, side: null, back: null, "other-side": null };

/** The allowed length nearest to what was picked — of a loop, or of a model's clips. */
function nearestLength(lengths: readonly number[], seconds: number) {
  return lengths.reduce((best, option) => (Math.abs(option - seconds) < Math.abs(best - seconds) ? option : best));
}

/**
 * Image to Video: a piece, animated — from one view of it or up to four.
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
  const creditGuard = useCreditGuard();

  /** One photo per named angle — replacing a slot's photo is how a bad one is corrected. */
  const [slots, setSlots] = useState<Record<NamedViewId, string | null>>(EMPTY_SLOTS);
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
  /** Whether the clip being shown is a pinned 360° — it is made to loop, so it plays as one. */
  const [loopResult, setLoopResult] = useState(false);

  /** Each named slot owns its own picker, so one file lands in one slot. */
  const slotInputs = useRef<Partial<Record<NamedViewId, HTMLInputElement | null>>>({});
  /**
   * The angle the library is filling while it is open — one dialog for the
   * page, aimed at whichever slot was clicked. Without the grant a slot opens
   * its own file dialog, as before.
   */
  const [librarySlot, setLibrarySlot] = useState<NamedViewId | null>(null);
  const canBrowseLibrary = can(user, LIBRARY_PERMISSION);
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

  /*
   * What the run sends: the named angles that were filled, in the order they
   * are listed.
   *
   * The order is not cosmetic. The first entry is the primary view — the
   * opening frame on a single-view run — and the first three are what Veo
   * takes as references, so Front/Side/Back reach the model first.
   */
  const filledNamed = NAMED_VIEWS.filter((view) => slots[view.id]);
  const photos = filledNamed.map((view) => slots[view.id] as string);
  /** Parallel to `photos` — tells the analysis which angle each photo is. */
  const viewLabels = filledNamed.map((view) => view.label);

  /*
   * The pinned 360°: the orbit camera with a Front photo and at least one more
   * angle around the piece. The turn is then filmed between those photos —
   * each one is exactly what the clip shows at that angle — rather than
   * rebuilt from references the way any other multi-view run is.
   */
  const pinnedAngles = filledNamed.filter((view) => (VIDEO_TURNTABLE.angles as readonly string[]).includes(view.label));
  /*
   * Decided by the photos, not the slot names — the same plan the backend
   * makes (video/turntable.js planTurntable). The same photo in two slots
   * means the piece looks the same from those angles; with Back the same as
   * Front (or no Back at all), only Front → Side → Back is filmed and the
   * loop plays it twice.
   */
  const samePhoto = (a: NamedViewId, b: NamedViewId) => Boolean(slots[a]) && slots[a] === slots[b];
  const distinctPinned = pinnedAngles.filter((view, i) => pinnedAngles.findIndex((other) => slots[other.id] === slots[view.id]) === i).length;
  const turntable = camera === "orbit" && Boolean(slots.front) && distinctPinned >= 2;
  const sideId: NamedViewId | null = slots.side ? "side" : slots["other-side"] ? "other-side" : null;
  const halfTurn =
    turntable &&
    Boolean(sideId) &&
    (!slots.back || samePhoto("front", "back")) &&
    (!(slots.side && slots["other-side"]) || samePhoto("side", "other-side"));
  const loopSeconds = nearestLength(VIDEO_TURNTABLE.lengths, durationSeconds);
  const multiView = photos.length > 1;

  /*
   * With more than one view the settings are not all the user's to choose.
   * Reference mode accepts exactly one combination, shown as the locked
   * values rather than left displaying picks the run would ignore. A pinned
   * 360° fixes only the model; its length is the finished loop's.
   */
  const referenceMode = multiView && !turntable;
  const effective = turntable
    ? { model: VIDEO_TURNTABLE.model, aspectRatio, resolution, durationSeconds: loopSeconds }
    : referenceMode
      ? VIDEO_REFERENCE_MODE
      : { model, aspectRatio, resolution, durationSeconds };

  /**
   * What each angle is for, tagged on its empty slot so the minimum is plain:
   * Front is the one photo every clip needs; with the 360° orbit, Side is what
   * turns it into a pinned turn; the rest only make it more exact.
   */
  function needOf(id: NamedViewId): { label: string; tone: "required" | "recommended" | "optional" } {
    if (id === "front") return { label: "Required", tone: "required" };
    if (id === "side" && camera === "orbit") return { label: "For 360°", tone: "recommended" };
    return { label: "Optional", tone: "optional" };
  }

  /**
   * One named angle. Replaces whatever that slot held — picking a new Back is
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

  /** A photo pasted into the box goes to the first angle still empty, in the order listed. */
  function acceptPasted(file: File) {
    const empty = NAMED_VIEWS.find((view) => !slots[view.id]);
    if (!empty) {
      setError("Every angle already has a photo — replace one by clicking it.");
      return;
    }
    void acceptSlot(empty.id, [file]);
  }

  async function handleRender() {
    // Every clip starts from the Front photo — the one photo a run needs.
    if (!slots.front) return;
    setError("");
    setVideoUrl(null);
    setStatus("rendering");

    const preview = await makeThumbnail(photos[0]);
    setLoopResult(turntable);
    const res = await imageToVideo({
      images: photos,
      // Which angle each photo is, so the analysis can say "the back shows…"
      // rather than working it out — and so its symmetry judgement has sides
      // to reason about. A pinned 360° also reads them to know which photo
      // each segment of the turn starts and ends on.
      viewLabels,
      description,
      camera,
      mood,
      preview,
      // Multi-view runs send the locked combination, matching what the
      // settings card is showing and what the backend will enforce anyway.
      ...(turntable ? { turntable: true, ...effective } : effective),
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
    setSlots(EMPTY_SLOTS);
    setVideoUrl(null);
    setStatus("idle");
    setError("");
    setJobId(null);
  }

  const rendering = status === "rendering";

  /** Each model has its own lengths and sizes — the pickers offer only those. */
  const modelSpec = VIDEO_MODELS.find((entry) => entry.id === effective.model) ?? VIDEO_MODELS[0];
  const lengths: readonly number[] = turntable ? VIDEO_TURNTABLE.lengths : modelSpec.durations;

  /** Switching model snaps length and resolution onto what the new one accepts. */
  function chooseModel(next: VideoModelId) {
    const spec = VIDEO_MODELS.find((entry) => entry.id === next) ?? VIDEO_MODELS[0];
    setModel(next);
    const lengths: readonly number[] = spec.durations;
    if (!lengths.includes(durationSeconds)) setDurationSeconds(nearestLength(lengths, durationSeconds));
    const sizes: readonly string[] = spec.resolutions;
    if (!sizes.includes(resolution)) setResolution(sizes[0]);
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      {status !== "idle" && <ToolHeader onReset={reset} resetLabel="New clip" />}
      <ErrorBanner message={error} />

      <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8">
        <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            {/*
              Four named angles, each showing an example of itself.

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
                  {photos.length}/{NAMED_VIEWS.length}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {NAMED_VIEWS.map((view) => {
                  const src = slots[view.id];
                  const need = needOf(view.id);
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
                        onClick={() => (canBrowseLibrary ? setLibrarySlot(view.id) : slotInputs.current[view.id]?.click())}
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
                          // A faded example of this angle behind the label —
                          // which photo goes here, shown rather than described.
                          <span className="relative flex h-full w-full flex-col items-center justify-end gap-0.5 px-1 pb-2 text-center">
                            <Image
                              src={view.example}
                              alt=""
                              fill
                              sizes="160px"
                              // Multiply drops the example's white backdrop into the tile, leaving only the ring.
                              className={cn("object-contain p-3 pb-8 opacity-[0.45] mix-blend-multiply", view.mirror && "-scale-x-100")}
                            />
                            <span
                              className={cn(
                                "absolute left-1.5 top-1.5 rounded-full px-1.5 py-px text-[8px] font-semibold uppercase leading-[14px] tracking-wide",
                                need.tone === "required"
                                  ? "border border-gold/30 bg-gold/15 text-gold"
                                  : need.tone === "recommended"
                                    ? "border border-gold/25 text-gold/80"
                                    : "bg-black/[0.04] text-faint"
                              )}
                            >
                              {need.label}
                            </span>
                            <span className="relative flex items-center gap-1 text-[10px] font-medium leading-tight text-muted">
                              <Plus size={11} className="text-faint" />
                              {view.label}
                            </span>
                            <span className="relative text-[9px] leading-tight text-faint">{view.hint}</span>
                          </span>
                        )}
                      </button>

                      {src && (
                        <>
                          {/* Bottom-left, so a long name like "Other side" never runs under the remove button. */}
                          <span className="pointer-events-none absolute bottom-1.5 left-1.5 max-w-[calc(100%-0.75rem)] truncate rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white/85 backdrop-blur-sm">
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
              <LibraryPicker
                open={librarySlot !== null}
                onClose={() => setLibrarySlot(null)}
                onFiles={(files) => librarySlot && acceptSlot(librarySlot, files)}
                room={1}
              />

              <p className="text-[11px] leading-relaxed text-faint">
                {!slots.front
                  ? camera === "orbit"
                    ? "Minimum: one Front photo. Add the Side too and the 360° follows your photos; Back and Other side make every angle exact."
                    : "Minimum: one Front photo — the clip starts from it. The other angles are optional and help the piece stay true as it moves."
                  : turntable
                    ? `${pinnedAngles.length} angles pinned — the turn passes exactly through each of these photos.`
                    : !multiView
                    ? "One view — the clip opens on this exact photo. Add a side or back so a turn shows the real thing rather than an invented one."
                    : photos.length <= VIDEO_REFERENCE_VIEWS
                      ? `${photos.length} views of one piece — the camera will film the real back and sides rather than inventing them. The clip won't open on any one of these photos.`
                      : `${photos.length} views of one piece. All ${photos.length} are analysed in detail to pin down the design — including whether it is symmetrical — and the first ${VIDEO_REFERENCE_VIEWS} also go to the model as visual references, which is its own limit. The clip won't open on any one of these photos.`}
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
                A full turn from one photo means the back and far side are invented — they won&apos;t match the real
                piece. Add a side and a back view and the turn is pinned to your photos instead.
              </p>
            )}

            {/* What a pinned 360° is, and what would make it fully pinned —
                said here because it is the camera choice that turns it on. */}
            {turntable && (
              <p className="-mt-1 rounded-lg border border-gold/20 bg-gold/[0.06] px-2.5 py-2 text-[11px] leading-relaxed text-gold/90">
                {halfTurn ? (
                  <>
                    Pinned 360°: Front → Side → Back is filmed on Wan 3.0 and played twice —{" "}
                    {slots.back
                      ? "your Back is the same photo as your Front, so the piece looks the same from behind and the second half of the turn is the first half again."
                      : "with no Back photo the piece is taken to look the same from behind, as most jewellery does."}{" "}
                    Every turn lands exactly on your photos, and only half the turn is paid for.
                  </>
                ) : (
                  <>
                    Pinned 360°: filmed as {pinnedAngles.length} turns between your photos ({[...pinnedAngles.map((view) => view.label), "Front"].join(" → ")}) on
                    Wan 3.0, each landing exactly on your next photo, then joined into one seamless loop.
                  </>
                )}{" "}
                Any turn that comes back turning the wrong way is filmed again.
              </p>
            )}

          </div>

          <div className="space-y-4">
            {/* A pinned 360° opens and lands on the photos themselves, so
                their own backdrop and light are the clip's — a mood can't
                apply, and is shown greyed rather than silently ignored. */}
            <div className={cn(turntable && "pointer-events-none opacity-45")}>
              <OptionChips label="Mood" options={VIDEO_MOOD_STYLES} value={mood} onChange={setMood} />
            </div>
            <p className="-mt-1 text-[11px] text-faint">
              {turntable
                ? "A pinned 360° keeps your photos' own background and light."
                : VIDEO_MOOD_STYLES.find((entry) => entry.id === mood)?.description}
            </p>

            {/* Locked rather than hidden with more than one view: the
                values still matter to the user, they just aren't a choice
                in reference mode. */}
            {referenceMode && (
              <p className="rounded-lg border border-gold/20 bg-gold/[0.06] px-2.5 py-2 text-[11px] leading-relaxed text-gold/90">
                Multiple views need Veo&apos;s reference mode, which only runs on Veo 3.1 Standard at 8s, 720p and
                16:9. Drop back to one view for the other models, lengths and shapes.
              </p>
            )}

            {/* The same shape picker the image tools use, out of the
                settings card and on its own: a ratio is chosen by its
                outline, which a pair of text chips in a row cannot show. */}
            <AspectChips
              options={VIDEO_ASPECTS}
              value={effective.aspectRatio}
              onChange={setAspectRatio}
              disabled={referenceMode}
            />

            {/* Model and length sit on the box, like the image tools. */}
            <PromptCard
              label="Anything else"
              value={description}
              onChange={setDescription}
              placeholder="Optional — extra direction for the motion"
              footerStart={
                <InlineDropdown
                  label="Length"
                  value={String(effective.durationSeconds)}
                  disabled={referenceMode}
                  onChange={(next) => setDurationSeconds(Number(next))}
                  options={lengths.map((seconds) => ({ value: String(seconds), label: `${seconds}s` }))}
                  panelClassName="w-[92px]"
                />
              }
              footerEnd={
                <div className="flex min-w-0 items-center gap-2">
                  <InlineDropdown
                    label="Model"
                    value={effective.model}
                    disabled={multiView}
                    onChange={(next) => chooseModel(next as VideoModelId)}
                    options={VIDEO_MODELS.map((entry) => ({
                      value: entry.id,
                      label: entry.label,
                      hint: entry.description,
                      group: entry.provider,
                      badge: "badge" in entry ? entry.badge : undefined,
                    }))}
                    triggerClassName="max-w-[150px] sm:max-w-[170px]"
                    panelClassName="w-[210px] max-h-[300px] !overflow-y-auto"
                  />
                  <InlineDropdown
                    label="Resolution"
                    value={effective.resolution}
                    disabled={referenceMode}
                    onChange={setResolution}
                    options={modelSpec.resolutions.map((id) => ({ value: id, label: id }))}
                    align="right"
                    panelClassName="w-[92px]"
                  />
                </div>
              }
              // A pasted photo is another view of the piece, not text — same
              // as dropping it on the uploader, just without leaving the
              // keyboard. Diverted before it can land in the prompt as an
              // unrenderable image.
              onPasteImage={acceptPasted}
            />

            <RunButton
              onClick={handleRender}
              disabled={!slots.front || rendering}
              icon={rendering ? <Loader2 size={14} className="animate-spin" /> : <Film size={14} />}
            >
              {rendering
                ? "Rendering…"
                : !slots.front
                  ? "Add the Front photo to start"
                  : turntable
                  ? `Film a pinned 360° · ${effective.durationSeconds}s`
                  : `Animate ${multiView ? `these ${photos.length} views` : "this photo"} · ${effective.durationSeconds}s`}
            </RunButton>

            {rendering && job && (
              <div className="space-y-1.5 rounded-xl border border-white/[0.08] bg-surface-raised p-3">
                <JobProgressBar percent={job.progress} />
                <p className="text-[11px] text-faint">
                  {job.phase === "analysing"
                    ? "Reading the piece — stones, setting, band — so the clip can't drift from it…"
                    : job.phase === "joining"
                      ? "Evening out the speed and joining the turns into one loop…"
                      : job.phase === "saving"
                        ? "Saving the clip…"
                        : loopResult
                          ? "Filming each turn between your photos — this takes a few minutes."
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
                <video src={videoUrl} controls playsInline loop={loopResult} className="w-full" />
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
