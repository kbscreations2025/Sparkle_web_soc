const multer = require("multer");
const sharp = require("sharp");
const { isOwnPublicUrl } = require("../storage/ownUrl");

/*
 * Two ways an image now reaches a route without crossing the user's connection
 * as base64 text. Both hand the route the same `data:` URI it has always
 * received, so no route had to change.
 *
 * 1. Multipart uploads (`multipartBody`, mounted for every request). The
 *    browser sends a picked photo as a binary file part instead of base64
 *    inside JSON: about a quarter fewer bytes up, and no CORS preflight. The
 *    rest of the body travels as JSON in a `__json` field, with each file's
 *    place marked `__file:<n>`.
 *
 * 2. Stored images (`resolveStoredImages`, run by requireAuth once the
 *    caller is known). Editing a past result used to mean the browser
 *    downloading the whole image as base64 and uploading it straight back,
 *    twice its size over the user's link for bytes already in the bucket.
 *    Now it sends `stored:<url>` and this server fetches the image itself.
 */

/** Per file. Matches the JSON body limit these images used to travel inside. */
const MAX_FILE_BYTES = 25 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 40, fieldSize: 5 * 1024 * 1024 },
}).any();

const FILE_PLACEHOLDER = /^__file:(\d+)$/;
const STORED_PREFIX = "stored:";

/** Rebuilds every string in a JSON value through `fn` (which may be async), keeping its shape. */
async function mapStrings(value, fn, key) {
  if (typeof value === "string") return fn(value, key);
  if (Array.isArray(value)) return Promise.all(value.map((item) => mapStrings(item, fn, key)));
  if (value && typeof value === "object") {
    const out = {};
    for (const [childKey, child] of Object.entries(value)) out[childKey] = await mapStrings(child, fn, childKey);
    return out;
  }
  return value;
}

function fail(res, status, code, message) {
  return res.status(status).json({ status: "error", code, message });
}

function multipartBody(req, res, next) {
  if (!req.is("multipart/form-data")) return next();

  upload(req, res, async (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") return fail(res, 413, "too_large", "That image is too large to upload.");
      return fail(res, 400, "bad_upload", "The upload could not be read. Please try again.");
    }

    let body;
    try {
      body = JSON.parse(req.body?.__json ?? "{}");
    } catch {
      return fail(res, 400, "bad_upload", "The upload could not be read. Please try again.");
    }

    const files = new Map((req.files ?? []).map((file) => [file.fieldname, file]));
    req.body = await mapStrings(body, (value) => {
      const match = FILE_PLACEHOLDER.exec(value);
      const file = match && files.get(`file${match[1]}`);
      return file ? `data:${file.mimetype};base64,${file.buffer.toString("base64")}` : value;
    });
    req.files = undefined;
    next();
  });
}

class InlineImageError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Bounded: a bucket that doesn't answer must not hold the request open. */
const STORED_FETCH_TIMEOUT_MS = 30 * 1000;

/**
 * The queue's input preview is capped at 32KB (see queueGeneration), so a
 * `preview` given as a stored image is shrunk here, where the bytes are. The
 * browser can't do it: the bucket's images can't be read back from a page.
 */
async function toPreview(buffer) {
  const thumb = await sharp(buffer, { failOn: "none" })
    .rotate()
    .resize({ width: 160, height: 160, fit: "inside" })
    .jpeg({ quality: 70 })
    .toBuffer();
  return `data:image/jpeg;base64,${thumb.toString("base64")}`;
}

/**
 * Replaces every `stored:<url>` in the request body with that image as a
 * `data:` URI. Only this app's own bucket is fetched (see isOwnPublicUrl);
 * anything else is refused, so this can't be used to make the server request
 * an arbitrary address. Each url is fetched once, however many fields name it.
 */
async function resolveStoredImages(req) {
  if (!req.body || typeof req.body !== "object") return;

  const fetched = new Map();
  const load = (url) => {
    if (!fetched.has(url)) {
      fetched.set(
        url,
        (async () => {
          let response;
          try {
            response = await fetch(url, { signal: AbortSignal.timeout(STORED_FETCH_TIMEOUT_MS) });
          } catch {
            response = null;
          }
          if (!response?.ok) {
            throw new InlineImageError(502, "fetch_failed", "Couldn't load the stored image. Please try again.");
          }
          return {
            mimeType: response.headers.get("content-type") || "image/jpeg",
            buffer: Buffer.from(await response.arrayBuffer()),
          };
        })()
      );
    }
    return fetched.get(url);
  };

  req.body = await mapStrings(req.body, async (value, key) => {
    if (!value.startsWith(STORED_PREFIX)) return value;
    const url = value.slice(STORED_PREFIX.length);
    if (!isOwnPublicUrl(url)) {
      throw new InlineImageError(400, "invalid_image", "That image isn't one of Sparkle's stored images.");
    }
    const { mimeType, buffer } = await load(url);
    if (key === "preview") return toPreview(buffer);
    return `data:${mimeType};base64,${buffer.toString("base64")}`;
  });
}

module.exports = { multipartBody, resolveStoredImages, InlineImageError };
