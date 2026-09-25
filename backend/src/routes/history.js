const express = require("express");
const { Readable } = require("stream");
const config = require("../config");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { hasPermission } = require("../permissions");
const Generation = require("../models/generation");
const Asset = require("../models/asset");
const { GENERATION_TOOLS, toPublicAsset } = require("../generations");
const { deleteObject } = require("../storage/r2");
const { logAudit, actorFrom, requestMeta } = require("../auditLog");
const { emitToTenant } = require("../socket");

const router = express.Router();

/**
 * Whether a url really points at this app's own public bucket.
 *
 * Both routes below hand a caller-supplied url to `fetch`, so this check is
 * the only thing standing between them and an open relay that will make the
 * server request anything a signed-in user names.
 *
 * Compared by parsed origin, not by string prefix: `startsWith` accepts
 * `https://pub-xxxx.r2.dev.attacker.example/…`, which begins with the
 * configured url and is an entirely different host. Parsing also rejects a
 * protocol swap and anything that isn't a url at all.
 */
function isOwnPublicUrl(value) {
  if (typeof value !== "string" || !config.r2.publicUrl) return false;

  let candidate;
  let base;
  try {
    candidate = new URL(value);
    base = new URL(config.r2.publicUrl);
  } catch {
    return false;
  }

  if (candidate.origin !== base.origin) return false;

  // A public url configured with a path prefix confines us to that subtree;
  // one pointing at the bucket root ("/") imposes no further restriction.
  const basePath = base.pathname.replace(/\/+$/, "");
  return basePath === "" || candidate.pathname.startsWith(`${basePath}/`);
}

/**
 * Strips anything that would let a filename escape the browser's downloads
 * folder or break the header it travels in — separators, quotes, control
 * characters — and keeps it to a sane length.
 */
function safeFilename(name, fallback) {
  const cleaned = String(name || "")
    // eslint-disable-next-line no-control-regex -- control characters are exactly what must not reach a header
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:*?"<>|]/g, "-")
    .trim()
    // After trimming, not before — otherwise "  ..name" keeps its dots and
    // lands as a hidden file.
    .replace(/^\.+/, "")
    .slice(0, 120);
  return cleaned || fallback;
}

/**
 * Streams one stored image back as a file attachment.
 *
 * The reason this exists rather than the browser downloading from R2
 * directly: an anchor's `download` attribute is ignored cross-origin, so
 * `<a href="https://…r2.dev/…" download>` navigates to the image instead of
 * saving it — which is what a click on the download button used to do. Coming
 * from our own origin with `Content-Disposition: attachment`, the browser
 * saves it, and the filename we choose survives.
 *
 * Deliberately registered before the `result.read.own` middleware below and
 * behind `requireAuth` alone: a tool page's own freshly generated result is
 * downloadable by whoever just made it, whether or not they also hold the
 * History permission. It grants no reach either, since these objects sit in a
 * public bucket that anyone holding the URL can already fetch unauthenticated
 * — this route only changes which headers come back.
 *
 * Streamed rather than buffered: these are full-resolution originals of
 * several megabytes, and holding one in memory per concurrent download is a
 * needless way to run a small instance out of heap.
 */
