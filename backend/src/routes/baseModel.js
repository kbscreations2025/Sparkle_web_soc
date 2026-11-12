const { resolveInlineImage } = require("../generationService");
const lifestyleModels = require("../services/lifestyleModels");

/**
 * The chosen model — shared by Lifestyle and Campaign Kit, which name a model
 * the same two ways.
 *
 *   - A library model (`modelId`) → `{ ref }`: the run records a pointer to
 *     the library photo and the job reads the bytes when it runs. Nothing is
 *     copied — a model used in five hundred runs is stored once. Checked here,
 *     at queue time, against what this person may use; History shows it later
 *     whatever happens to the model (made private, deleted).
 *   - A photo sent with the request (`modelImage`) → `{ image }`: only while a
 *     just-uploaded photo is still saving to the library, or if that save
 *     failed. There is nothing to point at, so the run keeps a copy, as every
 *     run used to.
 *
 * The built-in presets (Model 4 and 5) are library models now — see
 * scripts/seedLifestylePresets.js — so `modelNumber` is gone.
 */
async function resolveBaseModel({ dbUser, modelId, modelImage }) {
  if (modelId) {
    const saved = await lifestyleModels.findUsableModel({ dbUser, id: modelId });
    if (!saved) throw new Error("that saved model is not available");
    return { ref: lifestyleModels.toModelRef(saved) };
  }

  if (modelImage) {
    const uploaded = await resolveInlineImage(modelImage);
    if (!uploaded) throw new Error("the model photo must be an image");
    return { image: uploaded };
  }

  return null;
}

/**
 * The payload fields a run needs for its model, either way it was named:
 * a reference (and the pointer History shows) for a library model, or the
 * photo itself at the front of the source images for an upload.
 */
function modelPayload(baseModel, pieces) {
  if (baseModel.ref) {
    return {
      sourceImages: pieces,
      modelRef: baseModel.ref,
      inputPointers: [lifestyleModels.modelPointer(baseModel.ref)],
    };
  }
  return { sourceImages: [baseModel.image, ...pieces], modelRef: null, inputPointers: [] };
}

module.exports = { resolveBaseModel, modelPayload };
