const express = require("express");
const config = require("../config");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { hasPermission } = require("../permissions");
const Generation = require("../models/generation");
const Asset = require("../models/asset");
const { GENERATION_TOOLS } = require("../generations");
const { deleteObject } = require("../storage/r2");

const router = express.Router();

router.use(requireAuth, requirePermission("result.read.own"));

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 60;

/**
 * Re-fetches a past result as a data URI, for a tool page that's resuming a
 * conversation: the stage can display an R2 URL directly, but the cleaning
 * and chat-to-edit routes only ever accept a data URI as the image to edit,
 * and the browser can't fetch R2 cross-origin itself. Restricted to this
 * app's own R2 public prefix — a fetch proxy with no allowlist would let any
 * signed-in user make this server request an arbitrary URL.
 */
router.get("/image-data", async (req, res) => {
  const { url } = req.query;
  if (typeof url !== "string" || !config.r2.publicUrl || !url.startsWith(config.r2.publicUrl)) {
    return res.status(400).json({ status: "error", message: "invalid url", code: "invalid" });
  }

  let upstream;
  try {
    upstream = await fetch(url);
  } catch (err) {
    console.error("image-data: could not reach R2:", err.message);
    return res.status(502).json({ status: "error", message: "could not load image", code: "fetch_failed" });
  }
  if (!upstream.ok) {
    return res.status(502).json({ status: "error", message: "could not load image", code: "fetch_failed" });
  }

  const buffer = Buffer.from(await upstream.arrayBuffer());
  const mimeType = upstream.headers.get("content-type") || "image/jpeg";
  res.json({ status: "success", dataUri: `data:${mimeType};base64,${buffer.toString("base64")}` });
});

/**
 * Own work only, unless the caller both holds `result.read.others` and asks
 * for `scope=team` — the permission decides *whether* a "Whole team" toggle
 * can do anything, `dataScope` decides how far it reaches once it's flipped.
 */
function buildScopeFilter(dbUser, wantsTeam) {
  const filter = { tenantId: dbUser.tenantId, status: "completed", deletedAt: null };
  if (!wantsTeam || !hasPermission(dbUser, "result.read.others")) {
    filter.userId = dbUser._id;
    return filter;
  }

  const scope = dbUser.dataScope || { kind: "own" };
  if (scope.kind === "selected") {
    filter.userId = { $in: [dbUser._id, ...(scope.userIds || [])] };
  } else if (scope.kind === "own") {
    filter.userId = dbUser._id;
  }
  // kind === "organization" adds no userId clause — the whole tenant is in reach.
  if (scope.notBefore) filter.createdAt = { $gte: scope.notBefore };
  return filter;
}

/**
 * The flat "all generated images" list the History page renders as a grid.
 * `scope=team` widens it from the caller's own work to their tenant's, as far
 * as their `dataScope` allows — see `buildScopeFilter`.
 *
 * Paginated by `createdAt` rather than skip/limit: a skip count drifts as new
 * generations land while someone is scrolling, a `before` cursor doesn't.
 */
router.get("/", async (req, res) => {
  const { tool, before, scope } = req.query;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);

  const query = buildScopeFilter(req.dbUser, scope === "team");
  if (tool && tool !== "all") {
    if (!GENERATION_TOOLS.includes(tool)) {
      return res.status(400).json({ status: "error", message: "unknown tool", code: "invalid" });
    }
    query.tool = tool;
  }
  if (before) {
    const cursor = new Date(before);
    if (Number.isNaN(cursor.getTime())) {
      return res.status(400).json({ status: "error", message: "invalid cursor", code: "invalid" });
    }
    query.createdAt = { ...query.createdAt, $lt: cursor };
  }

  const generations = await Generation.find(query)
    .sort({ createdAt: -1 })
    .limit(limit + 1)
    .lean();

  const hasMore = generations.length > limit;
  const page = hasMore ? generations.slice(0, limit) : generations;

  res.json({
    status: "success",
    items: page.map((generation) => toHistoryItem(generation, req.dbUser)),
    nextCursor: hasMore ? page[page.length - 1].createdAt.toISOString() : null,
    canReadTeam: hasPermission(req.dbUser, "result.read.others"),
  });
});

function toHistoryItem(generation, dbUser) {
  return {
    id: String(generation._id),
    conversationId: String(generation.conversationId),
    tool: generation.tool,
    model: generation.model?.modelLabel || generation.model?.modelId,
    quality: generation.request?.params?.quality || null,
    // Whether the current caller is the one who ran this — the id scheme
    // behind `userId` isn't the frontend's business, only the verdict is.
    isOwn: String(generation.userId) === String(dbUser._id),
    userName: generation.userName,
    createdAt: generation.createdAt,
    outputs: (generation.response?.outputAssets || []).map((asset) => ({
      assetId: String(asset.assetId),
      url: asset.url,
      width: asset.width,
      height: asset.height,
    })),
  };
}

/**
 * The full thread behind one History tile, in turn order — what a tool page
 * needs to rebuild its chat and pick up where the conversation left off.
 * Only the conversation's own owner may resume it: a shared "whole team"
 * view is read-only, since continuing someone else's thread would attribute
 * the next turn to whoever clicked, not who started it.
 */
router.get("/conversations/:id", async (req, res) => {
  const generations = await Generation.find({
    conversationId: req.params.id,
    tenantId: req.dbUser.tenantId,
    deletedAt: null,
  })
    .sort({ sequence: 1 })
    .lean();

  if (generations.length === 0) {
    return res.status(404).json({ status: "error", message: "not found", code: "not_found" });
  }
  if (String(generations[0].userId) !== String(req.dbUser._id)) {
    return res.status(403).json({ status: "error", message: "you can only continue your own generations", code: "forbidden" });
  }

  res.json({
    status: "success",
    tool: generations[0].tool,
    generations: generations.map((g) => ({
      id: String(g._id),
      sequence: g.sequence,
      userPrompt: g.request?.userPrompt || null,
      model: g.model?.modelLabel || g.model?.modelId,
      quality: g.request?.params?.quality || null,
      inputAssets: (g.request?.inputAssets || []).map((a) => ({ url: a.url, role: a.role })),
      outputAssets: (g.response?.outputAssets || []).map((a) => ({ url: a.url, role: a.role })),
    })),
  });
});

/**
 * Removes one generation from history for good: its output images are
 * deleted from R2 first, then the generation and its assets are marked
 * deleted — never the other way round, so a row never points at bytes that
 * are already gone but claims otherwise.
 */
router.delete("/:id", async (req, res) => {
  const generation = await Generation.findOne({
    _id: req.params.id,
    tenantId: req.dbUser.tenantId,
    userId: req.dbUser._id,
    deletedAt: null,
  });
  if (!generation) {
    return res.status(404).json({ status: "error", message: "not found", code: "not_found" });
  }

  const assetIds = [...(generation.request.inputAssetIds || []), ...(generation.response.outputAssetIds || [])];
  const assets = await Asset.find({ _id: { $in: assetIds }, deletedAt: null });

  await Promise.all(
    assets.map(async (asset) => {
      try {
        await deleteObject(asset.s3Key);
      } catch (err) {
        console.error(`history delete: could not remove R2 object for asset ${asset._id}:`, err.message);
      }
    })
  );

  const now = new Date();
  await Asset.updateMany({ _id: { $in: assetIds } }, { deletedAt: now });
  generation.deletedAt = now;
  await generation.save();

  res.json({ status: "success" });
});

module.exports = router;
