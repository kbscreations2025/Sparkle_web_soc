/**
 * The vocabulary the conversations / generations / assets collections share.
 *
 * These three collections are not per-tool: every tool writes into the same
 * ones and is told apart by `tool`. Defined here once so a typo fails on write
 * instead of quietly creating a row nothing will ever query.
 *
 * The tool keys match the ids in `grants.js` and `frontend/lib/nav.ts` — a key
 * that exists on only one side is a tool nobody can reach.
 */
const GENERATION_TOOLS = [
  "cleaning",
  "life_style",
  "image_to_video",
  "text_to_image",
  "text_to_sketch",
  "sketch_to_image",
  "image_to_text",
  "image_to_sketch",
  "marketing_kit",
  "chat_to_edit",
];

const GENERATION_STATUSES = ["pending", "processing", "completed", "failed"];

/** Whether an asset went into a generation or came out of it. */
const ASSET_KINDS = ["input", "output"];

/**
 * What an asset *is* within its generation. Inputs can arrive several ways —
 * the original upload, a style reference, a version the user drew on — and the
 * distinction is what lets history replay a run faithfully.
 */
const ASSET_ROLES = ["uploaded", "reference", "annotated", "mask", "edited", "generated"];

const ASSET_TYPES = ["image", "video"];

const ASSET_STATUSES = ["uploading", "ready", "failed", "deleted"];

module.exports = {
  GENERATION_TOOLS,
  GENERATION_STATUSES,
  ASSET_KINDS,
  ASSET_ROLES,
  ASSET_TYPES,
  ASSET_STATUSES,
};
