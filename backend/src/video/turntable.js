const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const sharp = require("sharp");
const ffmpegPath = require("ffmpeg-static");
const { TURNTABLE } = require("../prompts/video");

const run = promisify(execFile);

/**
 * The pinned turntable's own media work: lining the person's photos up as
 * frames before the model sees them, and turning the segments it films into
 * one loop that turns at an even speed.
 *
 * Why the speed needs evening out at all: a model asked to move from one
 * pinned frame to another eases out of the first — Wan 3.0 spends its opening
 * tenth almost still (measured: a sixth of its average motion) and then
 * hurries. Played back to back, four such quarter-turns stall at every join.
 * So each segment is filmed somewhat longer than its share of the loop, the
 * motion between its frames is measured, and frames are picked at equal
 * steps of that motion — the still opening is skipped through, the rest kept
 * — which is a constant apparent speed without inventing a single frame.
 */

/** Pixel size of the finished clip. */
function frameSize(resolution, aspectRatio) {
  const long = resolution === "1080p" ? 1920 : 1280;
  const short = resolution === "1080p" ? 1080 : 720;
  return aspectRatio === "9:16" ? { width: short, height: long } : { width: long, height: short };
}

/** The colour round a photo's edge — what its letterbox bars are filled with, so they read as more backdrop. */
async function edgeColour(buffer) {
  const side = 64;
  const { data, info } = await sharp(buffer, { failOn: "none" })
    .flatten({ background: "#ffffff" })
    .resize(side, side, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = [[], [], []];
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      if (x > 1 && x < side - 2 && y > 1 && y < side - 2) continue;
      const i = (y * side + x) * info.channels;
      for (let c = 0; c < 3; c++) channels[c].push(data[i + c]);
    }
  }
  const [r, g, b] = channels.map((values) => values.sort((p, q) => p - q)[values.length >> 1]);
  return { r, g, b };
}

/**
 * Every pinned photo as a frame of exactly the clip's size and shape: the
 * photo whole and centred, on bars of its own backdrop colour. Each segment
 * opens on one of these and lands on the next, so they must agree in size —
 * otherwise the piece jumps at every join.
 */
async function framePhotos(images, { width, height }) {
  return Promise.all(
    images.map(async (image) => {
      const buffer = Buffer.from(image.base64, "base64");
      const background = await edgeColour(buffer);
      const framed = await sharp(buffer, { failOn: "none" })
        .rotate()
        .flatten({ background })
        .resize(width, height, { fit: "contain", background })
        .jpeg({ quality: 92 })
        .toBuffer();
      return { mimeType: "image/jpeg", base64: framed.toString("base64") };
    })
  );
}

/**
 * Which segments to film, and the order they play in, from what the photos
 * show rather than which slots they sit in.
 *
 * `pinned` are the labelled angles present, in turn order, each with the
 * index of its photo in `images` (parsed `{ base64 }`) and its `degrees`.
 * The same photo in Front and Back says the piece looks the same from behind:
 * the second half of a turn is then the first half again, so only Front →
 * Side → Back is filmed, and played twice. Filming the whole turn between
 * repeated photos is what made it swing back — between identical frames a
 * model can't tell which way to keep turning.
 *
 * Returns `{ segments, loop, halfTurn, distinct }`, or `{ error }`.
 */
function planTurntable({ pinned, images, loopSeconds }) {
  const same = (a, b) => Boolean(a && b) && images[a.index].base64 === images[b.index].base64;
  const at = (label) => pinned.find((angle) => angle.label === label);
  const front = at("Front");
  const back = at("Back");
  const side = at("Side") || at("Other side");
  const otherSide = at("Side") ? at("Other side") : null;

  const distinct = pinned.filter((angle, i) => pinned.findIndex((other) => same(other, angle)) === i).length;
  if (distinct < 2) {
    return { error: "These photos all show the same angle — add the Side photo so the piece has somewhere to turn to." };
  }

  // Looks the same from behind (and, when both sides were given, from either
  // side). With no Back photo at all it is taken to, as most jewellery does —
  // far better than one long segment from the side all the way round to the
  // front, which a model takes the short way back.
  const halfTurn = Boolean(side && (!back || same(front, back)) && (!otherSide || same(side, otherSide)));
  const position = (angle) => pinned.indexOf(angle);
  const segments = halfTurn
    ? [
        { fromPin: position(front), toPin: position(side), degrees: 90 },
        { fromPin: position(side), toPin: position(back || front), degrees: 90 },
      ]
    : pinned.map((angle, i) => {
        const next = pinned[(i + 1) % pinned.length];
        return { fromPin: i, toPin: (i + 1) % pinned.length, degrees: (next.degrees - angle.degrees + 360) % 360 || 360 };
      });

  const seconds = segmentSeconds({
    loopSeconds,
    degrees: segments.map((segment) => segment.degrees),
    min: TURNTABLE.minSegmentSeconds,
    max: TURNTABLE.maxSegmentSeconds,
  });
  segments.forEach((segment, i) => {
    segment.seconds = seconds[i];
    segment.from = pinned[segment.fromPin].label;
    // A half turn ends on the back, whichever photo stands in for it.
    segment.to = halfTurn && i === 1 ? "Back" : pinned[segment.toPin].label;
  });

  // The order the filmed segments play in: a half turn twice over.
  return { segments, loop: halfTurn ? [0, 1, 0, 1] : segments.map((_, i) => i), halfTurn, distinct };
}

