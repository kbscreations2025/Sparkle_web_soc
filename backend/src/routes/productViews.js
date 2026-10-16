const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { resolveProviderModel } = require("../aiRouting");
const { PRODUCT_VIEWS_JOB } = require("../jobs/productViews");
const { CATEGORIES, CATEGORY_IDS, VIEW_BY_ID, viewIdsFor } = require("../prompts/productViews");
const { queueGeneration, parseImages } = require("./queueGeneration");

/**
 * Product Views — a card on Image Cleaning, so it runs under that tool's grant,
 * pricing and history: the standard angles of one piece.
 *
 * The person says what kind of piece it is (each kind has its own angles),
 * puts each photo they have into the box for its angle, and the angles without
 * one are generated, one image each — so only what is missing costs anything.
 */

const router = express.Router();
router.use(requireAuth, requirePermission("tool.cleaning.run"));

router.post("/", async (req, res) => {
  const body = req.body || {};
  const category = CATEGORY_IDS.includes(body.category) ? body.category : "ring";
  const categoryViews = viewIdsFor(category);

  // `photos` is `[{ view, image }]` — each photo with the angle it was placed as.
  const given = (Array.isArray(body.photos) ? body.photos : [])
    .filter((entry) => categoryViews.includes(entry?.view))
    .map((entry) => ({ view: entry.view, image: parseImages(entry.image)[0] }))
    .filter((entry) => entry.image);
  const photoViews = [...new Set(given.map((entry) => entry.view))];
  const photos = photoViews.map((view) => given.find((entry) => entry.view === view).image);

  // A run needs a photo that shows enough of the piece to rebuild it from.
  const { keyViews } = CATEGORIES[category];
  if (!photoViews.some((view) => keyViews.includes(view))) {
    const names = keyViews.map((view) => VIEW_BY_ID.get(view).label.toLowerCase()).join(" or ");
    return res.status(400).json({ status: "error", message: `add a ${names} photo of the piece`, code: "invalid" });
  }

  const views = [...new Set(Array.isArray(body.views) ? body.views : [])].filter(
    (view) => categoryViews.includes(view) && !photoViews.includes(view)
  );
  if (!views.length) {
    return res.status(400).json({ status: "error", message: "every view already has a photo — nothing to generate", code: "invalid" });
  }

  const { provider, model, modelLabel, quality } = resolveProviderModel(body.model, body.quality);
  const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 600) : "";
  const labels = views.map((view) => VIEW_BY_ID.get(view).label.toLowerCase()).join(", ");

  return queueGeneration(req, res, {
    type: PRODUCT_VIEWS_JOB,
    tool: "cleaning",
    preview: body.preview,
    // One image per view, and priced as that many.
    request: { provider, model, modelLabel, quality, isRefinement: false, mode: "product_views", category, views, count: views.length },
    payload: {
      isRefinement: false,
      requestedModel: body.model,
      requestedQuality: body.quality,
      category,
      views,
      photoViews,
      count: views.length,
      notes,
      aspectRatio: "1:1",
      userPrompt: `Product views: ${labels}${notes ? ` — ${notes}` : ""}`,
      sourceImages: photos,
      conversationId: body.conversationId || null,
    },
    message: `queued ${category} product views (${labels}) on ${modelLabel}`,
  });
});

module.exports = router;
