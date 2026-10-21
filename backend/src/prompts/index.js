/**
 * Every model instruction the app sends, one file per tool, so the wording
 * lives somewhere obvious instead of buried in a route handler.
 *
 * To add one: create `myTool.js` exporting a const, then re-export it here.
 */
const { IMAGE_CLEANING_PROMPT } = require("./imageCleaning");
const { NEW_CLEANING_PROMPT } = require("./newCleaning");
const { SHANK_CLEANING_PROMPT } = require("./shankCleaning");
const { STUDIO_CLEANING_PROMPT, GOLD_SWATCH_NOTE } = require("./studioCleaning");
const { SCALE_NOTE, ANATOMY_NOTE, buildChatEditPrompt } = require("./chatToEdit");
const { buildReferenceNote } = require("./shared");
const { buildTextToImagePrompt, buildTextToImageRefinePrompt } = require("./textToImage");

module.exports = {
  IMAGE_CLEANING_PROMPT,
  NEW_CLEANING_PROMPT,
  SHANK_CLEANING_PROMPT,
  STUDIO_CLEANING_PROMPT,
  GOLD_SWATCH_NOTE,
  SCALE_NOTE,
  ANATOMY_NOTE,
  buildChatEditPrompt,
  buildReferenceNote,
  buildTextToImagePrompt,
  buildTextToImageRefinePrompt,
};
