const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { buildChatEditPrompt } = require("../prompts");
const { resolveModel, qualityFor, labelFor } = require("../gemini");
const { routeGeminiCall, loadTenantOrThrow, sendGenerationError } = require("../aiRouting");
const { recordGeneration, parseDataUri, isOwnConversation } = require("../generationService");
const { logAudit, requestMeta, actorFrom } = require("../auditLog");
const credit = require("../services/credits");

const router = express.Router();

router.use(requireAuth, requirePermission("tool.chat_to_edit.run"));

/**
 * One turn of a chat-style edit: a base image, any number of reference
 * images (visual inspiration only), and a free-form instruction. Unlike
 * Image Cleaning there's no "default" prompt — every turn is instruction-
 * driven, so `instruction` is required.
 *
 * Uses the same three Gemini models as Image Cleaning (see gemini.js) rather
 * than a separate model map: the reference app this was ported from mapped
 * the same display label to a different real model per tool, which meant
 * picking "Sparkle 2.5 Flash" meant something different depending which tool
 * you were in. One shared map avoids reproducing that.
 */
router.post("/", async (req, res) => {
  try {
    const { dbUser } = req;
    const {
      image,
      referenceImages,
      instruction,
      displayPrompt,
      model: requestedModel,
      quality: requestedQuality,
      conversationId: requestedConversationId,
      parentGenerationId,
    } = req.body || {};

    if (!instruction?.trim()) {
      return res.status(400).json({ status: "error", message: "instruction is required", code: "invalid" });
    }

    // Before anything is charged — see isOwnConversation.
    if (!(await isOwnConversation(dbUser, requestedConversationId))) {
      return res.status(403).json({
        status: "error",
        message: "This chat belongs to someone else — you can view it but not continue it.",
        code: "forbidden",
      });
    }

    const parsedBase = parseDataUri(image);
    if (!parsedBase) {
      return res.status(400).json({ status: "error", message: "image must be a data URI", code: "invalid" });
    }

    // Invalid entries are dropped rather than rejecting the whole request —
    // references are inspiration, not required inputs, so one bad one
    // shouldn't sink an otherwise-good edit.
    const parsedReferences = Array.isArray(referenceImages) ? referenceImages.map(parseDataUri).filter(Boolean) : [];

    const model = resolveModel(requestedModel);
    const quality = qualityFor(model, requestedQuality);

    const tenant = await loadTenantOrThrow(dbUser);

    const prompt = buildChatEditPrompt(instruction.trim(), parsedReferences.length);

    /*
     * Charged like every other tool.
     *
     * This is the one generation route that answers synchronously and never
     * goes through queueGeneration, which is where the credit hold lives —
     * so it was producing images for free while the same Gemini models cost
     * credits through Image Cleaning. Held here, then settled or released
     * around the provider call.
     */
    const priced = await credit.quote({
      tenantId: dbUser.tenantId,
      tool: "chat_to_edit",
      modelId: model,
      quality,
      count: 1,
    });

    let held = null;
    if (priced) {
      try {
        held = await credit.holdForRun({
          tenantId: dbUser.tenantId,
          userId: dbUser._id,
          userName: dbUser.name || dbUser.email,
          tool: "chat_to_edit",
          priced,
          jobHint: `sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        });
        held = { ...held, tenantId: dbUser.tenantId, userId: dbUser._id, tool: "chat_to_edit" };
      } catch (err) {
        if (err.code === "insufficient_credits") {
          return res.status(402).json({
            status: "error",
            message: `This edit costs ${err.required} credits and you have ${err.available}.`,
            code: "insufficient_credits",
            required: err.required,
            available: err.available,
          });
        }
        throw err;
      }
    }

    let output;
    let providerId;
    try {
      ({ output, providerId } = await routeGeminiCall({
        tenant,
        modelId: model,
        prompt,
        quality,
        images: [
          { mimeType: parsedBase.mimeType, base64: parsedBase.base64 },
          ...parsedReferences.map((ref) => ({ mimeType: ref.mimeType, base64: ref.base64 })),
        ],
      }));
    } catch (err) {
      // Nothing was produced, so nothing is owed.
      if (held?.held) {
        await credit
          .refundRun({ credits: held, jobId: null, reason: "chat-to-edit failed" })
          .catch((e) => console.error("chat-to-edit: could not release the hold:", e.message));
      }
      throw err;
    }

    let conversationId = null;
    let generationId = null;
    try {
      const saved = await recordGeneration({
        tenant,
        user: dbUser,
        tool: "chat_to_edit",
        conversationId: requestedConversationId,
        parentGenerationId,
        model,
        modelLabel: labelFor(model),
        quality,
        prompt,
        // Shown in the UI/history, kept separate from `prompt` so the
        // anatomy/scale boilerplate never leaks into what the user sees.
        userPrompt: displayPrompt?.trim() || instruction.trim(),
        inputImages: [
          // A base image on a follow-up turn is a prior result being edited
          // again, not a fresh upload — the role records which happened.
          { image: parsedBase, role: parentGenerationId ? "edited" : "uploaded" },
          ...parsedReferences.map((ref) => ({ image: ref, role: "reference" })),
        ],
        outputImages: [{ image: output, role: "generated" }],
        providerId,
      });
      conversationId = saved.conversationId;
      generationId = saved.generationId;
    } catch (err) {
      console.error("chat-to-edit: could not record generation history:", err);
    }

    // One image, delivered. Settled after the call rather than before, so a
    // provider failure costs nothing — and outside the history try/catch,
    // because the image exists whether or not the record was written.
    if (held?.held) {
      await credit
        .settleRun({ credits: held, jobId: null, generationId, deliveredUnits: 1 })
        .catch((err) => console.error("chat-to-edit: could not settle credits:", err.message));
    }

    res.json({
      status: "success",
      images: [`data:${output.mimeType};base64,${output.base64}`],
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
      metadata: { tool: "chat_to_edit", provider: "gemini", requestedModel: req.body?.model || null },
    });
    sendGenerationError(res, err, "chat-to-edit");
  }
});

module.exports = router;
