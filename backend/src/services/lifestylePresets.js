const { readFile } = require("fs/promises");
const { existsSync } = require("fs");
const path = require("path");

/**
 * The built-in mannequin photos, for people who haven't made a model of
 * their own.
 *
 * Read from the backend's own `assets/` rather than the frontend's `public/`:
 * the worker is a separate service with no web root, and shipping these as
 * client-supplied bytes instead would mean the browser could send anything
 * at all as "preset 4".
 *
 * The extension is probed rather than hardcoded, so a preset added in any of
 * these formats just works — the two on offer are JPEG.
 */
const PRESET_DIR = path.join(__dirname, "..", "..", "assets", "lifestyle-presets");
const EXTENSIONS = ["png", "jpg", "jpeg", "webp"];
const MIME_BY_EXTENSION = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

/**
 * The presets on offer. The picker renders exactly these, and a run naming
 * anything else is refused — so this must stay in step with
 * `LIFESTYLE_PRESETS` in the frontend's api.ts.
 *
 * Ids, not positions: the number is what a run records, so one retired from
 * this list keeps its number rather than freeing it for a different person.
 * Models 1–3 were retired and their files deleted, so a generation from
 * before that names a preset whose photo is gone — the run's own stored
 * result still shows what it produced.
 */
const PRESET_IDS = [4, 5];

/** Read once per process — photos that never change during a run. */
const cache = new Map();

/** One preset as `{ mimeType, base64 }`, ready to send to a model. */
async function loadPreset(modelNumber) {
  const id = Number(modelNumber);
  if (!PRESET_IDS.includes(id)) throw new Error(`there is no preset model ${modelNumber}`);

  const hit = cache.get(id);
  if (hit) return hit;

  for (const extension of EXTENSIONS) {
    const candidate = path.join(PRESET_DIR, `model_${id}.${extension}`);
    if (!existsSync(candidate)) continue;

    const buffer = await readFile(candidate);
    const preset = { mimeType: MIME_BY_EXTENSION[extension], base64: buffer.toString("base64") };
    cache.set(id, preset);
    return preset;
  }

  throw new Error(`no image file found for preset model ${id}`);
}

module.exports = { loadPreset, PRESET_IDS };
