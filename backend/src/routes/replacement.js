const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { resolveProviderModel } = require("../aiRouting");
const { REPLACEMENT_JOB } = require("../jobs/replacement");
const { CATEGORIES, CATEGORY_IDS, SIZE_IDS } = require("../prompts/replacement");
const { queueGeneration, parseImages } = require("./queueGeneration");

/**
 * Replacement — a card on Image Cleaning, so it runs under that tool's grant,
 * pricing and history: the jewellery in a photo of someone wearing it,
 * swapped for another piece, the rest of the photo left exactly as it was.
 *
 * A first turn is the photo plus the new piece — its product shot, a
 * description, or both. A follow-up typed in the chat sends `change`: the
 * result being changed and what to change, alongside the same photo and
 * piece, since the photo is what every answer is put back into.
 */

const router = express.Router();
router.use(requireAuth, requirePermission("tool.cleaning.run"));

/**
 * Gemini only. The answer is lined up with the photo by asking for the frame
 * it was padded to, which Gemini honours; anything else falls back to this.
 */
const FALLBACK_MODEL = "gemini-3-pro-image";

/** Images attached in the chat — inspiration for a change, bounded like any other. */
const MAX_REFERENCES = 4;

router.post("/", async (req, res) => {
  const body = req.body || {};

  const photo = parseImages(body.photo)[0];
  if (!photo) {
    return res.status(400).json({ status: "error", message: "add the photo to change", code: "invalid" });
  }
  const piece = parseImages(body.piece)[0] ?? null;
  const category = CATEGORY_IDS.includes(body.category) ? body.category : "ring";
  const size = SIZE_IDS.includes(body.size) ? body.size : null;
  const description = typeof body.description === "string" ? body.description.trim().slice(0, 600) : "";

  const change = body.change && typeof body.change === "object" ? body.change : null;
  const instruction = typeof change?.instruction === "string" ? change.instruction.trim().slice(0, 1000) : "";
  const isFollowUp = Boolean(instruction);
  // A change typed on the original photo (picked from the opening turn)
  // redoes the swap with it; on a result, it edits that result.
  const edited = isFollowUp && change.source !== "input" ? parseImages(change.image)[0] : null;
  if (isFollowUp && change.source !== "input" && !edited) {
    return res.status(400).json({ status: "error", message: "the image to change must be a data URI", code: "invalid" });
  }
  if (!isFollowUp && !piece && !description) {
    return res.status(400).json({ status: "error", message: "add a photo of the new piece, or describe it", code: "invalid" });
  }

  let resolved = resolveProviderModel(body.model, body.quality);
  if (resolved.provider !== "gemini") resolved = resolveProviderModel(FALLBACK_MODEL, body.quality);
  const { provider, model, modelLabel, quality } = resolved;

  const references = edited ? parseImages(change.references).slice(0, MAX_REFERENCES) : [];
  const sourceImages = [edited ?? photo, ...(piece ? [piece] : []), ...references];
  const pieceName = CATEGORIES[category].label;

  return queueGeneration(req, res, {
    type: REPLACEMENT_JOB,
    tool: "cleaning",
    preview: body.preview,
    request: {
      provider,
      model,
      modelLabel,
      quality,
      isRefinement: isFollowUp,
      instruction: isFollowUp ? instruction : null,
      mode: "replacement",
      category,
      count: 1,
      conversationId: body.conversationId || null,
    },
    payload: {
      // Every turn runs as a first-run shot with a prompt of its own, so the
      // runner's follow-up path (and the intent reading that comes with it)
      // never rewrites the replacement's wording. See jobs/replacement.js.
      isRefinement: false,
      turn: edited ? "change" : "replace",
      requestedModel: model,
      requestedQuality: quality,
      count: 1,
      category,
      size,
      description,
      change: instruction || null,
      hasPiece: Boolean(piece),
      sourceImages,
      sourceRoles: sourceImages.map((_, index) => (index === 0 ? (edited ? "edited" : "uploaded") : "reference")),
      ...(edited ? { photo } : {}),
      userPrompt: isFollowUp
        ? (typeof change.displayPrompt === "string" && change.displayPrompt.trim()) || instruction
        : `Replace the ${pieceName}${description ? ` — ${description}` : ""}`,
      conversationId: body.conversationId || null,
      parentGenerationId: isFollowUp ? body.parentGenerationId || null : null,
    },
    message: `queued a ${pieceName} replacement${isFollowUp ? " change" : ""} on ${modelLabel}`,
  });
});

module.exports = router;
