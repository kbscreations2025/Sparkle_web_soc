const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { resolveProviderModel } = require("../aiRouting");
const { parseDataUri } = require("../generationService");
const { queueGeneration, parseImages } = require("./queueGeneration");
const { CLEANING_JOB } = require("../jobs/cleaning");
const { hasPermission } = require("../permissions");
const Asset = require("../models/asset");

const router = express.Router();

router.use(requireAuth, requirePermission("tool.cleaning.run"));

/** Which built-in prompt a first-pass run falls back to — see jobs/cleaning.js. */
const VARIANTS = ["default", "new"];

const isChecksum = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

/** One request can ask about a whole drop of photos, but not an unbounded one. */
const MAX_DUPLICATE_CHECKS = 50;

/**
 * Has anyone in this organization cleaned this photo before?
 *
 * Asked by the upload box before a photo joins the batch, so the person can
 * see it was already done — and by whom — before paying for it again. Only
 * ever a warning: the page still lets them go ahead.
 *
 * Each check carries two fingerprints, and either matching counts:
 *  - `sourceChecksum`, the original file — reliable across browsers, but only
 *    stored for uploads made since this existed;
 *  - `checksum`, the resized bytes actually uploaded — what every older
 *    upload has, and the same whenever the same browser resized it.
 *
 * Cleaning uploads only, and only completed runs: an input asset is written
 * when its generation is saved, so a failed or abandoned run never counts.
 *
 * Who used it is told to anyone who can clean here — the point is that a
 * colleague may already have done the work. Whether their chat is linked is a
 * separate question, answered by the same grant that lets History open a
 * colleague's chat.
 */
router.post("/duplicates", async (req, res) => {
  const { dbUser } = req;
  const checks = Array.isArray(req.body?.checks) ? req.body.checks.slice(0, MAX_DUPLICATE_CHECKS) : [];

  const wanted = new Set();
  const valid = checks
    .filter((check) => check && typeof check.id === "string")
    .map((check) => ({
      id: check.id,
      fingerprints: [check.sourceChecksum, check.checksum].filter(isChecksum),
    }))
    .filter((check) => check.fingerprints.length);
  valid.forEach((check) => check.fingerprints.forEach((value) => wanted.add(value)));

  if (!wanted.size) return res.json({ status: "success", matches: {} });

  const list = [...wanted];
  let assets;
  try {
    assets = await Asset.find({
      tenantId: dbUser.tenantId,
      tool: "cleaning",
      kind: "input",
      role: "uploaded",
      deletedAt: null,
      $or: [{ sourceChecksum: { $in: list } }, { checksum: { $in: list } }],
    })
      .sort({ _id: -1 })
      .limit(500)
      .select("userId userName conversationId generationId modelLabel checksum sourceChecksum createdAt")
      .lean();
  } catch (err) {
    // The page uploads anyway on a failed check — a warning that can't be
    // given must never be what stops someone working.
    console.error("cleaning duplicates check failed:", err.message);
    return res.status(500).json({ status: "error", message: "could not check for earlier uploads" });
  }

  const canOpenOthers = req.isSuperAdmin || hasPermission(dbUser, "org.conversations.read");
  const ownId = String(dbUser._id);

  const matches = {};
  for (const check of valid) {
    const hits = assets.filter(
      (asset) => check.fingerprints.includes(asset.sourceChecksum) || check.fingerprints.includes(asset.checksum)
    );
    if (!hits.length) continue;

    // Newest first, already: the most recent use is the one worth naming.
    const latest = hits[0];
    const isOwn = String(latest.userId) === ownId;
    const people = [...new Set(hits.map((hit) => hit.userName))];

    matches[check.id] = {
      times: hits.length,
      people,
      latest: {
        userName: latest.userName,
        isOwn,
        createdAt: latest.createdAt,
        // Which cleaning page reopens it — Default and High-Res share the
        // tool but not their models (see the frontend's workspacePathFor).
        modelLabel: latest.modelLabel ?? null,
        // Only where this reader may open it — see above.
        conversationId: isOwn || canOpenOthers ? String(latest.conversationId) : null,
      },
    };
  }

  return res.json({ status: "success", matches });
});

/**
 * Accepts a cleaning run and hands it to the queue.
 *
 * Everything cheap and certain still happens here — a malformed request is
 * refused immediately with a 400 rather than becoming a job that exists only
 * to fail. What used to happen next (call the model, wait 30–150s, save the
 * result) now happens in a worker, so this answers in milliseconds with an id
 * the client can follow.
 *
 * That id is the whole point: the browser can reload, navigate away or lose
 * its connection, and the work carries on. The page finds it again by asking
 * GET /api/jobs, not by remembering anything.
 *
 * The image bytes go to Redis with the job rather than into the job document —
 * see models/job.js for why.
 */
router.post("/", async (req, res) => {
  const { dbUser } = req;
  const {
    image,
    model: requestedModel,
    customPrompt,
    refineImage,
    instruction,
    referenceImages,
    conversationId,
    parentGenerationId,
    preview,
    variant,
    annotated,
    sourceChecksum,
  } = req.body || {};

  const isRefinement = Boolean(refineImage && instruction);
  const sourceImage = isRefinement ? refineImage : image;
  // Unknown or absent falls back to "default" rather than refusing the
  // request — the same behaviour as the job's own BUILT_IN_PROMPTS lookup.
  const resolvedVariant = VARIANTS.includes(variant) ? variant : "default";

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
  const parsedReferences = parseImages(referenceImages);

  // Resolved here as well as in the handler: the handler needs it to run, and
  // this copy is what the queue panel shows while the job is still waiting.
  const { provider, model, modelLabel, quality } = resolveProviderModel(requestedModel);

  return queueGeneration(req, res, {
    type: CLEANING_JOB,
    tool: "cleaning",
    preview,
    // Display/audit description of the run. No image bytes.
    request: {
      provider,
      model,
      modelLabel,
      quality,
      isRefinement,
      instruction: isRefinement ? instruction : null,
      customPrompt: customPrompt?.trim() || null,
      variant: isRefinement ? null : resolvedVariant,
      referenceCount: parsedReferences.length,
      conversationId: conversationId || null,
    },
    // What the handler actually needs, images included.
    payload: {
      image: parsed,
      references: parsedReferences,
      requestedModel,
      isRefinement,
      instruction,
      // The image to refine carries the user's marks — see jobs/cleaning.js.
      annotated: isRefinement && Boolean(annotated),
      customPrompt,
      variant: resolvedVariant,
      conversationId,
      parentGenerationId,
      // Only a well-formed one is kept: it is matched against later, so junk
      // here would only ever produce false matches.
      sourceChecksum: !isRefinement && isChecksum(sourceChecksum) ? sourceChecksum : null,
    },
    message: `queued a cleaning ${isRefinement ? "refinement" : "run"} on ${modelLabel}`,
  });
});

module.exports = router;
