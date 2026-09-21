const mongoose = require("mongoose");
const crypto = require("crypto");
const config = require("./config");
const Conversation = require("./models/conversation");
const Generation = require("./models/generation");
const Asset = require("./models/asset");
const { uploadObject, buildAssetKey, variantKeyFor, publicUrlFor } = require("./storage/r2");
const { createThumbnail, THUMB_EXTENSION } = require("./storage/thumbnail");
const { toPublicAsset } = require("./generations");
const { emitToUser } = require("./socket");
const { logAudit } = require("./auditLog");

const EXTENSION_BY_MIME = {
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

function extensionFor(mimeType) {
  return EXTENSION_BY_MIME[mimeType] || "jpg";
}

/** Which of ASSET_TYPES this mime belongs to. */
function assetTypeFor(mimeType) {
  return String(mimeType || "").startsWith("video/") ? "video" : "image";
}

/**
 * Writes the conversation/generation/asset rows for one run of any tool.
 *
 * Not cleaning-specific: `inputImages`/`outputImages` are arrays, since a
 * tool like Chat to Edit sends one base image plus any number of reference
 * images in, and could in principle return more than one image out. Cleaning
 * just happens to pass a one-element array on each side.
 *
 * Uploads every image to R2 before writing anything to Mongo — a generation
 * record pointing at a bucket key that was never written would be worse than
 * not recording history at all. Callers are expected to swallow this
 * function's errors themselves (see routes/cleaning.js): a history-writing
 * failure should never cost the user the image they were just given.
 */
async function recordGeneration({
  tenant,
  user,
  tool,
  conversationId: existingConversationId,
  parentGenerationId,
  model,
  modelLabel,
  quality,
  prompt,
  userPrompt,
  /** `[{ image: { mimeType, base64 }, role }]` — role from ASSET_ROLES. */
  inputImages,
  /**
   * Same shape, and not necessarily images: a `video/*` mime is written as a
   * video asset (see `createAsset`). May be empty for a tool whose output is
   * text — Image to Text and the writing halves of Marketing Kit record the
   * run and its inputs, with the answer in `outputText`.
   */
  outputImages,
  /** What a text-out tool produced. Stored on `response.text`. */
  outputText = null,
  /**
   * Extra per-tool knobs to record alongside `quality` — placement and pose
   * for Lifestyle, duration and resolution for a video. Free-form because
   * every tool has its own, and pinning them down would mean a schema change
   * per tool.
   */
  params,
  /** Milliseconds of video, where the output is one. */
  durationMs = null,
  providerId,
  /** Which AI provider actually served this run — "gemini" by default, since every call site predates multi-provider routing except the ones that now pass it explicitly. */
  provider,
}) {
  const conversation = existingConversationId
    ? await Conversation.findOne({ _id: existingConversationId, tenantId: tenant._id })
    : await Conversation.create({
        tenantId: tenant._id,
        userId: user._id,
        userName: user.name || user.email,
        tool,
        title: (userPrompt || prompt).slice(0, 80),
      });
  if (!conversation) throw new Error("conversation not found");

  const generationId = new mongoose.Types.ObjectId();
  const sequence = (await Generation.countDocuments({ conversationId: conversation._id })) + 1;

  const rootGenerationId = parentGenerationId
    ? (await Generation.findById(parentGenerationId).select("rootGenerationId"))?.rootGenerationId || parentGenerationId
    : null;

  const commonAssetFields = { tenant, user, tool, conversationId: conversation._id, generationId, model: modelLabel || model, quality };

  const inputAssets = await Promise.all(
    inputImages.map(({ image, role }) => createAsset({ ...commonAssetFields, role, kind: "input", image }))
  );

  /**
   * A video can't be decoded by sharp, so its tile is rendered from the still
   * it was animated from — the first input image, which for Image to Video is
   * the uploaded photo. Without this a video result is a blank tile in
   * History, since every reader falls back to `url` and a browser will not
   * render an mp4 as an `<img>`.
   */
  const posterSource = inputAssets[0]?.buffer ?? null;

  const outputAssets = await Promise.all(
    outputImages.map(({ image, role }) =>
      createAsset({ ...commonAssetFields, role, kind: "output", image, posterSource, durationMs })
    )
  );

  await Generation.create({
    _id: generationId,
    tenantId: tenant._id,
    userId: user._id,
    userName: user.name || user.email,
    conversationId: conversation._id,
    sequence,
    tool,
    parentGenerationId: parentGenerationId || null,
    rootGenerationId,
    status: "completed",
    model: { provider: provider || "gemini", modelId: model, modelLabel: modelLabel || null },
    aiProviderId: providerId,
    request: {
      userPrompt,
      finalPrompt: prompt,
      params: { quality, ...params },
      inputAssetIds: inputAssets.map((entry) => entry.asset._id),
      inputAssets: inputAssets.map((entry) => entry.snapshot),
    },
    response: {
      outputAssetIds: outputAssets.map((entry) => entry.asset._id),
      outputAssets: outputAssets.map((entry) => entry.snapshot),
      text: outputText,
      completedAt: new Date(),
    },
  });

  // The first output stands in for the whole run in the conversation list —
  // a run with several outputs still only needs one thumbnail there. A
  // text-out tool has none, so its thread is captioned by what went in.
  const preview = outputAssets[0]?.snapshot ?? inputAssets[0]?.snapshot;
  conversation.previewUrl = preview ? preview.thumbnailUrl || preview.url : conversation.previewUrl;
  conversation.lastGenerationAt = new Date();
  await conversation.save();

  // Lets an open History tab prepend this result live instead of polling —
  // shaped exactly like the REST route's `toHistoryItem` so the client can
  // render it with no special-casing. Best-effort: a history page that misses
  // this still sees the run on its next fetch or refresh.
  emitToUser(user._id, "history:generation", {
    id: String(generationId),
    conversationId: String(conversation._id),
    tool,
    model: modelLabel || model,
    quality: quality || null,
    isOwn: true,
    userName: user.name || user.email,
    createdAt: new Date().toISOString(),
    // Same shaper the REST route uses, so a result that arrives live and one
    // that arrives on the next fetch are indistinguishable to the client.
    outputs: outputAssets.map((entry) => toPublicAsset(entry.snapshot)),
    text: outputText,
  });

  logAudit({
    tenantId: tenant._id,
    actorUserId: user._id,
    actorAuthUserId: user.authUserId || null,
    actorEmail: user.email,
    actorName: user.name || user.email,
    action: "generation.completed",
    status: "success",
    targetType: "generation",
    targetId: String(generationId),
    message: `${tool} generation completed via ${modelLabel || model}`,
    metadata: {
      tool,
      model,
      modelLabel,
      quality,
      provider: provider || "gemini",
      conversationId: String(conversation._id),
      aiProviderId: providerId ? String(providerId) : null,
    },
  });

  return {
    conversationId: String(conversation._id),
    generationId: String(generationId),
    // The stored images, so a caller that isn't holding the bytes itself (the
    // queue worker, which must not ship base64 back through Redis) can hand
    // the client a url to render.
    outputs: outputAssets.map((entry) => ({
      assetId: String(entry.snapshot.assetId),
      url: entry.snapshot.url,
    })),
  };
}

/**
 * Uploads one asset's bytes and writes its row.
 *
 * `image` is `{ mimeType, base64 }` and may be a video — the mime decides,
 * and everything that differs follows from it: a video gets no decoded
 * dimensions and no thumbnail of its own, so `posterSource` (the still it was
 * animated from) stands in for one.
 */
async function createAsset({
  tenant,
  user,
  tool,
  conversationId,
  generationId,
  role,
  kind,
  image,
  model,
  quality,
  posterSource = null,
  durationMs = null,
}) {
  const buffer = Buffer.from(image.base64, "base64");
  const extension = extensionFor(image.mimeType);
  const type = assetTypeFor(image.mimeType);
  const assetId = new mongoose.Types.ObjectId();

  const key = buildAssetKey({
    tenantId: tenant._id,
    userId: user._id,
    conversationId,
    generationId,
    role,
    assetId,
    extension,
  });

  await uploadObject(key, buffer, image.mimeType);

  // Best-effort, and deliberately so: this runs after a generation the user
  // has already paid for and waited on, so a resize that throws must cost a
  // thumbnail and nothing else. Every reader falls back to the original.
  let thumbnail = null;
  let dimensions = { width: null, height: null };
  // A video is not decodable here, so its tile comes from the still it was
  // made from. Nothing to resize at all when neither is available.
  const thumbnailSource = type === "video" ? posterSource : buffer;
  try {
    if (!thumbnailSource) throw new Error("no thumbnail source for this asset");
    const thumb = await createThumbnail(thumbnailSource);
    const thumbKey = variantKeyFor(key, "thumb", THUMB_EXTENSION);
    await uploadObject(thumbKey, thumb.buffer, thumb.mimeType);
    thumbnail = {
      s3Key: thumbKey,
      mimeType: thumb.mimeType,
      sizeBytes: thumb.buffer.length,
      width: thumb.width,
      height: thumb.height,
    };
    dimensions = { width: thumb.sourceWidth, height: thumb.sourceHeight };
  } catch (err) {
    console.error(`createAsset: could not build thumbnail for ${key}:`, err.message);
  }

  const asset = await Asset.create({
    _id: assetId,
    tenantId: tenant._id,
    userId: user._id,
    userName: user.name || user.email,
    conversationId,
    generationId,
    tool,
    kind,
    role,
    type,
    durationMs,
    modelLabel: model,
    quality,
    s3Bucket: config.r2.bucket,
    s3Key: key,
    mimeType: image.mimeType,
    sizeBytes: buffer.length,
    width: dimensions.width,
    height: dimensions.height,
    thumbnail,
    checksum: crypto.createHash("sha256").update(buffer).digest("hex"),
  });

  const url = publicUrlFor(key);
  return {
    asset,
    // Kept for the caller, not stored: a video's poster is rendered from the
    // input still, which has already been decoded here.
    buffer,
    snapshot: {
      assetId: asset._id,
      url,
      thumbnailUrl: thumbnail ? publicUrlFor(thumbnail.s3Key) : null,
      role,
      type,
      durationMs,
      width: dimensions.width,
      height: dimensions.height,
    },
  };
}

/**
 * Parses a `data:<mime>;base64,<data>` URI. Returns null if it isn't one.
 *
 * Accepts video as well as image because a refinement can be asked to work
 * from a stored result of either kind, and a route that silently dropped a
 * video would report "no image supplied" for something the user can see on
 * screen.
 */
const DATA_URI_PATTERN = /^data:((?:image|video)\/[a-zA-Z0-9.+-]+);base64,/;
function parseDataUri(dataUri) {
  const match = DATA_URI_PATTERN.exec(dataUri || "");
  if (!match) return null;
  return { mimeType: match[1], base64: dataUri.slice(match[0].length) };
}

/**
 * Fetches a stored asset back as `{ mimeType, base64 }`.
 *
 * Needed wherever a run's input is something already saved rather than
 * something just uploaded — a Lifestyle custom model, or a result being
 * refined from History. Kept here beside `parseDataUri` so a route can
 * accept a data URI or a url and end up with the same thing either way.
 */
async function fetchAsInlineImage(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`could not fetch ${url} (${response.status})`);
  const mimeType = response.headers.get("content-type") || "image/jpeg";
  const buffer = Buffer.from(await response.arrayBuffer());
  return { mimeType, base64: buffer.toString("base64") };
}

/**
 * Whatever the client sent for one image — a data URI or the url of
 * something already stored — as `{ mimeType, base64 }`, or null if it is
 * neither.
 */
async function resolveInlineImage(value) {
  if (typeof value !== "string" || !value) return null;
  if (value.startsWith("data:")) return parseDataUri(value);
  if (/^https?:\/\//.test(value)) return fetchAsInlineImage(value);
  return null;
}

module.exports = { recordGeneration, parseDataUri, fetchAsInlineImage, resolveInlineImage };