/** Filmed this much longer than its share: enough that even the fastest stretch needs no frame shown twice. */
const SPARE = 1.4;

/**
 * How long to film each segment: its share of the loop (by the angle it
 * turns through), and some more, so there are frames to spare when the
 * still opening is skipped — within what the model accepts.
 */
function segmentSeconds({ loopSeconds, degrees, min, max }) {
  return degrees.map((angle) => Math.max(min, Math.min(max, Math.ceil(((loopSeconds * angle) / 360) * SPARE))));
}

/** Small grey copy the motion is measured on. */
const MOTION_LONG_SIDE = 192;

/** Every frame of a clip as a small grey image — what motion and retracing are measured on. */
async function greyFrames(file, aspectRatio) {
  const width = aspectRatio === "9:16" ? 108 : MOTION_LONG_SIDE;
  const height = aspectRatio === "9:16" ? MOTION_LONG_SIDE : 108;
  const { stdout } = await run(
    ffmpegPath,
    ["-hide_banner", "-loglevel", "error", "-i", file, "-vf", `scale=${width}:${height},format=gray`, "-fps_mode", "passthrough", "-f", "rawvideo", "-"],
    { encoding: "buffer", maxBuffer: 1 << 28 }
  );
  const size = width * height;
  return Array.from({ length: Math.floor(stdout.length / size) }, (_, f) => stdout.subarray(f * size, (f + 1) * size));
}

