const express = require("express");
const { requireAuth, requireAnyPermission } = require("../middleware/auth");
const { loadTenantOrThrow } = require("../aiRouting");
const { getTrends, trendingOf } = require("../services/trends");
const { curatedTrends } = require("../prompts/jewelryTrends");

const router = express.Router();

// The trends feed the Jewelry Builder, which Text to Image and Text to Sketch
// share — either grant is enough.
router.use(requireAuth, requireAnyPermission(["tool.text_to_image.run", "tool.text_to_sketch.run"]));

const AUDIENCES = new Set(["women", "men", "general"]);
const TYPE_PATTERN = /^[A-Za-z][A-Za-z &'-]{0,39}$/;

/**
 * The builder's option lists, `{ key: [values] }`, bounded — they go into the
 * research prompt, and a trend's picks are checked against them.
 */
function readOptions(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const options = {};
  for (const [key, values] of Object.entries(raw).slice(0, 20)) {
    if (!/^[A-Za-z]{1,40}$/.test(key) || !Array.isArray(values)) continue;
    const clean = values.filter((value) => typeof value === "string" && value.trim() && value.length <= 60).slice(0, 80);
    if (clean.length) options[key] = clean;
  }
  return options;
}

/** The current trends for one audience and jewellery type. */
router.post("/", async (req, res) => {
  const audience = AUDIENCES.has(req.body?.audience) ? req.body.audience : "women";
  const type = typeof req.body?.type === "string" && TYPE_PATTERN.test(req.body.type.trim()) ? req.body.type.trim() : "Ring";

  try {
    const tenant = await loadTenantOrThrow(req.dbUser);
    res.json({ status: "success", ...(await getTrends({ tenant, audience, type, options: readOptions(req.body?.options) })) });
  } catch (err) {
    // Trends are a suggestion, never a reason the builder fails to load.
    console.error("trends: could not load:", err.message);
    const trends = curatedTrends(audience, type);
    res.json({ status: "success", trends, trending: trendingOf(trends, {}, null), source: "curated", period: null, refreshing: false });
  }
});

module.exports = router;
