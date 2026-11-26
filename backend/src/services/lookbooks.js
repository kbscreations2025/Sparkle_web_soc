const crypto = require("crypto");
const mongoose = require("mongoose");
const sharp = require("sharp");
const Lookbook = require("../models/lookbook");
const LookbookSlug = require("../models/lookbookSlug");
const Asset = require("../models/asset");
const { parseDataUri } = require("../generationService");
const { uploadLibraryImage } = require("../storage/libraryImage");
const { buildLibraryKey, uploadObject, publicUrlFor } = require("../storage/r2");
const { isOwnPublicUrl } = require("../storage/ownUrl");
const { parseDesign, publicDesign, firstMedia, coverOf } = require("./lookbookDesign");

/**
 * Live Lookbooks: interactive pages a person builds from cards and shares as
 * a public link.
 *
 * Editing follows Marketing Kit's rule (services/marketingKits.js): only the
 * owner may read, change, publish or delete a lookbook, so every write
 * matches on tenant, user and id together. The one read without an owner is
 * `readPublished`, and it returns only the published snapshot.
 */

class LookbookError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const notFound = () => new LookbookError(404, "not_found", "That lookbook could not be found");

/* ── Link names ─────────────────────────────────────────────────────────── */

const SLUG_MIN = 3;
const SLUG_MAX = 60;

/**
 * A typed name as a link name: lower case, accents dropped, anything that
 * isn't a letter or digit turned into one hyphen. "Aurelia — Bridal '26"
 * becomes "aurelia-bridal-26".
 */
function normalizeSlug(input) {
  return String(input ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/, "");
}

/** Too short to be a name ("ab") gets a word added rather than refused. */
function usableBase(slug) {
  if (slug.length >= SLUG_MIN) return slug;
  return slug ? `${slug}-lookbook` : "lookbook";
}

/**
 * Builds the two collections' indexes before the first name is claimed. The
 * unique index on lookbook_slugs is what makes a claim safe, so it must exist
 * before anything relies on it. Cheap and idempotent, and run once per process.
 */
let indexesReady = null;
function ensureIndexes() {
  if (!indexesReady) {
    indexesReady = Promise.all([Lookbook.createIndexes(), LookbookSlug.createIndexes()]).catch((err) => {
      indexesReady = null;
      throw err;
    });
  }
  return indexesReady;
}

const sameId = (a, b) => Boolean(a) && Boolean(b) && String(a) === String(b);

/**
 * The first free name near `base`: "-2" to "-9", then the year, then four
 * random characters. A name this lookbook already holds counts as free.
 */
async function suggestSlug(base, lookbookId = null) {
  const stem = usableBase(base).slice(0, SLUG_MAX - 5).replace(/-+$/, "");
  const candidates = [2, 3, 4, 5, 6, 7, 8, 9].map((n) => `${stem}-${n}`).concat(`${stem}-${new Date().getFullYear()}`);
  const claims = await LookbookSlug.find({ slug: { $in: candidates } }).select("slug lookbookId").lean();
  const taken = new Set(claims.filter((claim) => !sameId(claim.lookbookId, lookbookId)).map((claim) => claim.slug));
  return candidates.find((candidate) => !taken.has(candidate)) ?? `${stem}-${crypto.randomBytes(2).toString("hex")}`;
}

/** Whether a typed name can be this lookbook's link, and a nearby one when it can't. */
async function checkSlug({ slug: input, lookbookId = null }) {
  const slug = normalizeSlug(input);
  if (slug.length < SLUG_MIN) return { slug, available: false, reason: "too_short" };
  const claim = await LookbookSlug.findOne({ slug }).select("lookbookId").lean();
  if (!claim || sameId(claim.lookbookId, lookbookId)) return { slug, available: true };
  return { slug, available: false, reason: "taken", suggestion: await suggestSlug(slug, lookbookId) };
}

/**
 * Makes `slug` this lookbook's current name. False when someone else's
 * lookbook holds it. A name this lookbook was published under before (an old
 * link) is taken back as its current one.
 */
async function claimSlug(lookbook, slug) {
  await ensureIndexes();
  try {
    await LookbookSlug.create({ slug, lookbookId: lookbook._id, tenantId: lookbook.tenantId, current: true });
    return true;
  } catch (err) {
    if (err.code !== 11000) throw err;
    const own = await LookbookSlug.findOneAndUpdate({ slug, lookbookId: lookbook._id }, { $set: { current: true } });
    return Boolean(own);
  }
}

