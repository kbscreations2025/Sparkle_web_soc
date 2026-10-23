const express = require("express");
const mongoose = require("mongoose");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { hasPermission } = require("../permissions");
const Asset = require("../models/asset");
const { GENERATION_TOOLS } = require("../generations");
const { publicUrlFor } = require("../storage/r2");
const { handle, bad } = require("./_shared");
const { buildScopeFilter } = require("./history");

const router = express.Router();

/**
 * The library behind every upload box: a person's earlier uploads and
 * results, so the picture a run needs can be picked again instead of found
 * on disk — a photo cleaned this morning, placed on a model this afternoon.
 *
 * Read straight off the assets collection, which already holds every image
 * that went into or came out of a run. Picking one adds nothing here: the
 * page fetches the bytes through /api/history/download and hands them to the
 * tool exactly as if they had been chosen from disk, so no tool route knows
 * or cares where a photo came from.
 *
 * Behind the same grant as History. It is the same pictures, and the page
 * turns a pick into bytes through a History route.
 */
router.use(requireAuth, requirePermission("result.read.own"));

/**
 * Which asset roles each half of the library holds.
 *
 * "reference" counts as an upload: it is how a tool records a photo supplied
 * beside the main one — Campaign Kit's pieces, a scene's backdrop, a style
 * reference — every one of them picked off someone's disk.
 *
 * "edited" is in neither. It is the input to a refinement, and in the data
 * that is a byte-for-byte copy of an earlier result or upload (305 of 337
 * when this was written) or a copy with the person's marks drawn on it —
 * never a picture worth picking that isn't already here under its own role.
 */
const SECTIONS = {
  uploads: ["uploaded", "reference"],
  results: ["generated"],
};

const DEFAULT_LIMIT = 48;
const MAX_LIMIT = 96;
/**
 * How many rows one request may walk looking for a full page. A run of
 * repeats — the same photo uploaded thirty times in a row — is skipped
 * without a page coming back empty, but a pathological one can't turn a
 * page into a scan of the whole library: past this the page is returned
 * short, with a cursor, and the next request carries on.
 */
const MAX_WALK = 600;

const FIELDS = "_id tool role mimeType sizeBytes width height s3Key thumbnail checksum sourceChecksum userId userName createdAt";

/**
 * Which photo a row is, for collapsing repeats: the original file's
 * fingerprint where the page sent one, else the stored bytes'. The same
 * photo is often uploaded over and over — retried, or cleaned again with a
 * different model — and the library shows it once, at its latest.
 */
const photoKey = (asset) => asset.sourceChecksum || asset.checksum;

/** History's reach, unchanged — see buildScopeFilter. Its `status` is a generation's ("completed"), which an asset row doesn't have. */
function reachFilter(dbUser, wantsTeam) {
  const { status: _generationStatus, ...reach } = buildScopeFilter(dbUser, wantsTeam);
  return reach;
}

/**
 * Just these people's pictures inside the team reach. An `$and` beside the
 * reach's own `userId` clause, so someone outside it narrows to nothing
 * rather than widening anything.
 */
function memberClause(members) {
  return members ? { $and: [{ userId: { $in: members } }] } : {};
}

/**
 * The `members` query param — comma-separated user ids, "me" for the caller —
 * as ObjectIds; null for no narrowing (only the team scope narrows), undefined
 * once a bad one has been answered with a 400.
 */
function readMembers(req, res) {
  const raw = String(req.query.members || "").split(",").filter(Boolean);
  if (raw.some((id) => id !== "me" && !mongoose.isValidObjectId(id))) {
    bad(res, "invalid member");
    return undefined;
  }
  if (req.query.scope !== "team" || raw.length === 0) return null;
  return raw.map((id) => (id === "me" ? req.dbUser._id : new mongoose.Types.ObjectId(id)));
}

function libraryFilter(dbUser, { section, tool, wantsTeam, members }) {
  return {
    ...reachFilter(dbUser, wantsTeam),
    ...memberClause(members),
    role: { $in: SECTIONS[section] },
    // Every upload box takes pictures; a clip from Image to Video is no use to any of them.
    type: { $ne: "video" },
    /*
     * Every tool, spelled out, when none is asked for. The same rows either
     * way, but a list of exact values lets the team-wide query merge the
     * per-tool runs of the (tenantId, tool, _id) index newest-first instead
     * of walking the whole collection in _id order.
     */
    tool: tool || { $in: GENERATION_TOOLS },
  };
}

/**
 * Of these photo keys, the ones a row at or above `cursor` already has —
 * i.e. photos an earlier page showed at a newer position.
 *
 * Two queries rather than one `$or`: each half then uses its own index.
 * `$type` beside the `$in` is what makes the first use the partial
 * sourceChecksum index (a bare `$in` doesn't satisfy its filter expression),
 * and without it this scanned every asset in reach.
 */
async function keysAtOrAbove(filter, cursor, keys) {
  if (!cursor || keys.length === 0) return new Set();
  const above = { ...filter, _id: { $gte: cursor } };
  const [bySource, byChecksum] = await Promise.all([
    Asset.find({ ...above, sourceChecksum: { $in: keys, $type: "string" } }).select("sourceChecksum").lean(),
    // A row's key is its checksum only when it has no source fingerprint.
    Asset.find({ ...above, sourceChecksum: null, checksum: { $in: keys } }).select("checksum").lean(),
  ]);
  return new Set([...bySource.map((row) => row.sourceChecksum), ...byChecksum.map((row) => row.checksum)]);
}

