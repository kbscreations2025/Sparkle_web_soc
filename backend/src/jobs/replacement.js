const { registerJobHandler } = require("./registry");
const { runGenerationJob } = require("./generationRunner");
const { loadTenantOrThrow } = require("../aiRouting");
const { segmentPiece } = require("../services/segmentation");
const { decodeImage, prepareForModel, compositeIntoPhoto, exposedError } = require("../services/photoComposite");
const { buildReplacePrompt, buildChangePrompt } = require("../prompts/replacement");
const User = require("../models/user");

const REPLACEMENT_JOB = "replacement.generate";

/**
 * Replacement (an Image Cleaning card): the jewellery in a photo of someone
 * wearing it, swapped for another piece — and nothing else about the photo
 * changed.
 *
 * Two kinds of turn, both one image:
 *  - "replace": the photo as uploaded, the new piece (a product shot, a
 *    description, or both), and optionally a change typed in the chat on
 *    the original photo.
 *  - "change": a follow-up on a result. The result is what the model edits,
 *    but the original photo is still what the answer is put back into, so
 *    colour can't drift from one turn to the next.
 *
 * Either way the model's answer is only used where the jewellery is — the old
 * piece's outline and the new one's — and every other pixel is the photo's
 * own (services/photoComposite.js).
 *
 * The images ride in `sourceImages` exactly as History records them: the
 * photo (or, for a change, the result being changed) first, then the new
 * piece's product shot when there is one, then anything attached in the chat.
 * A change also carries the original photo as `photo`.
 */
registerJobHandler(REPLACEMENT_JOB, async (context) => {
  const { job, data, withProgress } = context;
  const dbUser = await User.findById(job.userId);
  if (!dbUser) throw new Error("the user who queued this job no longer exists");
  const tenant = await loadTenantOrThrow(dbUser);

  const isChange = data.turn === "change";
  const original = isChange ? data.photo : data.sourceImages[0];
  const piece = data.hasPiece ? data.sourceImages[1] : null;
  const references = isChange ? data.sourceImages.slice(data.hasPiece ? 2 : 1) : [];

  const photo = await decodeImage(original);
  const { frame, send } = await prepareForModel(isChange ? await decodeImage(data.sourceImages[0]) : photo);

  // Where the piece being replaced is. Without it there is no telling the old
  // piece from the photo around it, so the run stops here — before anything
  // is generated.
  const oldMask = await withProgress({ from: 5, to: 18, phase: "analysing" }, async ({ stepDone }) => {
    const mask = await segmentPiece({ tenant, buffer: Buffer.from(original.base64, "base64"), boxes: true });
    await stepDone(null);
    return mask;
  });
  if (!oldMask) {
    throw exposedError("Couldn't find the jewellery in this photo — try one where the piece is clearly visible.", "not_found");
  }

  const prompt = isChange
    ? buildChangePrompt({
        category: data.category,
        description: data.description,
        hasPiece: Boolean(piece),
        change: data.change,
        referenceCount: references.length,
      })
    : buildReplacePrompt({
        category: data.category,
        size: data.size,
        description: data.description,
        hasPiece: Boolean(piece),
        change: data.change,
      });

  const finish = async (answer) => {
    const { output, match, outlinedNew } = await compositeIntoPhoto({
      photo,
      frame,
      answer,
      oldMask,
      outline: (buffer) => segmentPiece({ tenant, buffer, boxes: true }),
    });
    console.log(`[replacement] composited job ${job._id}: match ${match.toFixed(3)}, new piece ${outlinedNew ? "outlined" : "not outlined"}`);
    return output;
  };

  return runGenerationJob({
    ...context,
    // The model is asked for the frame the photo was padded to, so its answer can be cropped back.
    data: { ...data, aspectRatio: frame.aspectRatio },
    tool: "cleaning",
    params: { mode: "replacement", category: data.category, size: data.size || null, description: data.description || null },
    buildShots: () => [{ prompt, images: [send, ...(piece ? [piece] : []), ...references] }],
    finishImage: async ({ output, regenerate }) => {
      try {
        return await finish(output);
      } catch (err) {
        // The model moved what it was meant to leave alone. Once more, then say so.
        if (err.code !== "misaligned") throw err;
        console.warn(`[replacement] job ${job._id}: answer didn't line up with the photo, asking again`);
        return finish(await regenerate());
      }
    },
  });
});

module.exports = { REPLACEMENT_JOB };
