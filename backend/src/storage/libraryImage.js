const { buildLibraryKey, variantKeyFor, uploadObject, publicUrlFor } = require("./r2");
const { createThumbnail, THUMB_EXTENSION } = require("./thumbnail");

const EXTENSION_BY_MIME = { "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

function extensionFor(mimeType) {
  return EXTENSION_BY_MIME[mimeType] || "jpg";
}

/**
 * Uploads one library picture — a Marketing Kit page, a saved Lifestyle
 * model — under `buildLibraryKey`, with a grid-sized copy beside it.
 *
 * `image` is already parsed to `{ mimeType, base64 }`. The copy is
 * best-effort: a resize or upload that throws is logged under `logTag` and
 * costs bandwidth only, since every reader falls back to the original.
 *
 * @returns `{ key, url, sizeBytes, thumbnail }`, where `thumbnail` is
 *          `{ key, url, sourceWidth, sourceHeight }` or null.
 */
async function uploadLibraryImage({ tenantId, userId, collection, id, image, logTag }) {
  const buffer = Buffer.from(image.base64, "base64");
  const key = buildLibraryKey({ tenantId, userId, collection, id, extension: extensionFor(image.mimeType) });

  await uploadObject(key, buffer, image.mimeType);

  let thumbnail = null;
  try {
    const thumb = await createThumbnail(buffer);
    const thumbKey = variantKeyFor(key, "thumb", THUMB_EXTENSION);
    await uploadObject(thumbKey, thumb.buffer, thumb.mimeType);
    thumbnail = { key: thumbKey, url: publicUrlFor(thumbKey), sourceWidth: thumb.sourceWidth, sourceHeight: thumb.sourceHeight };
  } catch (err) {
    console.error(`[${logTag}] could not build a thumbnail for ${key}:`, err.message);
  }

  return { key, url: publicUrlFor(key), sizeBytes: buffer.length, thumbnail };
}

module.exports = { uploadLibraryImage };
