const express = require("express");
const { requireAuth, requireAnyPermission } = require("../middleware/auth");
const { DesignError } = require("../services/lookbookDesign");
const lookbooks = require("../services/lookbooks");

/**
 * Live Lookbook's builder: the owner's own pages, as plain REST. Each page is
 * an editable document, not a queued run, and costs no credits.
 *
 * Its own grant, `tool.live_lookbook.run`, or Marketing Kit's. Live Lookbook
 * grew out of the marketing tools, and everyone who already makes kits can
 * build a page for them without waiting on an admin. Someone with neither
 * gets nothing. The public read is a separate router (publicLookbooks.js).
 */
const LOOKBOOK_GRANTS = ["tool.live_lookbook.run", "tool.marketing_kit.run"];

const router = express.Router();
router.use(requireAuth, requireAnyPermission(LOOKBOOK_GRANTS));

/**
 * Express 4 doesn't catch a rejected handler, so every route goes through
 * here, which answers in the usual `{ status, message, code }` shape.
 */
const run = (fn) => (req, res) => {
  fn(req, res).catch((err) => {
    if (err instanceof lookbooks.LookbookError) {
      return res.status(err.status).json({ status: "error", code: err.code, message: err.message, ...err.extra });
    }
    if (err instanceof DesignError) {
      const status = err.code === "design_too_large" ? 413 : 400;
      return res.status(status).json({ status: "error", code: err.code, message: err.message });
    }
    console.error(`[lookbook] ${req.method} ${req.originalUrl} failed:`, err);
    return res.status(500).json({ status: "error", code: "server_error", message: "Something went wrong. Please try again." });
  });
};

router.get(
  "/",
  run(async (req, res) => {
    res.json({ status: "success", lookbooks: await lookbooks.listLookbooks({ dbUser: req.dbUser }) });
  })
);

router.post(
  "/",
  run(async (req, res) => {
    const lookbook = await lookbooks.createLookbook({ dbUser: req.dbUser, title: req.body?.title, design: req.body?.design });
    res.status(201).json({ status: "success", lookbook });
  })
);

/** Is this link name free? Asked as the person types, so it reads and never claims. */
router.get(
  "/slug-check",
  run(async (req, res) => {
    const result = await lookbooks.checkSlug({ slug: req.query.slug, lookbookId: req.query.id || null });
    res.json({ status: "success", ...result });
  })
);

/** The person's Image to Video results, for the Turntable card. */
router.get(
  "/videos",
  run(async (req, res) => {
    res.json({ status: "success", ...(await lookbooks.listVideos({ dbUser: req.dbUser, before: req.query.before, limit: req.query.limit })) });
  })
);

router.get(
  "/:id",
  run(async (req, res) => {
    res.json({ status: "success", lookbook: await lookbooks.getLookbook({ dbUser: req.dbUser, id: req.params.id }) });
  })
);

/** The builder's autosave: `{ title?, design? (a JSON string), revision }`. */
router.patch(
  "/:id",
  run(async (req, res) => {
    const lookbook = await lookbooks.saveLookbook({ dbUser: req.dbUser, id: req.params.id, changes: req.body || {} });
    res.json({ status: "success", lookbook });
  })
);

router.post(
  "/:id/slug",
  run(async (req, res) => {
    const result = await lookbooks.renameSlug({ dbUser: req.dbUser, id: req.params.id, slug: req.body?.slug });
    res.json({ status: "success", ...result });
  })
);

router.post(
  "/:id/publish",
  run(async (req, res) => {
    res.json({ status: "success", lookbook: await lookbooks.publishLookbook({ dbUser: req.dbUser, id: req.params.id }) });
  })
);

router.post(
  "/:id/unpublish",
  run(async (req, res) => {
    res.json({ status: "success", lookbook: await lookbooks.unpublishLookbook({ dbUser: req.dbUser, id: req.params.id }) });
  })
);

router.post(
  "/:id/duplicate",
  run(async (req, res) => {
    const lookbook = await lookbooks.duplicateLookbook({ dbUser: req.dbUser, id: req.params.id });
    res.status(201).json({ status: "success", lookbook });
  })
);

/** One photo or clip from the person's device: `{ file }`, sent as a multipart file part. */
router.post(
  "/:id/media",
  run(async (req, res) => {
    const media = await lookbooks.uploadMedia({ dbUser: req.dbUser, id: req.params.id, file: req.body?.file });
    res.status(201).json({ status: "success", media });
  })
);

router.delete(
  "/:id",
  run(async (req, res) => {
    res.json({ status: "success", ...(await lookbooks.deleteLookbook({ dbUser: req.dbUser, id: req.params.id })) });
  })
);

module.exports = router;
module.exports.LOOKBOOK_GRANTS = LOOKBOOK_GRANTS;
