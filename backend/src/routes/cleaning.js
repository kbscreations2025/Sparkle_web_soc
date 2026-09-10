const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { IMAGE_CLEANING_PROMPT, buildReferenceNote } = require("../prompts");
const { resolveProviderModel, routeProviderCall, loadTenantOrThrow, sendGenerationError } = require("../aiRouting");
const { recordGeneration, parseDataUri } = require("../generationService");
const { logAudit, requestMeta, actorFrom } = require("../auditLog");

const router = express.Router();

router.use(requireAuth, requirePermission("tool.cleaning.run"));

/**
 * A first-pass run sends the built-in prompt unless the user wrote their own,
 * which replaces it entirely rather than being appended to it — the wording
 * that preserves the jewellery's exact design lives only in the built-in
 * prompt, so "replace" (not "add to") is deliberate: mixing the two would let
 * a custom prompt silently fight the preservation instructions.
 *
 * A refinement is never the raw instruction either — it's wrapped so the
 * model is told which image it's editing and what to leave alone. Any
 * reference images ride along as visual inspiration only, same as Chat to
 * Edit — never something to copy into the result wholesale.
 */
function buildPrompt({ isRefinement, instruction, customPrompt, referenceCount = 0 }) {
  if (isRefinement) {
    return (
      `Modify this jewelry photograph (the first image) as follows: ${instruction}. ` +
      "Preserve the pure white studio background, professional lighting, and all other " +
      "photographic qualities. Only apply the specifically requested changes." +
      buildReferenceNote(referenceCount)
    );
  }
  return customPrompt?.trim() || IMAGE_CLEANING_PROMPT;
}

router.post("/", async (req, res) => {
  // Hoisted so the catch block below can report the failure through the
  // right provider's error classifier even if the failure happened after
  // the model was resolved but before anything else was assigned.
  let provider = "gemini";
  try {
    const { dbUser } = req;
    const {
      image,
      model: requestedModel,
      customPrompt,
      refineImage,
      instruction,
      referenceImages,
      conversationId: requestedConversationId,
      parentGenerationId,
    } = req.body || {};

    const isRefinement = Boolean(refineImage && instruction);
    const sourceImage = isRefinement ? refineImage : image;
    const resolved = resolveProviderModel(requestedModel);
    provider = resolved.provider;
    const { model, quality, modelLabel } = resolved;

    if (!sourceImage) {
      return res.status(400).json({ status: "error", message: "no image provided", code: "invalid" });
    }

    const parsed = parseDataUri(sourceImage);
    if (!parsed) {
      return res.status(400).json({ status: "error", message: "image must be a data URI", code: "invalid" });
    }

    // Invalid entries are dropped rather than rejecting the whole request —
    // references are inspiration, not required inputs, so one bad one
    // shouldn't sink an otherwise-good refinement.
    const parsedReferences = Array.isArray(referenceImages) ? referenceImages.map(parseDataUri).filter(Boolean) : [];

    const tenant = await loadTenantOrThrow(dbUser);

    const prompt = buildPrompt({ isRefinement, instruction, customPrompt, referenceCount: parsedReferences.length });

    const { output, providerId } = await routeProviderCall({
      tenant,
      provider,
      modelId: model,
      prompt,
      images: [
        { mimeType: parsed.mimeType, base64: parsed.base64 },
        ...parsedReferences.map((ref) => ({ mimeType: ref.mimeType, base64: ref.base64 })),
      ],
    });

    // Persistence never lets a history-writing failure cost the user their image.
    let conversationId = null;
    let generationId = null;
    try {
      const saved = await recordGeneration({
        tenant,
        user: dbUser,
        tool: "cleaning",
        conversationId: requestedConversationId,
        parentGenerationId,
        model,
        modelLabel,
        quality,
        prompt,
        userPrompt: isRefinement ? instruction : customPrompt?.trim() || null,
        inputImages: [
          { image: parsed, role: isRefinement ? "edited" : "uploaded" },
          ...parsedReferences.map((ref) => ({ image: ref, role: "reference" })),
        ],
        outputImages: [{ image: output, role: "generated" }],
        providerId,
        provider,
      });
      conversationId = saved.conversationId;
      generationId = saved.generationId;
    } catch (err) {
      console.error("cleaning: could not record generation history:", err);
    }

    res.json({
      status: "success",
      result: `data:${output.mimeType};base64,${output.base64}`,
      model,
      conversationId,
      generationId,
    });
  } catch (err) {
    logAudit({
      ...actorFrom(req),
      ...requestMeta(req),
      tenantId: req.dbUser?.tenantId || null,
      action: "generation.failed",
      status: "failure",
      targetType: "generation",
      message: err.message || "generation failed",
      metadata: { tool: "cleaning", provider, requestedModel: req.body?.model || null },
    });
    sendGenerationError(res, err, "cleaning", provider);
  }
});

module.exports = router;
