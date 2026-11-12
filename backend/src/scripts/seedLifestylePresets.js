/**
 * Turns the two built-in Lifestyle presets (Model 4 and Model 5) into
 * ordinary shared models in the library, one pair per organization.
 *
 *   node src/scripts/seedLifestylePresets.js            # add what's missing
 *   node src/scripts/seedLifestylePresets.js --dry-run  # say what it would do, write nothing
 *
 * Before this, a preset was a special case all the way through: a
 * `modelNumber` on the request, image files shipped with the backend, tiles
 * hard-coded in the page. Now every model is a library row with an id, and
 * the presets are just two of them — shared (`isPublic`), owned by the
 * organization's earliest admin (or earliest member), named as before.
 *
 * Idempotent: a row is matched on `presetNumber`, so a second run adds
 * nothing. The photos come from `backend/assets/lifestyle-presets/`, which is
 * only kept for this script now.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { connectDb } = require("../db");
const Tenant = require("../models/tenant");
const User = require("../models/user");
const LifestyleModel = require("../models/lifestyleModel");
const { uploadLibraryImage } = require("../storage/libraryImage");

const PRESETS = [
  { number: 4, name: "Model 4" },
  { number: 5, name: "Model 5" },
];
const PRESET_DIR = path.join(__dirname, "..", "..", "assets", "lifestyle-presets");
const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

function readPreset(number) {
  for (const extension of Object.keys(MIME)) {
    const file = path.join(PRESET_DIR, `model_${number}.${extension}`);
    if (fs.existsSync(file)) return { mimeType: MIME[extension], base64: fs.readFileSync(file).toString("base64") };
  }
  throw new Error(`no image file for preset model ${number} in ${PRESET_DIR}`);
}

/** Who a shared preset belongs to: an admin if there is one, else the first member. */
async function ownerFor(tenantId) {
  return (
    (await User.findOne({ tenantId, role: { $in: ["admin", "super_admin", "owner"] } }).sort({ createdAt: 1 }).lean()) ||
    (await User.findOne({ tenantId }).sort({ createdAt: 1 }).lean())
  );
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  await connectDb();

  const tenants = await Tenant.find({}).select("name").lean();
  let added = 0;

  for (const tenant of tenants) {
    const owner = await ownerFor(tenant._id);
    if (!owner) {
      console.log(`- ${tenant.name}: no members yet, skipped`);
      continue;
    }

    for (const preset of PRESETS) {
      const existing = await LifestyleModel.findOne({ tenantId: tenant._id, presetNumber: preset.number }).lean();
      if (existing) {
        console.log(`- ${tenant.name}: ${preset.name} already there (${existing._id})`);
        continue;
      }
      if (dryRun) {
        console.log(`- ${tenant.name}: would add ${preset.name}, owned by ${owner.name || owner.email}`);
        continue;
      }

      const id = new mongoose.Types.ObjectId();
      const stored = await uploadLibraryImage({
        tenantId: tenant._id,
        userId: owner._id,
        collection: "lifestyle-models",
        id,
        image: readPreset(preset.number),
        logTag: "seed-presets",
      });
      await LifestyleModel.create({
        _id: id,
        tenantId: tenant._id,
        userId: owner._id,
        userName: owner.name || owner.email,
        name: preset.name,
        imageUrl: stored.url,
        thumbnailUrl: stored.thumbnail?.url ?? null,
        r2Key: stored.key,
        isPublic: true,
        publicizedBy: owner._id,
        publicizedAt: new Date(),
        presetNumber: preset.number,
      });
      added += 1;
      console.log(`- ${tenant.name}: added ${preset.name} (${id})`);
    }
  }

  console.log(dryRun ? "dry run — nothing written" : `done — ${added} model(s) added`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
