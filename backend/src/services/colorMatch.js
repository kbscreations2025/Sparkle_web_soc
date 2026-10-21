const sharp = require("sharp");

/**
 * Pulls an edited image's overall colour back to the photo it was edited
 * from.
 *
 * An edit is a full redraw, not a patch, and image models drift the white
 * balance as they redraw — in Lifestyle, every "make it smaller" turn came
 * back a little pinker and redder than the last, and a prompt asking them not
 * to did not stop it. So the colour is fixed after the fact: each channel of
 * the edit gets the mean and spread of the same channel in the source photo.
 *
 * An edit changes a small part of the picture (a piece's size, a hand's pose),
 * so the photo's overall colour statistics should barely move — any large
 * shift is drift, not the requested change. The gain is clamped so a real
 * change of content is never stretched into something garish.
 */

const MIN_GAIN = 0.85;
const MAX_GAIN = 1.18;
/** Below this difference in any channel's mean (0–255) nothing is touched. */
const MIN_DRIFT = 1.5;

/** Edits that ask for a colour or light change, where matching would undo it. */
const COLOUR_REQUEST =
  /\b(colou?r|tone|tint|warm|cool|bright|dark|light|lighting|saturat|contrast|exposure|grade|grading|hue|sepia|black and white|b&w|monochrome|vibrant|moody|golden hour|sunset|night|evening|background)/i;

function wantsColourChange(instruction) {
  return COLOUR_REQUEST.test(String(instruction || ""));
}

/**
 * @param output    `{ mimeType, base64 }` the model returned
 * @param reference `{ mimeType, base64 }` the photo that was edited
 * @returns the corrected output, or `output` unchanged when there is no drift
 *          worth fixing or the images can't be read
 */
async function matchColour(output, reference) {
  try {
    const outBuf = Buffer.from(output.base64, "base64");
    const [outStats, refStats] = await Promise.all([
      sharp(outBuf).removeAlpha().stats(),
      sharp(Buffer.from(reference.base64, "base64")).removeAlpha().stats(),
    ]);

    const channels = [0, 1, 2].map((index) => {
      const out = outStats.channels[index];
      const ref = refStats.channels[index];
      const gain = Math.min(MAX_GAIN, Math.max(MIN_GAIN, out.stdev > 1 ? ref.stdev / out.stdev : 1));
      return { gain, offset: ref.mean - gain * out.mean, drift: Math.abs(ref.mean - out.mean) };
    });
    if (channels.every((channel) => channel.drift < MIN_DRIFT)) return output;

    let pipeline = sharp(outBuf)
      .removeAlpha()
      .linear(
        channels.map((channel) => channel.gain),
        channels.map((channel) => channel.offset)
      );
    const isPng = output.mimeType === "image/png";
    pipeline = isPng ? pipeline.png() : pipeline.jpeg({ quality: 95 });
    const corrected = await pipeline.toBuffer();

    return { ...output, mimeType: isPng ? "image/png" : "image/jpeg", base64: corrected.toString("base64") };
  } catch (err) {
    // A colour fix is a nicety; an image the edit already produced is never lost to it.
    console.error("[color-match] could not match colour:", err.message);
    return output;
  }
}

module.exports = { matchColour, wantsColourChange };
