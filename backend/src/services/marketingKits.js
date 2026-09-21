const mongoose = require("mongoose");
const config = require("../config");
const MarketingKit = require("../models/marketingKit");
const { hasPermission } = require("../permissions");
const { buildLibraryKey, variantKeyFor, uploadObject, publicUrlFor } = require("../storage/r2");
const { createThumbnail, THUMB_EXTENSION } = require("../storage/thumbnail");

/**
 * Saved Marketing Kits — the documents the Brand Story and Affinity result
 * views reopen and edit.
 *
 * Written by the worker at the end of a run rather than by a follow-up call
 * from the browser, so each photo and sheet page is uploaded to R2 exactly
 * once instead of being sent a second time purely to be persisted. For an
 * eight-piece kit that second trip was tens of megabytes.
 */

const EXTENSION_BY_MIME = { "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 50;

function extensionFor(mimeType) {
  return EXTENSION_BY_MIME[mimeType] || "jpg";
}

/**
 * Uploads one picture and returns the subdocument describing it.
 *
 * `image` is already parsed to `{ mimeType, base64 }` by the route, so this
 * never re-parses a data URI — the same rule the generation path follows.
 */
async function storeImage({ tenantId, userId, kitId, role, image, fileName = null, pdfName = null, pdfPage = null }) {
  const buffer = Buffer.from(image.base64, "base64");
  const id = new mongoose.Types.ObjectId();

  const key = buildLibraryKey({
    tenantId,
    userId,
    collection: `marketing-kits/${kitId}`,
    id,
    extension: extensionFor(image.mimeType),
  });

  await uploadObject(key, buffer, image.mimeType);

  /*
   * A grid-sized copy beside the original, the same way an Asset gets one.
   *
   * Not optional in practice: the kits rail and the Affinity grid render
   * every piece at once, and an eight-piece deck of full-size photos is
   * tens of megabytes on every page view. Best-effort all the same — a
   * resize that throws costs bandwidth, and every reader falls back to the
   * original.
   */
  let thumbnail = null;
  let dimensions = { width: null, height: null };
  try {
    const thumb = await createThumbnail(buffer);
    const thumbKey = variantKeyFor(key, "thumb", THUMB_EXTENSION);
    await uploadObject(thumbKey, thumb.buffer, thumb.mimeType);
    thumbnail = { r2Key: thumbKey, url: publicUrlFor(thumbKey) };
    dimensions = { width: thumb.sourceWidth, height: thumb.sourceHeight };
  } catch (err) {
    console.error(`[marketing-kit] could not build a thumbnail for ${key}:`, err.message);
  }

  return {
    _id: id,
    role,
    r2Bucket: config.r2.bucket,
    r2Key: key,
    url: publicUrlFor(key),
    thumbnailKey: thumbnail?.r2Key ?? null,
    thumbnailUrl: thumbnail?.url ?? null,
    mimeType: image.mimeType,
    sizeBytes: buffer.length,
    width: dimensions.width,
    height: dimensions.height,
    fileName,
    pdfName,
    pdfPage,
  };
}

/** Uploads a list in parallel — a kit's pages are independent of each other. */
function storeImages({ tenantId, userId, kitId, role, images = [] }) {
  return Promise.all(images.map((image) => storeImage({ tenantId, userId, kitId, role, image })));
}

/**
 * A Brand Story kit: the photos it was written from, and the narrative.
 *
 * `originalAnalysis` is written alongside `analysis` and never touched
 * again, so a kit edited months later can still show what the model
 * actually wrote versus what a person changed.
 */
async function saveBrandStoryKit({ dbUser, kitId, model, images, sheetImages, analysis, generationId = null }) {
  const common = { tenantId: dbUser.tenantId, userId: dbUser._id, kitId };

  const [storedImages, storedSheets] = await Promise.all([
    storeImages({ ...common, role: "product", images }),
    storeImages({ ...common, role: "sheet", images: sheetImages }),
  ]);

  const kit = await MarketingKit.create({
    _id: kitId,
    tenantId: dbUser.tenantId,
    userId: dbUser._id,
    userName: dbUser.name || dbUser.email,
    kind: "brand_story",
    title: firstLineOf(analysis),
    status: "ready",
    model,
    generationId,
    brandStory: {
      images: storedImages,
      sheetImages: storedSheets,
      analysis,
      originalAnalysis: analysis,
    },
  });

  return toPublicKit(kit);
}

/**
 * An Affinity kit: every piece with its own photo and sheet, plus the
 * catalog copy written for the set.
 */
async function saveAffinityKit({ dbUser, kitId, model, collectionName, tagline, items, pieces, generationId = null }) {
  const common = { tenantId: dbUser.tenantId, userId: dbUser._id, kitId };

  const storedPieces = await Promise.all(
    pieces.map(async (piece) => {
      const [productImage, sheetImages] = await Promise.all([
        piece.image ? storeImage({ ...common, role: "product", image: piece.image }) : null,
        storeImages({ ...common, role: "sheet", images: piece.sheetImages }),
      ]);

      return {
        index: piece.index,
        productImage,
        sheetImages,
        sheetExcel: piece.sheetExcel || [],
        designerInitial: piece.designerInitial || "",
        hasProductionSheet: sheetImages.length > 0 || (piece.sheetExcel?.length ?? 0) > 0,
      };
    })
  );

  const kit = await MarketingKit.create({
    _id: kitId,
    tenantId: dbUser.tenantId,
    userId: dbUser._id,
    userName: dbUser.name || dbUser.email,
    kind: "affinity",
    title: collectionName || "Untitled Collection",
    status: "ready",
    model,
    generationId,
    affinity: {
      pieces: storedPieces,
      collectionName,
      tagline,
      coverSplit: 50,
      items,
      // Same reasoning as `originalAnalysis`: what the model wrote, kept
      // apart from what a person subsequently rewrote.
      originalItems: items,
    },
  });

  return toPublicKit(kit);
}

/**
 * A Campaign Kit: the four shots, and what they were made from.
 *
 * The shots are already stored — the image runner wrote them as Assets — so
 * this records pointers to them rather than uploading the same bytes again.
 * Only the inputs are stored here, because they are what a re-run would
 * need and nothing else holds them.
 */
async function saveCampaignKit({
  dbUser,
  kitId,
  model,
  modelImage,
  sourceImages,
  shots,
  options,
  generationId = null,
}) {
  const common = { tenantId: dbUser.tenantId, userId: dbUser._id, kitId };

  const [storedModel, storedSources] = await Promise.all([
    modelImage ? storeImage({ ...common, role: "model", image: modelImage }) : null,
    storeImages({ ...common, role: "product", images: sourceImages }),
  ]);

  const kit = await MarketingKit.create({
    _id: kitId,
    tenantId: dbUser.tenantId,
    userId: dbUser._id,
    userName: dbUser.name || dbUser.email,
    kind: "campaign",
    title: options?.description?.trim()?.slice(0, 300) || "Campaign Kit",
    status: "ready",
    model,
    generationId,
    campaign: {
      modelImage: storedModel,
      sourceImages: storedSources,
      shots,
      options: options || {},
      originalShots: shots,
    },
  });

  return toPublicKit(kit);
}

/** A readable title for a narrative, from its own first line. */
function firstLineOf(text) {
  const line = String(text || "")
    .split("\n")
    .map((entry) => entry.trim())
    .find(Boolean);
  // The narrative opens with "1. Collection Name" followed by the name, so
  // the numbering is stripped rather than shown as part of the title.
  return (line || "Untitled kit").replace(/^\d+\.\s*/, "").slice(0, 300);
}

/**
 * Saving a kit must never cost someone the result they just waited for.
 *
 * The narrative or the catalog copy is already in hand by the time this
 * runs, and an R2 hiccup here is a document that didn't get filed, not work
 * that didn't happen. So the failure is swallowed and the job still returns
 * its text.
 *
 * But not silently: a `failed` row is written in place of the kit, carrying
 * the reason. Without it the run leaves no trace at all — the user has a
 * result on screen, nothing in their kits rail, and no way to find out why.
 * That marker is itself best-effort; if Mongo is the thing that is down,
 * there is nowhere left to record anything.
 */
async function saveKitSafely(save, { kind, kitId, dbUser, model, generationId = null }) {
  try {
    return await save();
  } catch (err) {
    console.error(`[marketing-kit] could not save the ${kind} kit:`, err.message);

    try {
      await MarketingKit.create({
        _id: kitId,
        tenantId: dbUser.tenantId,
        userId: dbUser._id,
        userName: dbUser.name || dbUser.email,
        kind,
        title: "Could not be saved",
        status: "failed",
        model,
        generationId,
        error: err.message?.slice(0, 500) ?? "unknown error",
      });
    } catch (markerErr) {
      console.error(`[marketing-kit] could not even record the failure:`, markerErr.message);
    }

    return null;
  }
}

/**
 * Summaries only — a listing needs a name, a date and one thumbnail.
 *
 * The preview is the grid-sized copy wherever there is one: the rail
 * renders every kit at once, and pulling originals for it is the whole
 * reason those copies exist.
 */
function toKitSummary(kit) {
  const cover =
    kit.kind === "brand_story"
      ? kit.brandStory?.images?.[0]
      : kit.kind === "affinity"
        ? kit.affinity?.pieces?.find((piece) => piece.productImage)?.productImage
        : // A campaign kit leads with what it produced, not what went in.
          kit.campaign?.shots?.[0] ?? kit.campaign?.sourceImages?.[0];

  return {
    id: String(kit._id),
    kind: kit.kind,
    title: kit.title,
    status: kit.status,
    error: kit.error ?? null,
    previewUrl: cover?.thumbnailUrl || cover?.url || null,
    pieceCount: countFor(kit),
    userName: kit.userName,
    createdAt: kit.createdAt,
    updatedAt: kit.updatedAt,
  };
}

/** What "how much is in here" means for each kind. */
function countFor(kit) {
  if (kit.kind === "affinity") return kit.affinity?.pieces?.length ?? 0;
  if (kit.kind === "campaign") return kit.campaign?.shots?.length ?? 0;
  return kit.brandStory?.images?.length ?? 0;
}

/** One kit in full — what a result view reopens from. */
function toPublicKit(kit) {
  return {
    ...toKitSummary(kit),
    model: kit.model,
    generationId: kit.generationId ? String(kit.generationId) : null,
    brandStory: kit.brandStory
      ? {
          images: kit.brandStory.images.map(toPublicImage),
          sheetImages: kit.brandStory.sheetImages.map(toPublicImage),
          analysis: kit.brandStory.analysis,
          originalAnalysis: kit.brandStory.originalAnalysis,
        }
      : null,
    affinity: kit.affinity
      ? {
          collectionName: kit.affinity.collectionName,
          tagline: kit.affinity.tagline,
          coverSplit: kit.affinity.coverSplit,
          items: kit.affinity.items,
          originalItems: kit.affinity.originalItems,
          pieces: kit.affinity.pieces.map((piece) => ({
            index: piece.index,
            productImage: piece.productImage ? toPublicImage(piece.productImage) : null,
            sheetImages: piece.sheetImages.map(toPublicImage),
            // The extracted text is not sent back: it is up to 200KB per
            // sheet, the view never renders it, and only the model needed it.
            sheetExcelCount: piece.sheetExcel?.length ?? 0,
            designerInitial: piece.designerInitial,
            hasProductionSheet: piece.hasProductionSheet,
          })),
        }
      : null,
    campaign: kit.campaign
      ? {
          modelImage: kit.campaign.modelImage ? toPublicImage(kit.campaign.modelImage) : null,
          sourceImages: kit.campaign.sourceImages.map(toPublicImage),
          shots: kit.campaign.shots,
          originalShots: kit.campaign.originalShots,
          options: kit.campaign.options || {},
        }
      : null,
  };
}

/** The bucket and key are ours; a browser gets the url and the dimensions. */
function toPublicImage(image) {
  return {
    id: String(image._id),
    url: image.url,
    // Falls back to the original, so a picture whose resize failed is
    // heavier rather than missing.
    thumbnailUrl: image.thumbnailUrl || image.url,
    role: image.role,
    width: image.width ?? null,
    height: image.height ?? null,
    fileName: image.fileName ?? null,
    pdfName: image.pdfName ?? null,
    pdfPage: image.pdfPage ?? null,
  };
}

/**
 * Whose kits are in reach — the same rule History's grid follows, so the
 * Members filter means one thing across both tabs of that page.
 *
 * Own work only, unless the caller both holds `result.read.others` and asks
 * for the team; `dataScope` then decides how far "the team" reaches.
 */
function buildScopeFilter(dbUser, wantsTeam) {
  const filter = { tenantId: dbUser.tenantId, deletedAt: null };
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
 * The kits in reach, newest first.
 *
 * Cursor-paginated on `_id`, which carries its own creation time, so a kit
 * saved mid-scroll can't shift a later page onto a row already shown.
 */
async function listKits({ dbUser, kind, cursor, limit, scope }) {
  const query = buildScopeFilter(dbUser, scope === "team");
  if (kind) query.kind = kind;
  if (cursor && mongoose.Types.ObjectId.isValid(cursor)) query._id = { $lt: new mongoose.Types.ObjectId(cursor) };

  const size = Math.min(Math.max(Number(limit) || DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT);
  // One extra row, purely to learn whether there is another page.
  const rows = await MarketingKit.find(query).sort({ _id: -1 }).limit(size + 1);
  const page = rows.slice(0, size);

  return {
    // `isOwn` is what the grid hangs the delete button off — only the owner
    // may remove a kit, and the tile should not offer what the API refuses.
    kits: page.map((kit) => ({ ...toKitSummary(kit), isOwn: String(kit.userId) === String(dbUser._id) })),
    nextCursor: rows.length > size ? String(page[page.length - 1]._id) : null,
  };
}

/**
 * One kit in full.
 *
 * Read under the same reach as the listing — a kit a teammate can see in the
 * grid has to open when it is clicked. Editing and deleting stay the owner's
 * (see below), so this widens reading only.
 */
async function getKit({ dbUser, id }) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const kit = await MarketingKit.findOne({ ...buildScopeFilter(dbUser, true), _id: id });
  return kit ? toPublicKit(kit) : null;
}

/**
 * Applies an edit.
 *
 * Only the fields a person may change: the uploads and the `original*`
 * fields are absent by design, so an edit can never destroy the record of
 * what the model actually wrote.
 */
async function updateKit({ dbUser, id, changes }) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const kit = await MarketingKit.findOne({ _id: id, tenantId: dbUser.tenantId, userId: dbUser._id, deletedAt: null });
  if (!kit) return null;

  if (typeof changes.title === "string") kit.title = changes.title.slice(0, 300);

  if (kit.brandStory && typeof changes.analysis === "string") {
    kit.brandStory.analysis = changes.analysis.slice(0, 50_000);
  }

  if (kit.affinity) {
    if (typeof changes.collectionName === "string") kit.affinity.collectionName = changes.collectionName.slice(0, 300);
    if (typeof changes.tagline === "string") kit.affinity.tagline = changes.tagline.slice(0, 500);
    if (typeof changes.coverSplit === "number") {
      kit.affinity.coverSplit = Math.max(0, Math.min(100, changes.coverSplit));
    }
    if (Array.isArray(changes.items)) kit.affinity.items = changes.items.slice(0, 64);
  }

  if (kit.campaign && Array.isArray(changes.shots)) {
    /*
     * Captions only. A shot's id, label and url are what the run produced
     * and are not the user's to rewrite — accepting them would let a client
     * repoint a stored deck at any url it liked.
     */
    const captions = new Map(changes.shots.map((shot) => [shot.id, String(shot.caption ?? "").slice(0, 1000)]));
    kit.campaign.shots = kit.campaign.shots.map((shot) =>
      captions.has(shot.id) ? { ...shot.toObject?.() ?? shot, caption: captions.get(shot.id) } : shot
    );
  }

  await kit.save();
  return toPublicKit(kit);
}

/** Soft delete. The R2 objects are left for the purge sweep, as elsewhere. */
async function deleteKit({ dbUser, id }) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const kit = await MarketingKit.findOne({ _id: id, tenantId: dbUser.tenantId, userId: dbUser._id, deletedAt: null });
  if (!kit) return null;

  kit.deletedAt = new Date();
  await kit.save();
  return { id: String(kit._id), deleted: true };
}

module.exports = {
  saveBrandStoryKit,
  saveAffinityKit,
  saveCampaignKit,
  saveKitSafely,
  listKits,
  getKit,
  updateKit,
  deleteKit,
  toPublicKit,
  toKitSummary,
};