function toLibraryItem(asset, dbUser) {
  const url = publicUrlFor(asset.s3Key);
  return {
    id: String(asset._id),
    // The full-size original: what a pick actually adds.
    url,
    // Every reader falls back to the original when the resize failed.
    thumbnailUrl: asset.thumbnail?.s3Key ? publicUrlFor(asset.thumbnail.s3Key) : url,
    tool: asset.tool,
    role: asset.role,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    width: asset.width ?? null,
    height: asset.height ?? null,
    createdAt: asset.createdAt,
    userName: asset.userName,
    isOwn: String(asset.userId) === String(dbUser._id),
    /**
     * Which photo this is, by the key repeats are collapsed on. Image
     * Cleaning sends it as the pick's source fingerprint, so its "cleaned
     * before" check recognises the photo however it arrived.
     */
    fingerprint: photoKey(asset),
  };
}

/**
 * One page of one folder — uploads or results, one tool or all of them —
 * newest first, each photo once.
 *
 * Paged by `_id` rather than skip/limit, like History: a skip count drifts
 * as new uploads land while someone is scrolling, a cursor doesn't.
 *
 * Repeats are collapsed as the page is walked rather than by grouping the
 * whole folder first, which would cost a pass over everything in reach for
 * every page. A photo is shown at its newest row: one met again further down
 * this page is skipped, and so is one an earlier page already showed (it has
 * a row at or above the cursor). The cursor is the last row walked, shown or
 * not, so the next page starts where this one stopped.
 */
router.get(
  "/",
  handle(async (req, res) => {
    const section = req.query.section || "uploads";
    if (!SECTIONS[section]) return bad(res, "unknown section");
    const tool = req.query.tool || null;
    if (tool && !GENERATION_TOOLS.includes(tool)) return bad(res, "unknown tool");
    if (req.query.before && !mongoose.isValidObjectId(req.query.before)) return bad(res, "invalid cursor");
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);

    const members = readMembers(req, res);
    if (members === undefined) return;

    const filter = libraryFilter(req.dbUser, { section, tool, wantsTeam: req.query.scope === "team", members });
    const start = req.query.before ? new mongoose.Types.ObjectId(String(req.query.before)) : null;

    const page = [];
    // Keys met on this request, newest first — the first row for each is its latest.
    const met = new Set();
    let cursor = start;
    let walked = 0;
    let finished = false;

    while (page.length < limit && walked < MAX_WALK && !finished) {
      const size = Math.min(limit * 2, MAX_WALK - walked);
      const batch = await Asset.find(cursor ? { ...filter, _id: { $lt: cursor } } : filter)
        .sort({ _id: -1 })
        .limit(size)
        .select(FIELDS)
        .lean();

      const fresh = [...new Set(batch.map(photoKey))].filter((key) => !met.has(key));
      const shownEarlier = await keysAtOrAbove(filter, start, fresh);

      let consumed = 0;
      for (const asset of batch) {
        if (page.length === limit) break;
        consumed++;
        cursor = asset._id;
        const key = photoKey(asset);
        if (met.has(key)) continue;
        met.add(key);
        if (!shownEarlier.has(key)) page.push(asset);
      }
      walked += consumed;
      // A short batch, read to its end, is the end of the folder.
      finished = batch.length < size && consumed === batch.length;
    }

    res.json({
      status: "success",
      items: page.map((asset) => toLibraryItem(asset, req.dbUser)),
      nextCursor: finished || !cursor ? null : String(cursor),
      canReadTeam: hasPermission(req.dbUser, "result.read.others"),
    });
  })
);

/**
 * Which tools each half of the library has anything from, so the picker
 * lists only folders with something in them. Over the same reach as the
 * rows, so a folder is offered exactly when opening it would show something.
 */
router.get(
  "/folders",
  handle(async (req, res) => {
    const wantsTeam = req.query.scope === "team";
    const picked = readMembers(req, res);
    if (picked === undefined) return;
    const canReadTeam = hasPermission(req.dbUser, "result.read.others");

    const [uploads, results, members] = await Promise.all([
      ...Object.keys(SECTIONS).map((section) =>
        Asset.distinct("tool", libraryFilter(req.dbUser, { section, wantsTeam, members: picked }))
      ),
      // Everyone in reach with a picture in either half, for the picker's
      // person list — over the whole team reach, whoever is picked now.
      canReadTeam
        ? Asset.aggregate([
            {
              $match: {
                ...reachFilter(req.dbUser, true),
                // The person themself is "Myself" in the list, not a teammate.
                $and: [{ userId: { $ne: req.dbUser._id } }],
                role: { $in: Object.values(SECTIONS).flat() },
                type: { $ne: "video" },
                tool: { $in: GENERATION_TOOLS },
              },
            },
            { $group: { _id: "$userId", name: { $last: "$userName" } } },
          ])
        : [],
    ]);
    res.json({
      status: "success",
      uploads,
      results,
      members: members
        .map((row) => ({ id: String(row._id), name: row.name || "Unnamed" }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      canReadTeam,
    });
  })
);

module.exports = router;
