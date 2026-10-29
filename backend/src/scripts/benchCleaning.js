/**
 * One-off bench: runs every "Cleaning in Testing" model over a folder of
 * photos with the studio cleaning prompt and writes the results to disk, so
 * the models can be compared side by side.
 *
 *   node src/scripts/benchCleaning.js <inputDir> <outDir> [modelId,...]
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { connectDb } = require("../db");
const Tenant = require("../models/tenant");
const { decryptSecret } = require("../secrets");
const openrouter = require("../providers/openrouter");
const { STUDIO_CLEANING_PROMPT, GOLD_SWATCH_NOTE } = require("../prompts/studioCleaning");

// SWATCH=<png> sends the gold colour swatch as a second image, with its note.
const SWATCH = process.env.SWATCH ? fs.readFileSync(process.env.SWATCH).toString("base64") : null;
const PROMPT = SWATCH ? `${STUDIO_CLEANING_PROMPT}\n${GOLD_SWATCH_NOTE}` : STUDIO_CLEANING_PROMPT;

async function main() {
  const [inputDir, outDir, only] = process.argv.slice(2);
  const models = only ? only.split(",") : openrouter.TRIAL_MODELS;
  await connectDb();

  const tenant = (await Tenant.find()).find((t) => t.routableProviders().some((p) => p.provider === "openrouter"));
  if (!tenant) throw new Error("no tenant has an OpenRouter key");
  const entry = tenant.routableProviders().find((p) => p.provider === "openrouter");
  const apiKey = decryptSecret((await Tenant.loadProvider(tenant._id, entry._id)).credential, { provider: "openrouter" });

  const inputs = fs.readdirSync(inputDir).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort();
  fs.mkdirSync(outDir, { recursive: true });

  const jobs = models.flatMap((modelId) => inputs.map((file) => ({ modelId, file })));
  const report = [];
  // A few at a time: fast enough, without tripping per-key rate limits.
  for (let i = 0; i < jobs.length; i += 6) {
    await Promise.all(
      jobs.slice(i, i + 6).map(async ({ modelId, file }) => {
        const base64 = fs.readFileSync(path.join(inputDir, file)).toString("base64");
        const started = Date.now();
        try {
          const out = await openrouter.generateImage({
            apiKey,
            modelId,
            prompt: PROMPT,
            images: [{ mimeType: "image/jpeg", base64 }, ...(SWATCH ? [{ mimeType: "image/png", base64: SWATCH }] : [])],
            quality: openrouter.qualityFor(modelId),
          });
          const ext = out.mimeType?.includes("png") ? "png" : "jpg";
          const name = `${modelId.replace(/[\/.]/g, "_")}__${path.parse(file).name}.${ext}`;
          fs.writeFileSync(path.join(outDir, name), Buffer.from(out.base64, "base64"));
          const ms = Date.now() - started;
          report.push({ modelId, file, ok: true, ms, out: name });
          console.log("ok  ", modelId, file, ms, "ms");
        } catch (err) {
          const raw = String(err?.error?.message || err?.message || err);
          report.push({ modelId, file, ok: false, error: openrouter.classifyError(err).message, raw: raw.slice(0, 300) });
          console.log("FAIL", modelId, file, raw.slice(0, 400));
        }
      })
    );
  }
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
