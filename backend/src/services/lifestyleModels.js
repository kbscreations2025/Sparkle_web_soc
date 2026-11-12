const mongoose = require("mongoose");
const LifestyleModel = require("../models/lifestyleModel");
const { uploadLibraryImage } = require("../storage/libraryImage");
const { getObject, deleteObject, variantKeyFor } = require("../storage/r2");
const { THUMB_EXTENSION } = require("../storage/thumbnail");
const { parseDataUri } = require("../generationService");
const { hasPermission } = require("../permissions");
const Generation = require("../models/generation");
const MarketingKit = require("../models/marketingKit");

/**
 * Shown in place of a model photo an admin has purged — in History, the chat
 * and Campaign Kits. Served by the frontend (public/model-removed.svg).
 */
const MODEL_REMOVED_URL = "/model-removed.svg";

const MIME_BY_EXTENSION = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

function mimeForKey(key) {
  return MIME_BY_EXTENSION[String(key).split(".").pop().toLowerCase()] || "image/jpeg";
}

/**
 * Saved Lifestyle models — the people jewellery gets placed onto.
 *
 * Separate from the queue entirely. Saving one is an upload, renaming one is
 * a field write, and neither is worth a job: the only slow part of this tool
 * is *generating* a model, which does go through the queue (see
 * jobs/lifestyle.js) and lands here afterwards.
 */

/**
 * Whose models this person may pick from, besides the shared ones: their
 * own, plus — with `result.read.others` — the members their `dataScope`
 * reaches. The same reach History gives them over those members' results.
 * Returns a Mongo `userId` condition, or null for the whole organization.
 */
function ownerFilter(dbUser) {
  if (!hasPermission(dbUser, "result.read.others")) return dbUser._id;
  const scope = dbUser.dataScope || { kind: "own" };
  if (scope.kind === "organization") return null;
  if (scope.kind === "selected") return { $in: [dbUser._id, ...(scope.userIds || [])] };
  return dbUser._id;
}

function reachFilter(dbUser) {
  const owners = ownerFilter(dbUser);
  return owners === null ? {} : { $or: [{ userId: owners }, { isPublic: true }] };
}

/** The client-facing shape. Never the R2 key — that is ours, not the browser's. */
function toPublicModel(row, dbUser) {
  return {
    // Someone else's model reached through data scope can be used, not renamed.
    isOwn: dbUser ? String(row.userId) === String(dbUser._id) : true,
    id: String(row._id),
    name: row.name,
    attrs: row.attrs || {},
    notes: row.notes ?? null,
    imageUrl: row.imageUrl,
    thumbnailUrl: row.thumbnailUrl || row.imageUrl,
    isPublic: Boolean(row.isPublic),
    userName: row.userName,
    createdAt: row.createdAt,
  };
}

/**
 * Everything this person may pick from: their own models, those of members
 * in their data scope (see `ownerFilter`), and whatever the organization has
 * shared.
 *
 * One query rather than two and a merge — a model shared by its own creator
 * would otherwise appear twice in their picker.
 */
async function listModels(dbUser) {
  const rows = await LifestyleModel.find({
    tenantId: dbUser.tenantId,
    deletedAt: null,
    status: "active",
    ...reachFilter(dbUser),
  })
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();

  return rows.map((row) => toPublicModel(row, dbUser));
}

/**
 * Stores one model photo.
 *
 * Both entry points land here: a directly uploaded photo and the last step of
 * a generated one, so the row, the key scheme and the thumbnail are written
 * the same way regardless of where the picture came from.
 */
async function createModel({ dbUser, name, attrs = {}, notes = null, imageDataUri }) {
  const image = parseDataUri(imageDataUri);
  if (!image || !image.mimeType.startsWith("image/")) {
    const err = new Error("a model image must be an image data URI");
    err.code = "invalid";
    throw err;
  }

  const id = new mongoose.Types.ObjectId();
  // The thumbnail is best-effort, exactly as for a generated asset: a picker
  // that falls back to the full-size photo is slower, not broken.
  const stored = await uploadLibraryImage({
    tenantId: dbUser.tenantId,
    userId: dbUser._id,
    collection: "lifestyle-models",
    id,
    image,
    logTag: "lifestyle-models",
  });

  const row = await LifestyleModel.create({
    _id: id,
    tenantId: dbUser.tenantId,
    userId: dbUser._id,
    userName: dbUser.name || dbUser.email,
    name: (name || "").trim() || defaultName(attrs),
    attrs,
    notes: notes?.trim() || null,
    imageUrl: stored.url,
    thumbnailUrl: stored.thumbnail?.url ?? null,
    r2Key: stored.key,
  });

  return toPublicModel(row, dbUser);
}

/** A readable name for a model saved without one, from what it was asked to be. */
function defaultName(attrs = {}) {
  const parts = [attrs.age, attrs.skinTone, attrs.gender].filter(Boolean);
  return parts.length ? parts.join(" · ").slice(0, 100) : "Untitled model";
}

/** Renames a model. Its creator only — a shared model is not a shared document. */
async function renameModel({ dbUser, id, name }) {
  const row = await LifestyleModel.findOne({ _id: id, tenantId: dbUser.tenantId, deletedAt: null });
  if (!row) return null;
  if (String(row.userId) !== String(dbUser._id)) {
    const err = new Error("you can only rename your own models");
    err.code = "forbidden";
    throw err;
  }

  row.name = String(name).trim().slice(0, 100) || row.name;
  await row.save();
  return toPublicModel(row, dbUser);
}