/**
 * The name a lookbook is moving away from. Once the page has been published
 * the old link may already be in someone's chat, so it stays and redirects.
 * Before that, nobody has it, and the name goes back for anyone to use.
 */
async function retireSlug(lookbook, slug) {
  if (!slug) return;
  if (lookbook.firstPublishedAt) {
    await LookbookSlug.updateOne({ slug, lookbookId: lookbook._id }, { $set: { current: false } });
  } else {
    await LookbookSlug.deleteOne({ slug, lookbookId: lookbook._id });
  }
}

/** Claims `base`, or the nearest free name to it. */
async function claimNearest(lookbook, base) {
  const first = usableBase(base);
  if (await claimSlug(lookbook, first)) return first;
  // Each suggestion is re-checked by its claim: someone may take it in between.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const candidate = await suggestSlug(first, lookbook._id);
    if (await claimSlug(lookbook, candidate)) return candidate;
  }
  const fallback = `${first.slice(0, SLUG_MAX - 9)}-${crypto.randomBytes(4).toString("hex")}`;
  if (await claimSlug(lookbook, fallback)) return fallback;
  throw new Error("could not find a free link name");
}

/* ── Shapes sent to the browser ─────────────────────────────────────────── */

function toSummary(doc) {
  return {
    id: String(doc._id),
    title: doc.title,
    slug: doc.slug,
    status: doc.status,
    // A published page whose working copy has moved on since.
    hasUnpublishedChanges: doc.status === "published" && Boolean(doc.published) && doc.published.revision !== doc.revision,
    coverUrl: doc.coverUrl ?? null,
    publishedAt: doc.published?.publishedAt ?? null,
    firstPublishedAt: doc.firstPublishedAt ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/** The owner's view: everything the builder needs to reopen the page. */
async function toOwnerLookbook(doc) {
  const oldLinks = await LookbookSlug.find({ lookbookId: doc._id, current: false }).select("slug").sort({ _id: -1 }).lean();
  return {
    ...toSummary(doc),
    design: doc.design,
    revision: doc.revision,
    previousSlugs: oldLinks.map((claim) => claim.slug),
  };
}

const ownerFilter = (dbUser, id) => ({ _id: id, tenantId: dbUser.tenantId, userId: dbUser._id, deletedAt: null });

async function findOwn(dbUser, id) {
  if (!mongoose.Types.ObjectId.isValid(id)) throw notFound();
  const doc = await Lookbook.findOne(ownerFilter(dbUser, id));
  if (!doc) throw notFound();
  return doc;
}

const cleanTitle = (value, fallback = "Untitled lookbook") =>
  (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 200) : "") || fallback;

/* ── The owner's operations ─────────────────────────────────────────────── */

async function listLookbooks({ dbUser }) {
  const rows = await Lookbook.find({ tenantId: dbUser.tenantId, userId: dbUser._id, deletedAt: null })
    // A list needs names and dates, not whole pages.
    .select("-design -published.design")
    .sort({ _id: -1 })
    .limit(200)
    .lean();
  return rows.map(toSummary);
}

async function getLookbook({ dbUser, id }) {
  return toOwnerLookbook(await findOwn(dbUser, id));
}

/** A new lookbook, usually straight from a template, with a link name taken from its title. */
async function createLookbook({ dbUser, title, design: raw }) {
  const design = parseDesign(raw);
  const doc = await Lookbook.create({
    tenantId: dbUser.tenantId,
    userId: dbUser._id,
    userName: dbUser.name || dbUser.email || "Unknown",
    title: cleanTitle(title),
    design,
    coverUrl: coverOf(design),
  });
  doc.slug = await claimNearest(doc, normalizeSlug(doc.title));
  await doc.save();
  return toOwnerLookbook(doc);
}

/**
 * An edit from the builder: the title, the whole design, or both.
 *
 * `revision` is the save the builder last saw. A save against an older one
 * means the page was changed somewhere else since (another tab, another
 * device), and is refused rather than quietly overwriting that work. The
 * check and the write are one update, so two saves can't both pass it.
 */
async function saveLookbook({ dbUser, id, changes }) {
  if (!mongoose.Types.ObjectId.isValid(id)) throw notFound();
  const set = {};
  if (typeof changes.title === "string") set.title = cleanTitle(changes.title);
  if (changes.design !== undefined) {
    const design = parseDesign(changes.design);
    set.design = design;
    set.coverUrl = coverOf(design);
  }

  const filter = ownerFilter(dbUser, id);
  const expected = Number(changes.revision);
  if (Number.isInteger(expected)) filter.revision = expected;

  const doc = await Lookbook.findOneAndUpdate(filter, { $set: set, $inc: { revision: 1 } }, { returnDocument: "after" })
    .select("-design -published.design")
    .lean();
  // No design in the answer: the builder keeps its own copy, which may
  // already be ahead of this save, and must not be replaced by it.
  if (doc) return { ...toSummary(doc), revision: doc.revision };

  const current = await Lookbook.findOne(ownerFilter(dbUser, id)).select("revision").lean();
  if (!current) throw notFound();
  throw new LookbookError(409, "stale", "This lookbook was changed in another tab or on another device.", {
    revision: current.revision,
  });
}

/** Gives the page a new link name. Returns the names whose public page this changes. */
async function renameSlug({ dbUser, id, slug: input }) {
  const doc = await findOwn(dbUser, id);
  const slug = normalizeSlug(input);
  if (slug.length < SLUG_MIN) {
    throw new LookbookError(400, "invalid_slug", "Use at least 3 letters or numbers for the link name.");
  }
  const previous = doc.slug;
  if (slug === previous) return { lookbook: await toOwnerLookbook(doc), changedSlugs: [] };

  if (!(await claimSlug(doc, slug))) {
    throw new LookbookError(409, "slug_taken", "That link name is already taken.", {
      suggestion: await suggestSlug(slug, doc._id),
    });
  }
  await retireSlug(doc, previous);
  doc.slug = slug;
  await doc.save();
  return { lookbook: await toOwnerLookbook(doc), changedSlugs: [previous, slug].filter(Boolean) };
}

/**
 * Publishes the working copy as it stands. The snapshot has hidden cards and
 * hidden prices taken out here, once, so the public read only ever returns
 * what was meant to be seen.
 */
async function publishLookbook({ dbUser, id }) {
  const doc = await findOwn(dbUser, id);
  const design = publicDesign(doc.design);
  if (design.cards.length === 0) {
    throw new LookbookError(400, "empty", "Add at least one visible card before publishing.");
  }
  if (!doc.slug) doc.slug = await claimNearest(doc, normalizeSlug(doc.title));

  const now = new Date();
  doc.published = {
    design,
    title: doc.title,
    revision: doc.revision,
    publishedAt: now,
    ogImageUrl: null,
  };
  doc.status = "published";
  if (!doc.firstPublishedAt) doc.firstPublishedAt = now;
  await doc.save();

  // Made after answering: it only matters once the link is shared, and
  // Publish shouldn't wait seconds on it. Until it lands, the page offers
  // the lead picture's thumbnail for previews instead.
  buildSocialImage(doc).catch((err) => console.error(`[lookbook] link preview for ${doc._id} failed:`, err.message));

  return toOwnerLookbook(doc);
}

/** Takes the page down. The link answers "not available" from now on; the work stays. */
async function unpublishLookbook({ dbUser, id }) {
  const doc = await findOwn(dbUser, id);
  doc.status = "draft";
  doc.published = null;
  await doc.save();
  return toOwnerLookbook(doc);
}

async function duplicateLookbook({ dbUser, id }) {
  const doc = await findOwn(dbUser, id);
  return createLookbook({
    dbUser,
    title: `${doc.title} (copy)`.slice(0, 200),
    design: JSON.stringify(doc.design ?? { version: 1, theme: {}, cards: [], meta: {} }),
  });
}

/**
 * Soft delete, as everywhere else: the document stays, the pictures are left
 * for the purge sweep. Its link names are freed, and the slugs are returned
 * so the frontend can drop any cached copy of the page.
 */
async function deleteLookbook({ dbUser, id }) {
  const doc = await findOwn(dbUser, id);
  doc.deletedAt = new Date();
  doc.status = "draft";
  doc.published = null;
  await doc.save();
  const claims = await LookbookSlug.find({ lookbookId: doc._id }).select("slug").lean();
  await LookbookSlug.deleteMany({ lookbookId: doc._id });
  return { id: String(doc._id), deleted: true, changedSlugs: claims.map((claim) => claim.slug) };
}

/* ── Pictures and clips ─────────────────────────────────────────────────── */

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];
const VIDEO_TYPES = { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" };

/**
 * What a browser will show: its size (EXIF orientation 5–8 turns a photo on
 * its side), and whether it can be see-through. The thumbnail of a cutout is
 * flattened onto white, so the page shows such a picture from its original.
 * Header reads only, no decode.
 */
async function inspect(buffer) {
  try {
    const { width, height, orientation, hasAlpha } = await sharp(buffer, { failOn: "none" }).metadata();
    const alpha = Boolean(hasAlpha);
    if (!width || !height) return { width: null, height: null, alpha };
    return orientation >= 5 ? { width: height, height: width, alpha } : { width, height, alpha };
  } catch {
    return { width: null, height: null, alpha: false };
  }
}

/**
 * One photo or clip added to a page from the person's device.
 *
 * Stored exactly as it arrived (the bytes go to R2 unchanged, see
 * storage/libraryImage.js), with a grid-sized copy beside a photo for the
 * builder. The public page shows the original, so whatever quality the
 * photographer delivered is what a client sees.
 */
async function uploadMedia({ dbUser, id, file }) {
  const doc = await findOwn(dbUser, id);
  const parsed = parseDataUri(typeof file === "string" ? file : "");
  if (!parsed) throw new LookbookError(400, "invalid", "That file isn't a photo or a video.");

  const common = { tenantId: dbUser.tenantId, userId: dbUser._id, collection: `lookbooks/${doc._id}` };
  const mediaId = new mongoose.Types.ObjectId();

  if (IMAGE_TYPES.includes(parsed.mimeType)) {
    const buffer = Buffer.from(parsed.base64, "base64");
    const [stored, info] = await Promise.all([
      uploadLibraryImage({ ...common, id: mediaId, image: parsed, logTag: "lookbook" }),
      inspect(buffer),
    ]);
    return {
      kind: "image",
      url: stored.url,
      thumbnailUrl: stored.thumbnail?.url ?? stored.url,
      width: info.width,
      height: info.height,
      ...(info.alpha ? { alpha: true } : {}),
    };
  }

  const extension = VIDEO_TYPES[parsed.mimeType];
  if (extension) {
    const key = buildLibraryKey({ ...common, id: mediaId, extension });
    await uploadObject(key, Buffer.from(parsed.base64, "base64"), parsed.mimeType);
    return { kind: "video", url: publicUrlFor(key), posterUrl: null, width: null, height: null };
  }

  throw new LookbookError(400, "invalid", "Use a JPEG, PNG, WebP or GIF photo, or an MP4 or WebM video.");
}

/**
 * The person's own Image to Video results, newest first — what the Turntable
 * card offers. Read off the assets collection, where every clip already is.
 */
async function listVideos({ dbUser, before, limit }) {
  const size = Math.min(Math.max(Number(limit) || 24, 1), 60);
  const filter = {
    tenantId: dbUser.tenantId,
    // Leads with (tenantId, tool) so the (tenantId, tool, _id) index carries the sort.
    tool: "image_to_video",
    userId: dbUser._id,
    type: "video",
    role: "generated",
    deletedAt: null,
  };
  if (before && mongoose.Types.ObjectId.isValid(before)) filter._id = { $lt: new mongoose.Types.ObjectId(String(before)) };

  const rows = await Asset.find(filter)
    .sort({ _id: -1 })
    .limit(size + 1)
    .select("s3Key thumbnail width height durationMs createdAt")
    .lean();
  const page = rows.slice(0, size);
  return {
    items: page.map((asset) => ({
      id: String(asset._id),
      url: publicUrlFor(asset.s3Key),
      posterUrl: asset.thumbnail?.s3Key ? publicUrlFor(asset.thumbnail.s3Key) : null,
      width: asset.width ?? null,
      height: asset.height ?? null,
      durationMs: asset.durationMs ?? null,
      createdAt: asset.createdAt,
    })),
    nextCursor: rows.length > size ? String(page[page.length - 1]._id) : null,
  };
}

/* ── Link previews ──────────────────────────────────────────────────────── */

const SOCIAL_WIDTH = 1200;
const SOCIAL_HEIGHT = 630;
/** Past this many pixels the original is too heavy to decode on a small API box; the thumbnail stands in. */
const SOCIAL_SOURCE_MAX_PIXELS = 36_000_000;

function hexToRgb(hex) {
  const match = /^#([0-9a-f]{6})/i.exec(String(hex || ""));
  if (!match) return { r: 12, g: 12, b: 12 };
  const value = parseInt(match[1], 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

/**
 * The picture WhatsApp and friends show for the link: the page's lead photo,
 * whole, on the page's own background, as a 1200×630 JPEG.
 *
 * Made for link previews only, never shown on the page itself. Previews want
 * a JPEG of a few hundred KB at most, and WhatsApp in particular drops a
 * preview image much larger than that. Neither the originals (many MB) nor
 * the WebP thumbnails fit. The photo is contained, not cropped, so a ring
 * shot in portrait keeps the ring.
 */
async function buildSocialImage(doc) {
  const media = firstMedia(doc.published?.design);
  if (!media) return;
  const pixels = (media.width || 0) * (media.height || 0);
  const sourceUrl = pixels && pixels <= SOCIAL_SOURCE_MAX_PIXELS ? media.url : media.thumbnailUrl || media.url;
  if (!isOwnPublicUrl(sourceUrl)) return;

  const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`could not fetch the lead picture (${response.status})`);
  const input = Buffer.from(await response.arrayBuffer());

  const background = hexToRgb(doc.published.design.theme?.bgColor);
  const jpeg = await sharp(input, { failOn: "none", limitInputPixels: 100_000_000 })
    .rotate()
    .resize({ width: SOCIAL_WIDTH, height: SOCIAL_HEIGHT, fit: "contain", background, kernel: "lanczos3" })
    .flatten({ background })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();

  const key = buildLibraryKey({
    tenantId: doc.tenantId,
    userId: doc.userId,
    collection: `lookbooks/${doc._id}`,
    id: `social-${doc.published.revision}-${Date.now()}`,
    extension: "jpg",
  });
  await uploadObject(key, jpeg, "image/jpeg");
  // Only onto the publish it was made for: a newer publish has its own on the way.
  await Lookbook.updateOne(
    { _id: doc._id, "published.publishedAt": doc.published.publishedAt },
    { $set: { "published.ogImageUrl": publicUrlFor(key) } }
  );
}

/* ── The public read ────────────────────────────────────────────────────── */

/** The access rules of later phases, honoured already so an early write can't open a page wider than meant. */
function isOpenToPublic(doc) {
  if (doc.access?.pinHash) return false;
  if (doc.access?.expiresAt && new Date(doc.access.expiresAt) <= new Date()) return false;
  return true;
}

/**
 * A published page by its link name, for anyone.
 *
 * Returns null for anything not to be shown (unknown, draft, deleted, past
 * its date), with no difference between those cases visible to the caller.
 * An old name, or one typed in different case, comes back as a redirect to
 * the current name. Only the published snapshot is returned, never the
 * working copy, and nothing about who owns it.
 */
async function readPublished(rawSlug) {
  const typed = String(rawSlug || "").slice(0, 200);
  const slug = normalizeSlug(typed);
  if (slug.length < SLUG_MIN) return null;

  const claim = await LookbookSlug.findOne({ slug }).select("lookbookId current").lean();
  if (!claim) return null;
  const doc = await Lookbook.findOne({ _id: claim.lookbookId, deletedAt: null, status: "published" })
    .select("slug title published access")
    .lean();
  if (!doc?.published || !isOpenToPublic(doc)) return null;

  if (!claim.current || doc.slug !== typed) return { redirect: doc.slug };

  const { design } = doc.published;
  const lead = firstMedia(design);
  return {
    lookbook: {
      slug: doc.slug,
      title: design.meta?.title || doc.published.title || doc.title,
      description: design.meta?.description || "",
      design,
      publishedAt: doc.published.publishedAt,
      // The made-for-previews JPEG, or the lead photo's thumbnail until it exists.
      shareImage: doc.published.ogImageUrl
        ? { url: doc.published.ogImageUrl, width: SOCIAL_WIDTH, height: SOCIAL_HEIGHT, type: "image/jpeg" }
        : lead
          ? { url: lead.thumbnailUrl || lead.url, width: null, height: null, type: null }
          : null,
    },
  };
}

module.exports = {
  LookbookError,
  normalizeSlug,
  checkSlug,
  listLookbooks,
  getLookbook,
  createLookbook,
  saveLookbook,
  renameSlug,
  publishLookbook,
  unpublishLookbook,
  duplicateLookbook,
  deleteLookbook,
  uploadMedia,
  listVideos,
  readPublished,
};
