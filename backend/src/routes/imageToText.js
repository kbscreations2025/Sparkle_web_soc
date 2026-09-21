const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { parseDataUri } = require("../generationService");
const { queueGeneration } = require("./queueGeneration");
const { IMAGE_TO_TEXT_JOB } = require("../jobs/imageToText");

const router = express.Router();

router.use(requireAuth, requirePermission("tool.image_to_text.run"));

/**
 * Reads one jewellery photograph back as the prompt that would recreate it.
 *
 * Queued like every other tool even though it only takes a few tens of
 * seconds: the value of the queue here isn't the wait, it's that a reload
 * doesn't lose the answer.
 */
router.post("/", async (req, res) => {
  const { image, preview, conversationId } = req.body || {};

  const parsed = parseDataUri(image);
  if (!parsed) {
    return res.status(400).json({ status: "error", message: "an image is required", code: "invalid" });
  }

  return queueGeneration(req, res, {
    type: IMAGE_TO_TEXT_JOB,
    tool: "image_to_text",
    // The model isn't the user's to pick here, but it is recorded: the
    // duration estimator samples by model, and a future change of model
    // shouldn't be averaged against this one's history.
    request: { provider: "gemini", model: "gemini-2.5-pro", modelLabel: "Sparkle 2.5 Pro" },
    payload: { image: parsed, conversationId: conversationId || null },
    preview,
    message: "queued an image-to-text analysis",
  });
});

module.exports = router;
