const { resolveInlineImage } = require("../generationService");
const lifestyleModels = require("../services/lifestyleModels");
const { loadPreset, PRESET_IDS } = require("../services/lifestylePresets");

/**
 * The chosen model as `{ mimeType, base64 }` — shared by Lifestyle and
 * Campaign Kit, which name a model the same three ways.
 *
 * A saved model is stored as a url, so it is fetched back rather than
 * trusted from the client: the browser sending the bytes of "model 7" is the
 * browser deciding what model 7 is.
 */
async function resolveBaseModel({ dbUser, modelNumber, modelId, modelImage }) {
  if (modelId) {
    const saved = await lifestyleModels.findUsableModel({ dbUser, id: modelId });
    if (!saved) throw new Error("that saved model is not available");
    return resolveInlineImage(saved.imageUrl);
  }

  if (modelImage) {
    const uploaded = await resolveInlineImage(modelImage);
    if (!uploaded) throw new Error("the model photo must be an image");
    return uploaded;
  }

  if (modelNumber !== undefined && modelNumber !== null && modelNumber !== "") {
    if (!PRESET_IDS.includes(Number(modelNumber))) throw new Error(`there is no preset model ${modelNumber}`);
    return loadPreset(modelNumber);
  }

  return null;
}

module.exports = { resolveBaseModel };