function meanDifference(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

/** How much each frame differs from the one before — the speed of the turn, frame by frame. */
async function motionOf(file, aspectRatio) {
  const frames = await greyFrames(file, aspectRatio);
  const motion = new Float64Array(Math.max(0, frames.length - 1));
  for (let f = 1; f < frames.length; f++) motion[f - 1] = meanDifference(frames[f], frames[f - 1]);
  return motion;
}

/** Runs `fn(files, dir)` with each buffer written to a temporary file in `dir`, removed afterwards. */
async function withFiles(buffers, fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "turn-"));
  try {
    const files = await Promise.all(
      buffers.map(async (buffer, index) => {
        const file = path.join(dir, `clip-${index}.mp4`);
        await fs.writeFile(file, buffer);
        return file;
      })
    );
    return await fn(files, dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Whether a segment carried on turning or went back the way the one before it
 * came: its frames against the previous segment's, matched in the same order
 * and in reverse. A segment that retraces looks like the previous one played
 * backwards, so the reversed match is far closer — measured on our clips, a
 * retraced quarter scored 0.29–0.40, quarters that kept turning 0.78–1.0.
 *
 * Returns reversed ÷ same-order: lower means more of a retrace.
 */
const RETRACE_RATIO = 0.6;

async function retraceScore(segment, previous, aspectRatio) {
  return withFiles([segment, previous], async ([segmentFile, previousFile]) => {
    const [now, before] = await Promise.all([greyFrames(segmentFile, aspectRatio), greyFrames(previousFile, aspectRatio)]);
    if (now.length < 2 || before.length < 2) return 1;
    const samples = 9;
    let sameOrder = 0;
    let reversed = 0;
    for (let s = 1; s < samples; s++) {
      const t = s / samples;
      const frame = now[Math.floor(t * (now.length - 1))];
      sameOrder += meanDifference(frame, before[Math.floor(t * (before.length - 1))]);
      reversed += meanDifference(frame, before[Math.floor((1 - t) * (before.length - 1))]);
    }
    return sameOrder > 0 ? reversed / sameOrder : 1;
  });
}

/** Whether a segment went back the way it came — see RETRACE_RATIO. */
function retraced(score) {
  return score < RETRACE_RATIO;
}

/**
 * A segment's biggest single step against its average one. The model
 * sometimes fails a turn by holding near the first frame and then snapping to
 * the last in a frame or two — no evening out can fix that, because the
 * frames in between were never made. Measured on our own clips: smooth turns
 * stay at or below 2.4, a snapped one was 7.4.
 */
const SNAP_RATIO = 4;

async function turnJump(buffer, aspectRatio) {
  return withFiles([buffer], async ([file]) => {
    const motion = await motionOf(file, aspectRatio);
    if (!motion.length) return Infinity;
    const mean = motion.reduce((sum, step) => sum + step, 0) / motion.length;
    return mean > 0 ? Math.max(...motion) / mean : Infinity;
  });
}

/** Whether a segment snapped rather than turned — see SNAP_RATIO. */
function snapped(jump) {
  return jump > SNAP_RATIO;
}

/**
 * Which of a segment's frames to keep, so its turn plays at one speed:
 * `count` frames at equal steps of the measured motion, always increasing,
 * starting on the first frame (the pinned photo) and never including the
 * last — the next segment opens on that same photo.
 */
function evenFrames(motion, count) {
  const frames = motion.length + 1;
  const usable = frames - 1;
  if (count >= usable) {
    return Array.from({ length: count }, (_, k) => Math.min(usable - 1, Math.floor((k * usable) / count)));
  }
  const cumulative = new Float64Array(frames);
  for (let i = 1; i < frames; i++) cumulative[i] = cumulative[i - 1] + motion[i - 1];
  const total = cumulative[usable];

  const picks = [];
  let previous = -1;
  let j = 0;
  for (let k = 0; k < count; k++) {
    const target = total > 0 ? (total * k) / count : (usable * k) / count;
    const at = (i) => (total > 0 ? cumulative[i] : i);
    while (j < usable && at(j + 1) <= target) j++;
    let pick = j + 1 < usable && target - at(j) > at(j + 1) - target ? j + 1 : j;
    // Strictly after the last pick, and leaving room for every pick still to come.
    pick = Math.min(Math.max(pick, previous + 1), usable - (count - k));
    picks.push(pick);
    previous = pick;
  }
  return picks;
}

/**
 * The finished loop from the segments the model filmed, in turn order.
 *
 * Each segment gets frames in proportion to the angle it turns through, picked
 * for an even speed, then everything is joined at one frame rate. The last
 * segment ends on the front photo, which is where the clip begins, so that
 * frame is left out and the clip loops without a repeated frame.
 *
 * @param segments  MP4 buffers, in turn order
 * @param degrees   the angle each segment turns through
 * @returns the MP4 bytes
 */
async function assembleLoop(segments, { degrees, loopSeconds, fps, aspectRatio, width, height }) {
  return withFiles(segments, async (files, dir) => {
    // The loop's frames, shared out by angle — every frame of it is one step of the same turn.
    const total = Math.round(loopSeconds * fps);
    const turned = degrees.reduce((sum, angle) => sum + angle, 0);
    const counts = degrees.map((angle) => Math.floor((total * angle) / turned));
    for (let k = 0; k < total - counts.reduce((sum, n) => sum + n, 0); k++) counts[k % counts.length] += 1;

    const picks = await Promise.all(files.map(async (file, index) => evenFrames(await motionOf(file, aspectRatio), counts[index])));

    const chains = picks.map((indices, index) => {
      // Inside the quotes the commas are the expression's, not the filter graph's.
      const select = indices.map((n) => `eq(n,${n})`).join("+");
      return (
        `[${index}:v]select='${select}',setpts=N/(${fps}*TB),` +
        `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1[s${index}]`
      );
    });
    const join = `${picks.map((_, index) => `[s${index}]`).join("")}concat=n=${picks.length}:v=1:a=0,format=yuv420p[out]`;

    const out = path.join(dir, "turntable.mp4");
    await run(
      ffmpegPath,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        ...files.flatMap((file) => ["-i", file]),
        "-filter_complex",
        [...chains, join].join(";"),
        "-map",
        "[out]",
        "-r",
        String(fps),
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "17",
        "-movflags",
        "+faststart",
        "-an",
        out,
      ],
      { maxBuffer: 1 << 24 }
    );
    return fs.readFile(out);
  });
}

module.exports = {
  frameSize,
  framePhotos,
  planTurntable,
  turnJump,
  snapped,
  retraceScore,
  retraced,
  assembleLoop,
};
