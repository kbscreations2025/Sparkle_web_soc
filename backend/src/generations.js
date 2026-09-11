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

/**
 * The client-facing shape of one asset snapshot, from the copy embedded on a
 * generation.
 *
 * One function so the thumbnail fallback is decided in exactly one place.
 * Every consumer — the History grid, a resumed conversation, the socket push
 * that lands a fresh result — needs the same rule, and a row predating
 * thumbnails or one whose resize failed must degrade to the original rather
 * than render nothing.
 *
 * `url` always stays the full-size original: it is what a download saves and
 * what a resumed thread re-edits, and substituting the thumbnail there would
 * quietly destroy output quality. `thumbnailUrl` is only ever for display.
 */
function toPublicAsset(snapshot) {
  return {
    assetId: String(snapshot.assetId),
    url: snapshot.url,
    thumbnailUrl: snapshot.thumbnailUrl || snapshot.url,
    role: snapshot.role,
    width: snapshot.width ?? null,
    height: snapshot.height ?? null,
  };
}

module.exports = {
  GENERATION_TOOLS,
  GENERATION_STATUSES,
  ASSET_KINDS,
  ASSET_ROLES,
  ASSET_TYPES,
  ASSET_STATUSES,
  toPublicAsset,
};