router.get("/download", requireAuth, async (req, res) => {
  const { url } = req.query;
  if (!isOwnPublicUrl(url)) {
    return res.status(400).json({ status: "error", message: "invalid url", code: "invalid" });
  }

  let upstream;
  try {
    upstream = await fetch(url);
  } catch (err) {
    console.error("download: could not reach R2:", err.message);
    return res.status(502).json({ status: "error", message: "could not load image", code: "fetch_failed" });
  }
  if (!upstream.ok || !upstream.body) {
    return res.status(502).json({ status: "error", message: "could not load image", code: "fetch_failed" });
  }

  const filename = safeFilename(req.query.filename, "sparkle-image.jpg");
  res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/octet-stream");
  const length = upstream.headers.get("content-length");
  if (length) res.setHeader("Content-Length", length);
  // Both forms: the quoted one for older clients, the RFC 5987 one so a name
  // with non-ASCII characters in it still arrives intact.
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${filename.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(filename)}`
  );
  // CORS hides every response header from script by default, so without this
  // a caller fetching the blob cannot read back the name it was given.
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");

  Readable.fromWeb(upstream.body).pipe(res).on("error", (err) => {
    console.error("download: stream failed:", err.message);
    res.destroy();
  });
});

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
  if (!isOwnPublicUrl(url)) {
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
  const { tool, member, before, after, scope, from, to } = req.query;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);

  const query = buildScopeFilter(req.dbUser, scope === "team");

  /*
   * A run that wrote a Marketing Kit belongs to the Kits tab and is never
   * shown in this grid. Excluded here rather than by the page, because a
   * page of results the grid then throws away is a page the reader has to
   * scroll past nothing to get beyond.
   */
  query["request.params.kitId"] = null;

  // Repeatable: ?tool=a&tool=b, which is what the page's checkbox list sends.
  if (tool) {
    const tools = (Array.isArray(tool) ? tool : [tool]).filter((value) => value !== "all");
    if (tools.some((value) => !GENERATION_TOOLS.includes(value))) {
      return res.status(400).json({ status: "error", message: "unknown tool", code: "invalid" });
    }
    if (tools.length) query.tool = { $in: tools };
  }

  /*
   * By the name stored on the generation, which is what the page filters by
   * and what the dropdown lists. It is a snapshot taken when the run
   * happened, so a renamed person keeps their old rows under the old name —
   * true of the label in the grid too, so the two agree.
   */
  if (member) {
    const members = Array.isArray(member) ? member : [member];
    if (members.length) query.userName = { $in: members };
  }

  // The resolution a run was asked for — the badge on every tile.
  if (req.query.quality) {
    const qualities = Array.isArray(req.query.quality) ? req.query.quality : [req.query.quality];
    if (qualities.length) query["request.params.quality"] = { $in: qualities };
  }

  /*
   * What the run produced, which is not the same question as which tool made
   * it: Image to Video is the only video tool, but a text answer comes from
   * several and a picture from most.
   *
   * "text" is the awkward one — it is the absence of assets rather than a
   * value on them, so it is matched as an empty output list with something
   * written instead. Asking for it alongside a media type is therefore an
   * `$or` rather than one clause.
   */
  if (req.query.type) {
    const types = (Array.isArray(req.query.type) ? req.query.type : [req.query.type]).filter((value) =>
      ["image", "video", "text"].includes(value)
    );

    const clauses = [];
    if (types.includes("video")) {
      clauses.push({ "response.outputAssets": { $elemMatch: { type: "video" } } });
    }
    if (types.includes("image")) {
      /*
       * Missing counts as an image.
       *
       * `type` carries a schema default of "image", but a default is applied
       * when a document is written, not to documents already stored — every
       * asset snapshot written before Image to Video existed has no `type`
       * key at all. Matching on the value alone quietly hid all of them,
       * which is most of the library.
       */
      clauses.push({
        "response.outputAssets": { $elemMatch: { $or: [{ type: "image" }, { type: { $exists: false } }] } },
      });
    }
    if (types.includes("text")) {
      clauses.push({ "response.outputAssets": { $size: 0 }, "response.text": { $nin: [null, ""] } });
    }

    if (clauses.length === 1) Object.assign(query, clauses[0]);
    else if (clauses.length > 1) query.$or = clauses;
  }

  if (before) {
    const cursor = new Date(before);
    if (Number.isNaN(cursor.getTime())) {
      return res.status(400).json({ status: "error", message: "invalid cursor", code: "invalid" });
    }
    query.createdAt = { ...query.createdAt, $lt: cursor };
  }

  /*
   * The other direction: only what is newer than the page's newest tile.
   * Asked for when a `history:changed` ping says a colleague finished
   * something — the page fetches just the new rows, through this same scoped
   * query, rather than reloading everything it already shows.
   */
  if (after) {
    const cursor = new Date(after);
    if (Number.isNaN(cursor.getTime())) {
      return res.status(400).json({ status: "error", message: "invalid cursor", code: "invalid" });
    }
    query.createdAt = { ...query.createdAt, $gt: cursor };
  }

  /*
   * The date range, merged into whatever `createdAt` already carries — the
   * cursor above, and `dataScope.notBefore` from the scope filter. All three
   * constrain the same field, so they combine rather than overwrite.
   */
  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;
  if (fromDate && !Number.isNaN(fromDate.getTime())) {
    query.createdAt = { ...query.createdAt, $gte: fromDate };
  }
  if (toDate && !Number.isNaN(toDate.getTime())) {
    // A bare date means the whole of that day.
    if (!String(to).includes("T")) toDate.setHours(23, 59, 59, 999);
    query.createdAt = { ...query.createdAt, $lte: toDate };
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

/**
 * What the filter dropdowns can offer.
 *
 * Needed once filtering moved to the server: the page used to build its
 * member list from whatever rows had been paged in, which was wrong in both
 * directions — someone who had not appeared in the first two pages could not
 * be filtered for at all, and the list shrank as soon as a filter narrowed
 * the grid. Distinct over the same scope the rows use, so it offers exactly
 * the people whose work this caller is allowed to see.
 */
router.get("/facets", async (req, res) => {
  const scopeFilter = buildScopeFilter(req.dbUser, req.query.scope === "team");
  const [members, tools, qualities] = await Promise.all([
    Generation.distinct("userName", scopeFilter),
    Generation.distinct("tool", scopeFilter),
    Generation.distinct("request.params.quality", scopeFilter),
  ]);

  res.json({
    status: "success",
    members: members.filter(Boolean).sort(),
    tools: tools.filter(Boolean).sort(),
    // Offered in resolution order rather than alphabetically, where "1K, 2K,
    // 4K" would sort as "1K, 2K, 4K" by luck and "512, 1K, 2K" would not.
    qualities: qualities.filter(Boolean).sort((a, b) => parseInt(a, 10) - parseInt(b, 10)),
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
    outputs: (generation.response?.outputAssets || []).map(toPublicAsset),
    // What a text-out tool produced. Null for every tool that makes pictures,
    // so a tile renders images when it has them and the answer when it
    // doesn't — one shape either way.
    text: generation.response?.text || null,
    /**
     * The document this run wrote, where it wrote one — a Marketing Kit.
     *
     * Exposed so History can open the deck rather than show the raw answer:
     * an Affinity run's stored text is the model's JSON, which is the right
     * thing to keep and the wrong thing to read.
     */
    kitId: generation.request?.params?.kitId || null,
  };
}

/**
 * The full thread behind one History tile, in turn order — what a tool page
 * needs to rebuild its chat and pick up where the conversation left off.
 *
 * Only the conversation's own owner may resume it. Anyone else gets it only
 * with `org.conversations.read`, only if the thread is within their data
 * scope — the same reach that put its tile in their History — and only
 * read-only: the response says `readOnly`, the tool page drops its composer,
 * and recordGeneration refuses a turn on someone else's conversation. Every
 * such view is audited, since it is one person reading another's work.
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
  const owner = generations[0];
  const isOwn = String(owner.userId) === String(req.dbUser._id);

  if (!isOwn) {
    const forbidden = () =>
      res.status(403).json({ status: "error", message: "you can only continue your own generations", code: "forbidden" });

    if (!req.isSuperAdmin && !hasPermission(req.dbUser, "org.conversations.read")) return forbidden();

    // Within reach = at least one of its turns would appear in their team
    // History. Checked against the same filter, so the two can never disagree.
    if (!req.isSuperAdmin) {
      const inScope = await Generation.exists({ ...buildScopeFilter(req.dbUser, true), conversationId: req.params.id });
      if (!inScope) return forbidden();
    }

    logAudit({
      ...actorFrom(req),
      ...requestMeta(req),
      tenantId: req.dbUser.tenantId,
      action: "conversation.viewed",
      status: "success",
      targetType: "conversation",
      targetId: String(req.params.id),
      message: `viewed ${owner.userName || "a colleague"}'s ${owner.tool} chat`,
      metadata: { ownerId: String(owner.userId), ownerName: owner.userName || null, tool: owner.tool },
    });
  }

  res.json({
    status: "success",
    tool: owner.tool,
    readOnly: !isOwn,
    ownerName: isOwn ? null : owner.userName || null,
    generations: generations.map((g) => ({
      id: String(g._id),
      sequence: g.sequence,
      userPrompt: g.request?.userPrompt || null,
      model: g.model?.modelLabel || g.model?.modelId,
      quality: g.request?.params?.quality || null,
      inputAssets: (g.request?.inputAssets || []).map(toPublicAsset),
      outputAssets: (g.response?.outputAssets || []).map(toPublicAsset),
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
  try {
    return await deleteGeneration(req, res);
  } catch (err) {
    /*
     * Express 4 does not catch a rejection from an async handler: it never
     * reaches the error middleware, so nothing answers the request and the
     * client waits forever. On the Delete button that reads as a spinner
     * that never stops and a tile that never goes away — a hang, not an
     * error. A failure has to come back as a reply.
     *
     * A malformed id is the ordinary case (Mongoose throws CastError rather
     * than returning null), and it means the same thing as no match.
     */
    if (err.name === "CastError") {
      return res.status(404).json({ status: "error", message: "not found", code: "not_found" });
    }
    console.error(`history delete: ${req.params.id} failed:`, err);
    return res.status(500).json({ status: "error", message: "Could not delete that result", code: "delete_failed" });
  }
});

/**
 * Your own result, always. A colleague's only with `org.results.delete`, and
 * only one within your data scope — the same filter that put its tile in
 * your team History, so you can delete exactly what you can see and nothing
 * further. Anything else is a 404, not a 403: whether someone else's result
 * exists is not something to confirm to a caller who may not touch it.
 */
async function deleteGeneration(req, res) {
  const notFound = () => res.status(404).json({ status: "error", message: "not found", code: "not_found" });

  const own = await Generation.findOne({
    _id: req.params.id,
    tenantId: req.dbUser.tenantId,
    userId: req.dbUser._id,
    deletedAt: null,
  });

  let generation = own;
  if (!generation) {
    if (!req.isSuperAdmin && !hasPermission(req.dbUser, "org.results.delete")) return notFound();
    generation = await Generation.findOne(
      req.isSuperAdmin
        ? { _id: req.params.id, tenantId: req.dbUser.tenantId, deletedAt: null }
        : { ...buildScopeFilter(req.dbUser, true), _id: req.params.id }
    );
  }
  if (!generation) return notFound();

  // Optional all the way down: a row that never got as far as recording its
  // assets is exactly the kind of row a user wants to clear out, so it must
  // not be the one that can't be deleted.
  const assetIds = [...(generation.request?.inputAssetIds || []), ...(generation.response?.outputAssetIds || [])];
  const assets = await Asset.find({ _id: { $in: assetIds }, deletedAt: null });

  await Promise.all(
    assets.flatMap((asset) => {
      // The thumbnail is a separate object under the same prefix — skipping
      // it here would leave it orphaned in the bucket with nothing left
      // pointing at it.
      const keys = [asset.s3Key, asset.thumbnail?.s3Key].filter(Boolean);
      return keys.map(async (key) => {
        try {
          await deleteObject(key);
        } catch (err) {
          console.error(`history delete: could not remove R2 object ${key} for asset ${asset._id}:`, err.message);
        }
      });
    })
  );

  const now = new Date();
  await Asset.updateMany({ _id: { $in: assetIds } }, { deletedAt: now });
  generation.deletedAt = now;
  await generation.save();

  // Other open History pages drop the tile if they have it. The id alone,
  // which says nothing to a page that never had the tile.
  emitToTenant(req.dbUser.tenantId, "history:changed", { kind: "removed", id: String(generation._id) });

  // Removing a colleague's work is the kind of thing someone later asks
  // "who did this" about. Clearing out your own is just housekeeping.
  if (!own) {
    logAudit({
      ...actorFrom(req),
      ...requestMeta(req),
      tenantId: req.dbUser.tenantId,
      action: "generation.deleted",
      status: "success",
      targetType: "generation",
      targetId: String(generation._id),
      message: `deleted ${generation.userName || "a colleague"}'s ${generation.tool} result`,
      metadata: {
        ownerId: String(generation.userId),
        ownerName: generation.userName || null,
        tool: generation.tool,
        conversationId: generation.conversationId ? String(generation.conversationId) : null,
      },
    });
  }

  return res.json({ status: "success" });
}

module.exports = router;
