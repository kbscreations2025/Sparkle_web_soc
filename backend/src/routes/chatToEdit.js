const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { resolveReferenceRoles, hasRoleTask, describeRoles } = require("../prompts/chatToEdit");
const { resolveIntent, intentForTool, refineCountFor, describeIntent } = require("../prompts/intent");
const { resolveProviderModel, loadTenantOrThrow, sendGenerationError } = require("../aiRouting");
const { parseDataUri } = require("../generationService");
const { logRequestAudit } = require("../auditLog");
const { queueGeneration } = require("./queueGeneration");
const { CHAT_TO_EDIT_JOB } = require("../jobs/chatToEdit");

const router = express.Router();

router.use(requireAuth, requirePermission("tool.chat_to_edit.run"));

/**
 * One turn of a chat-style edit: a base image, any number of reference
 * images (visual inspiration only), and a free-form instruction. Unlike
 * Image Cleaning there's no "default" prompt — every turn is instruction-
 * driven, so `instruction` is required.
 *
 * Uses the same Gemini models as Image Cleaning, plus its own OpenAI option
 * (see frontend/lib/api.ts's CHAT_TO_EDIT_MODELS) — one shared map per model
 * id rather than a separate one per tool, the same reasoning that keeps
 * "Sparkle 2.5 Flash" meaning the same real model everywhere it's offered.
 * `resolveProviderModel` is what tells a Gemini id from an OpenAI one; this
 * route no longer assumes every request is Gemini's.
 *
 * Queued like every other image tool (see jobs/chatToEdit.js): this checks
 * the request, reads what the turn asks for — "more designs" is several
 * images and is priced as several — and answers at once with the job. The
 * edit itself runs in the worker, so it shows in the queue rail with progress
 * and survives a reload. It used to run here while the browser waited, the
 * one image route that did. Ownership of the conversation and the credit
 * hold are queueGeneration's, as for every other tool.
 */
router.post("/", async (req, res) => {
  // Read in the catch's audit log below — declared here, not destructured
  // from `resolveProviderModel`'s result, so a failure before that line runs
  // still has a provider to report instead of hitting the TDZ on a `const`
  // that was never reached.
  let resolvedProvider = "gemini";
  try {
    const { dbUser } = req;
    const {
      image,
      referenceImages,
      // One per reference image: what it is for (see REFERENCE_ROLES).
      referenceRoles,
      instruction,
      displayPrompt,
      model: requestedModel,
      quality: requestedQuality,
      conversationId: requestedConversationId,
      parentGenerationId,
      // Small thumbnail for the queue rail — see queueGeneration's safePreview.
      preview,
    } = req.body || {};

    if (!instruction?.trim()) {
      return res.status(400).json({ status: "error", message: "instruction is required", code: "invalid" });
    }

    const parsedBase = parseDataUri(image);
    if (!parsedBase) {
      return res.status(400).json({ status: "error", message: "image must be a data URI", code: "invalid" });
    }

    // Invalid entries are dropped rather than rejecting the whole request —
    // one bad attachment shouldn't sink an otherwise-good edit. Each keeps the
    // role sent for it, so dropping one never shifts the roles of the rest.
    const attached = (Array.isArray(referenceImages) ? referenceImages : [])
      .map((value, index) => ({ image: parseDataUri(value), role: Array.isArray(referenceRoles) ? referenceRoles[index] : null }))
      .filter((entry) => entry.image);
    const roles = resolveReferenceRoles(
      attached.map((entry) => entry.role),
      attached.length,
      instruction.trim()
    );
    const references = attached.map((entry, index) => ({ image: entry.image, role: roles[index] }));

    const { provider, model, quality, modelLabel } = resolveProviderModel(requestedModel, requestedQuality);
    resolvedProvider = provider;

    /*
     * What the turn asks for, read now because it sets the price: "more
     * designs" makes several images. A turn whose attachments have a job is
     * one precise edit, and its roles already say what it is. Failing to read
     * it is never a reason to refuse the edit — it runs as a plain one.
     */
    let intent = null;
    let count = 1;
    let intentLabel = null;
    if (hasRoleTask(roles)) {
      intentLabel = describeRoles(roles);
    } else {
      try {
        const tenant = await loadTenantOrThrow(dbUser);
        intent = intentForTool(await resolveIntent(instruction.trim(), { tenant }), "chat_to_edit");
        count = refineCountFor(intent, "chat_to_edit");
        intentLabel = describeIntent(intent, "chat_to_edit", count);
      } catch (err) {
        console.warn("chat-to-edit: could not read the turn's intent — running it as a plain edit:", err.message);
      }
    }

    return queueGeneration(req, res, {
      type: CHAT_TO_EDIT_JOB,
      tool: "chat_to_edit",
      preview,
      // Display/audit description of the run. No image bytes.
      request: {
        provider,
        model,
        modelLabel,
        quality,
        instruction: (displayPrompt || instruction).trim(),
        referenceCount: references.length,
        count,
        intentLabel,
        conversationId: requestedConversationId || null,
      },
      // What the worker needs, images included.
      payload: {
        image: parsedBase,
        references,
        instruction: instruction.trim(),
        displayPrompt,
        requestedModel,
        requestedQuality,
        conversationId: requestedConversationId || null,
        parentGenerationId: parentGenerationId || null,
        intent,
        count,
        intentLabel,
      },
      message: `queued a chat-to-edit turn on ${modelLabel}`,
    });
  } catch (err) {
    logRequestAudit(req, {
      tenantId: req.dbUser?.tenantId || null,
      action: "generation.failed",
      status: "failure",
      targetType: "generation",
      message: err.message || "generation failed",
      metadata: { tool: "chat_to_edit", provider: resolvedProvider, requestedModel: req.body?.model || null },
    });
    sendGenerationError(res, err, "chat-to-edit", resolvedProvider);
  }
});

module.exports = router;
