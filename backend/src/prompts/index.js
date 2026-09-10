/**
 * Every model instruction the app sends, one file per tool, so the wording
 * lives somewhere obvious instead of buried in a route handler.
 *
 * To add one: create `myTool.js` exporting a const, then re-export it here.
 */
const { IMAGE_CLEANING_PROMPT } = require("./imageCleaning");
const { SCALE_NOTE, ANATOMY_NOTE, buildChatEditPrompt } = require("./chatToEdit");
const { buildReferenceNote } = require("./shared");

module.exports = { IMAGE_CLEANING_PROMPT, SCALE_NOTE, ANATOMY_NOTE, buildChatEditPrompt, buildReferenceNote };
