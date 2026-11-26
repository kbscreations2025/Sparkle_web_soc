const express = require("express");
const { rateLimit } = require("../middleware/rateLimit");
const lookbooks = require("../services/lookbooks");

/**
 * The one way into a Live Lookbook without signing in: a published page by
 * its link name, read-only. Mounted on its own, ahead of every router that
 * applies requireAuth to the whole of /api (see server.js).
 *
 * Usually called by the frontend's server, which renders the page and keeps
 * each answer for a minute (frontend app/l/[slug]/page.tsx). A popular page
 * therefore costs one read a minute, not one per client.
 *
 * Two limits per address:
 *   · every read, generously. One address may be that frontend server,
 *     asking on behalf of everyone;
 *   · misses, much more tightly. Guessing at link names is all misses, and
 *     this is what makes it slow, without touching the reads of pages that
 *     exist.
 */
const router = express.Router();

const MINUTE = 60_000;
const MAX_MISSES = 60;

router.use(rateLimit({ windowMs: MINUTE, max: 600, key: (req) => `read:${req.ip}` }));

/** address → { count, resetAt }, for misses only. */
const misses = new Map();

function tooManyMisses(ip) {
  const entry = misses.get(ip);
  return Boolean(entry) && entry.resetAt > Date.now() && entry.count >= MAX_MISSES;
}

function countMiss(ip) {
  const now = Date.now();
  if (misses.size > 50_000) misses.clear();
  const entry = misses.get(ip);
  if (!entry || entry.resetAt <= now) misses.set(ip, { count: 1, resetAt: now + MINUTE });
  else entry.count += 1;
}

router.get("/:slug", async (req, res) => {
  // Never kept by a shared cache: taking a page down has to work at once.
  res.set("Cache-Control", "no-store");
  if (tooManyMisses(req.ip)) {
    res.set("Retry-After", "60");
    return res.status(429).json({ status: "error", code: "rate_limited", message: "Too many requests. Try again in a moment." });
  }
  try {
    const result = await lookbooks.readPublished(req.params.slug);
    if (!result) {
      countMiss(req.ip);
      return res.status(404).json({ status: "error", code: "not_found", message: "This page isn't available." });
    }
    if (result.redirect) return res.json({ status: "redirect", slug: result.redirect });
    return res.json({ status: "success", lookbook: result.lookbook });
  } catch (err) {
    console.error("[lookbook] public read failed:", err);
    return res.status(500).json({ status: "error", message: "Something went wrong. Try again in a moment." });
  }
});

module.exports = router;