/**
 * Shares a model with the whole organization, or stops sharing it.
 *
 * Caller-gated rather than checked here: in this application the only tier
 * above a member is the platform super admin (there is no org-admin grant),
 * so the route decides and this records who decided.
 */
async function setModelPublic({ dbUser, id, isPublic }) {
  const row = await LifestyleModel.findOne({ _id: id, tenantId: dbUser.tenantId, deletedAt: null });
  if (!row) return null;

  row.isPublic = isPublic;
  row.publicizedBy = isPublic ? dbUser._id : null;
  row.publicizedAt = isPublic ? new Date() : null;
  await row.save();
  return toPublicModel(row, dbUser);
}

/**
 * Soft delete: out of every picker, but the photo stays — past Lifestyle and
 * Campaign Kit runs point at it (`params.modelId`) and still show it. Any
 * future storage sweep must leave a model's photo alone while a run refers to
 * it; `purgeModel` is the one path that really removes it.
 *
 * The creator, or an admin — who is the one who shared a model with the whole
 * organization in the first place, and so has to be able to take it back out
 * of everyone's picker.
 */
async function deleteModel({ dbUser, id, isAdmin = false }) {
  const row = await LifestyleModel.findOne({ _id: id, tenantId: dbUser.tenantId, deletedAt: null });
  if (!row) return null;
  if (!isAdmin && String(row.userId) !== String(dbUser._id)) {
    const err = new Error("you can only delete your own models");
    err.code = "forbidden";
    throw err;
  }

  row.deletedAt = new Date();
  row.status = "archived";
  await row.save();
  return toPublicModel(row, dbUser);
}

/** One model, if this person may use it. Used by the queue route to resolve a pick. */
async function findUsableModel({ dbUser, id }) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return LifestyleModel.findOne({
    _id: id,
    tenantId: dbUser.tenantId,
    deletedAt: null,
    ...reachFilter(dbUser),
  }).lean();
}

/**
 * What a run records about its model instead of a copy of the photo: the
 * library row and the exact photo it used. The key, not just the id — the
 * photo is never replaced in place (see models/lifestyleModel.js), so this
 * pins what the run was given.
 */
function toModelRef(row) {
  return {
    id: String(row._id),
    r2Key: row.r2Key,
    url: row.imageUrl,
    thumbnailUrl: row.thumbnailUrl || row.imageUrl,
    name: row.name,
  };
}

/** The run's input entry for its model — a snapshot that points at the library photo. */
function modelPointer(ref) {
  return { assetId: ref.id, url: ref.url, thumbnailUrl: ref.thumbnailUrl, role: "model", type: "image" };
}

/**
 * The photo's bytes, read when the job runs rather than carried through
 * Redis. Read by key with no visibility check on purpose: the route checked
 * this person could use the model when they queued the run, and a model made
 * private or deleted while the run waited in the queue still runs.
 */
async function loadModelImage(ref) {
  const buffer = await getObject(ref.r2Key);
  return { mimeType: mimeForKey(ref.r2Key), base64: buffer.toString("base64") };
}

/**
 * Hard delete, admins only — for a photo that must really go (a real person
 * asked for theirs to be removed). Deletes the photo and its thumbnail from
 * R2 and swaps it for "model removed" in every run and Campaign Kit that
 * pointed at it. Runs from before model references (which kept their own
 * copy) are not touched.
 */
async function purgeModel({ dbUser, id }) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const row = await LifestyleModel.findOne({ _id: id, tenantId: dbUser.tenantId, purgedAt: null });
  if (!row) return null;

  // The photo and the thumbnail written beside it (see storage/libraryImage.js).
  const keys = [row.r2Key, variantKeyFor(row.r2Key, "thumb", THUMB_EXTENSION)];
  for (const key of keys) {
    await deleteObject(key).catch((err) => console.error(`[lifestyle-models] could not delete ${key}:`, err.message));
  }

  const modelId = row._id;
  await Generation.updateMany(
    { tenantId: dbUser.tenantId, "request.inputAssets.assetId": modelId },
    { $set: { "request.inputAssets.$[m].url": MODEL_REMOVED_URL, "request.inputAssets.$[m].thumbnailUrl": MODEL_REMOVED_URL } },
    { arrayFilters: [{ "m.assetId": modelId, "m.role": "model" }] }
  );
  await MarketingKit.updateMany(
    { tenantId: dbUser.tenantId, "campaign.modelImage.r2Key": row.r2Key },
    { $set: { "campaign.modelImage.url": MODEL_REMOVED_URL, "campaign.modelImage.thumbnailUrl": MODEL_REMOVED_URL } }
  );

  row.purgedAt = new Date();
  row.deletedAt = row.deletedAt || row.purgedAt;
  row.status = "archived";
  row.imageUrl = MODEL_REMOVED_URL;
  row.thumbnailUrl = MODEL_REMOVED_URL;
  await row.save();
  return toPublicModel(row, dbUser);
}

module.exports = {
  listModels,
  createModel,
  renameModel,
  setModelPublic,
  deleteModel,
  purgeModel,
  findUsableModel,
  toModelRef,
  modelPointer,
  loadModelImage,
};
