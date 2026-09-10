const mongoose = require("mongoose");
const crypto = require("crypto");
const config = require("./config");
const Conversation = require("./models/conversation");
const Generation = require("./models/generation");
const Asset = require("./models/asset");
const { uploadObject, buildAssetKey, publicUrlFor } = require("./storage/r2");
const { emitToUser } = require("./socket");
const { logAudit } = require("./auditLog");

function extensionFor(mimeType) {
  return mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
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
  outputImages,
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
  const outputAssets = await Promise.all(
    outputImages.map(({ image, role }) => createAsset({ ...commonAssetFields, role, kind: "output", image }))
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
      params: { quality },
      inputAssetIds: inputAssets.map((entry) => entry.asset._id),
      inputAssets: inputAssets.map((entry) => entry.snapshot),
    },
    response: {
      outputAssetIds: outputAssets.map((entry) => entry.asset._id),
      outputAssets: outputAssets.map((entry) => entry.snapshot),
      completedAt: new Date(),
    },
  });

  // The first output stands in for the whole run in the conversation list —
  // a run with several outputs still only needs one thumbnail there.
  conversation.previewUrl = outputAssets[0]?.snapshot.url ?? conversation.previewUrl;
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
    outputs: outputAssets.map((entry) => ({
      assetId: String(entry.snapshot.assetId),
      url: entry.snapshot.url,
      width: entry.snapshot.width,
      height: entry.snapshot.height,
    })),
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

  return { conversationId: String(conversation._id), generationId: String(generationId) };
}

async function createAsset({ tenant, user, tool, conversationId, generationId, role, kind, image, model, quality }) {
  const buffer = Buffer.from(image.base64, "base64");
  const extension = extensionFor(image.mimeType);
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
    type: "image",
    modelLabel: model,
    quality,
    s3Bucket: config.r2.bucket,
    s3Key: key,
    mimeType: image.mimeType,
    sizeBytes: buffer.length,
    checksum: crypto.createHash("sha256").update(buffer).digest("hex"),
  });

  const url = publicUrlFor(key);
  return { asset, snapshot: { assetId: asset._id, url, role, width: null, height: null } };
}

/** Parses a `data:<mime>;base64,<data>` URI. Returns null if it isn't one. */
const DATA_URI_PATTERN = /^data:(image\/[a-zA-Z0-9.+-]+);base64,/;
function parseDataUri(dataUri) {
  const match = DATA_URI_PATTERN.exec(dataUri || "");
  if (!match) return null;
  return { mimeType: match[1], base64: dataUri.slice(match[0].length) };
}

module.exports = { recordGeneration, parseDataUri };
