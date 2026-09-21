const mongoose = require("mongoose");
const LifestyleModel = require("../models/lifestyleModel");
const { buildLibraryKey, variantKeyFor, uploadObject, publicUrlFor } = require("../storage/r2");
const { createThumbnail, THUMB_EXTENSION } = require("../storage/thumbnail");
const { parseDataUri } = require("../generationService");

/**
 * Saved Lifestyle models — the people jewellery gets placed onto.
 *
 * Separate from the queue entirely. Saving one is an upload, renaming one is
 * a field write, and neither is worth a job: the only slow part of this tool
 * is *generating* a model, which does go through the queue (see
 * jobs/lifestyle.js) and lands here afterwards.
 */

const EXTENSION_BY_MIME = { "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

function extensionFor(mimeType) {
  return EXTENSION_BY_MIME[mimeType] || "jpg";
}

/** The client-facing shape. Never the R2 key — that is ours, not the browser's. */
function toPublicModel(row) {
  return {
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
 * Everything this person may pick from: their own models, plus whatever the
 * organization has shared.
 *
 * One query rather than two and a merge — a model shared by its own creator
 * would otherwise appear twice in their picker.
 */
async function listModels(dbUser) {
  const rows = await LifestyleModel.find({
    tenantId: dbUser.tenantId,
    deletedAt: null,
    status: "active",
    $or: [{ userId: dbUser._id }, { isPublic: true }],
  })
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();

  return rows.map(toPublicModel);
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

  const buffer = Buffer.from(image.base64, "base64");
  const id = new mongoose.Types.ObjectId();
  const key = buildLibraryKey({
    tenantId: dbUser.tenantId,
    userId: dbUser._id,
    collection: "lifestyle-models",
    id,
    extension: extensionFor(image.mimeType),
  });

  await uploadObject(key, buffer, image.mimeType);

  // Best-effort, exactly as for a generated asset: a picker that falls back
  // to the full-size photo is slower, not broken.
  let thumbnailUrl = null;
  try {
    const thumb = await createThumbnail(buffer);
    const thumbKey = variantKeyFor(key, "thumb", THUMB_EXTENSION);
    await uploadObject(thumbKey, thumb.buffer, thumb.mimeType);
    thumbnailUrl = publicUrlFor(thumbKey);
  } catch (err) {
    console.error(`[lifestyle-models] could not build a thumbnail for ${key}:`, err.message);
  }

  const row = await LifestyleModel.create({
    _id: id,
    tenantId: dbUser.tenantId,
    userId: dbUser._id,
    userName: dbUser.name || dbUser.email,
    name: (name || "").trim() || defaultName(attrs),
    attrs,
    notes: notes?.trim() || null,
    imageUrl: publicUrlFor(key),
    thumbnailUrl,
    r2Key: key,
  });

  return toPublicModel(row);
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
  return toPublicModel(row);
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
  return toPublicModel(row);
}

/**
 * Soft delete. The R2 object is left for the purge sweep.
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
  return toPublicModel(row);
}

/** One model, if this person may use it. Used by the queue route to resolve a pick. */
async function findUsableModel({ dbUser, id }) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return LifestyleModel.findOne({
    _id: id,
    tenantId: dbUser.tenantId,
    deletedAt: null,
    $or: [{ userId: dbUser._id }, { isPublic: true }],
  }).lean();
}

module.exports = {
  listModels,
  createModel,
  renameModel,
  setModelPublic,
  deleteModel,
  findUsableModel,
  toPublicModel,
};
