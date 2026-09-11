const sharp = require("sharp");

/**
 * Builds the small grid-tile copy of an image.
 *
 * Pure CPU work — libvips, no model call, so a thumbnail costs no tokens and
 * no provider quota. It runs wherever the full bytes already are (the route
 * or the queue worker), which is the only place it can run cheaply: fetching
 * the original back out of R2 just to shrink it would cost more than the
 * resize.
 */

/**
 * Long edge, in pixels. The History grid tops out at six columns, so a tile
 * is ~200px wide on a laptop and ~400px on a large monitor; 640 keeps it
 * sharp on a 2x display at both sizes without carrying a full-resolution
 * image. Everything below is tuned around this number — shrinking it further
 * is what makes a thumbnail look soft, not the compression.
 */
const THUMB_MAX_SIDE = 640;

/**
 * WebP quality. 82 is well above the point where artefacts become visible on
 * the gradients that matter here — a polished gold band, the shadow under a
 * ring — while still landing far under a tenth of the original's size.
 */
const THUMB_QUALITY = 82;

const THUMB_MIME = "image/webp";
const THUMB_EXTENSION = "webp";

/**
 * Produces the resized bytes plus their real dimensions, and the original's
 * dimensions alongside.
 *
 * Three of these settings exist specifically to stop the result looking
 * cheap, and none of them are defaults:
 *
 * - `chromaSubsampling: "4:4:4"`. WebP defaults to 4:2:0, which stores colour
 *   at half resolution. On a photograph nobody notices; on a thin gold chain
 *   or a rose-gold band against a white backdrop it smears the colour a pixel
 *   or two past the metal, which reads as coloured fringing — the single
 *   most likely cause of a thumbnail looking "noisy". Full chroma costs a few
 *   kilobytes and removes it entirely.
 *
 * - `kernel: "lanczos3"`. The highest-quality resampler sharp offers, and the
 *   only one that holds a clean edge on a faceted stone at this reduction
 *   ratio. Cheaper kernels alias the facets into a shimmer.
 *
 * - A light unsharp mask. Any correct downscale is slightly soft, because
 *   detail is being averaged away; a small amount of sharpening puts the
 *   apparent crispness back. Deliberately gentle — `m2` caps how hard bright
 *   edges are pushed, so stones and highlights don't grow white halos, and
 *   flat areas like the backdrop are left alone rather than being turned
 *   grainy.
 */
async function createThumbnail(buffer) {
  const image = sharp(buffer, { failOn: "none" });
  const metadata = await image.metadata();

  let pipeline = image
    // EXIF orientation, applied before the resize — otherwise a phone upload
    // is measured on its side and comes out both rotated and wrongly scaled.
    .rotate()
    .resize({
      width: THUMB_MAX_SIDE,
      height: THUMB_MAX_SIDE,
      fit: "inside",
      withoutEnlargement: true,
      kernel: "lanczos3",
    });

  // A cutout with transparency would otherwise composite against whatever is
  // behind the tile, which on a dark grid turns a white-background product
  // shot into a dark one. Only applied when there is actually an alpha
  // channel, so an ordinary JPEG is untouched.
  if (metadata.hasAlpha) {
    pipeline = pipeline.flatten({ background: "#ffffff" });
  }

  const { data, info } = await pipeline
    .sharpen({ sigma: 0.6, m1: 0.4, m2: 0.7 })
    .webp({ quality: THUMB_QUALITY, chromaSubsampling: "4:4:4", effort: 5 })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: data,
    width: info.width,
    height: info.height,
    mimeType: THUMB_MIME,
    extension: THUMB_EXTENSION,
    // The source's own dimensions, free from the decode we just did. Lets a
    // grid reserve the right space before the image arrives.
    sourceWidth: metadata.width ?? null,
    sourceHeight: metadata.height ?? null,
  };
}

// `THUMB_MIME` stays internal: it already rides back on every result, so
// exporting it too would be a second way to learn the same thing.
module.exports = { createThumbnail, THUMB_EXTENSION };
