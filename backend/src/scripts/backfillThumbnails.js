/**
 * One-off: builds the missing thumbnail for every image asset written before
 * thumbnails existed, and patches the denormalised snapshots on the
 * generations that embed them.
 *
 *   node src/scripts/backfillThumbnails.js
 *   node src/scripts/backfillThumbnails.js --limit 200   # a trial run first
 *
 * Idempotent — it only ever picks up assets where `thumbnail` is still null,
 * so an interrupted run is resumed simply by running it again. Safe to run
 * against a live database: it adds objects and sets one field, and never
 * touches an original.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const { connectDb } = require("../db");
const Asset = require("../models/asset");
const Generation = require("../models/generation");
const { getObject, uploadObject, variantKeyFor, publicUrlFor } = require("../storage/r2");
const { createThumbnail, THUMB_EXTENSION } = require("../storage/thumbnail");

/** How many assets are in flight at once. R2 and libvips both cope with far more, but this keeps a backfill from starving a live server of CPU. */
const CONCURRENCY = 6;

function parseLimit() {
  const i = process.argv.indexOf("--limit");
  if (i === -1) return Infinity;
  const n = parseInt(process.argv[i + 1], 10);
  return Number.isFinite(n) && n > 0 ? n : Infinity;
}

async function backfillOne(asset) {
  const buffer = await getObject(asset.s3Key);
  const thumb = await createThumbnail(buffer);
  const thumbKey = variantKeyFor(asset.s3Key, "thumb", THUMB_EXTENSION);
  await uploadObject(thumbKey, thumb.buffer, thumb.mimeType);

  await Asset.updateOne(
    { _id: asset._id },
    {
      $set: {
        thumbnail: {
          s3Key: thumbKey,
          mimeType: thumb.mimeType,
          sizeBytes: thumb.buffer.length,
          width: thumb.width,
          height: thumb.height,
        },
        // Only fill dimensions that are actually missing — a row that already
        // has them was measured somewhere else and shouldn't be overwritten.
        ...(asset.width == null && thumb.sourceWidth != null ? { width: thumb.sourceWidth } : {}),
        ...(asset.height == null && thumb.sourceHeight != null ? { height: thumb.sourceHeight } : {}),
      },
    }
  );

  // The Asset row is the source of truth, but History renders from the copies
  // embedded on the generation and never joins back — so without this the
  // grid would keep serving originals no matter what the assets say.
  const thumbnailUrl = publicUrlFor(thumbKey);
  await Promise.all([
    Generation.updateMany(
      { "response.outputAssets.assetId": asset._id },
      { $set: { "response.outputAssets.$[entry].thumbnailUrl": thumbnailUrl } },
      { arrayFilters: [{ "entry.assetId": asset._id }] }
    ),
    Generation.updateMany(
      { "request.inputAssets.assetId": asset._id },
      { $set: { "request.inputAssets.$[entry].thumbnailUrl": thumbnailUrl } },
      { arrayFilters: [{ "entry.assetId": asset._id }] }
    ),
  ]);

  return thumb.buffer.length;
}

async function main() {
  const limit = parseLimit();
  // The shared connector, not a bare mongoose.connect — the database name
  // lives in its own env var, so connecting without it lands on the wrong db.
  await connectDb();

  const query = { thumbnail: null, deletedAt: null, type: "image" };
  const total = await Asset.countDocuments(query);
  console.log(`${total} asset(s) without a thumbnail${limit === Infinity ? "" : `, processing at most ${limit}`}`);

  // A cursor rather than find().toArray(): a mature tenant can have tens of
  // thousands of these, and there is no reason to hold them all in memory.
  const cursor = Asset.find(query).select("_id s3Key width height").lean().cursor();

  let done = 0;
  let failed = 0;
  let thumbBytes = 0;

  // A fixed pool of workers pulling from the shared cursor — bounded
  // concurrency without batching, so a single slow image doesn't idle the
  // other five.
  async function worker() {
    for (let asset = await cursor.next(); asset; asset = await cursor.next()) {
      if (done + failed >= limit) return;
      try {
        thumbBytes += await backfillOne(asset);
        done += 1;
        if (done % 50 === 0) console.log(`  ${done}/${Math.min(total, limit)}`);
      } catch (err) {
        failed += 1;
        console.error(`  failed ${asset._id} (${asset.s3Key}): ${err.message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await cursor.close();

  console.log(`\ndone: ${done} built, ${failed} failed`);
  if (done > 0) console.log(`thumbnails total ${(thumbBytes / 1024 / 1024).toFixed(1)} MB (${Math.round(thumbBytes / done / 1024)} KB average)`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
