const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const config = require("../config");

/**
 * Cloudflare R2 (S3-compatible). `select-images` is a bucket shared with
 * other apps, so everything this app writes lives under one prefix inside
 * it — every other folder in that bucket belongs to a different system and
 * must never be touched from here.
 */
const PREFIX = "sparkle1/";

let client;

function getClient() {
  if (client) return client;

  const { accountId, accessKeyId, secretAccessKey } = config.r2;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("R2 is not configured — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY");
  }

  client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return client;
}

function getBucket() {
  if (!config.r2.bucket) throw new Error("R2_BUCKET_NAME is not set");
  return config.r2.bucket;
}

/**
 * Builds the key for one asset, partitioned by tenant/user/month/conversation
 * so a bucket listing is browsable by hand if it's ever needed. `role` is the
 * asset's role (uploaded/generated/edited/...) from `ASSET_ROLES`.
 */
function buildAssetKey({ tenantId, userId, conversationId, generationId, role, assetId, extension, variant }) {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const name = variant ? `${assetId}_${variant}` : String(assetId);
  return (
    `${PREFIX}tenants/${tenantId}/users/${userId}/${yyyy}/${mm}/` +
    `${conversationId}/${generationId}/${role}/${name}.${extension}`
  );
}

/**
 * The key of a derivative sitting beside an original — `<id>.jpg` becomes
 * `<id>_thumb.webp`. Derived from the original's key rather than rebuilt from
 * its parts, because the date segment is stamped at upload time and a
 * backfill running months later would otherwise compute a different path.
 */
function variantKeyFor(originalKey, variant, extension) {
  const dot = originalKey.lastIndexOf(".");
  const stem = dot === -1 ? originalKey : originalKey.slice(0, dot);
  return `${stem}_${variant}.${extension}`;
}

function assertOwnKey(key) {
  if (!key.startsWith(PREFIX)) {
    throw new Error(`Refusing to touch an R2 key outside ${PREFIX}: ${key}`);
  }
}

// A year, immutable: every key embeds a freshly minted assetId and is never
// overwritten, so the object at a given URL can never change. Without this
// header the browser and any CDN in front of the bucket re-fetch every image
// on every page view.
const ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";

async function uploadObject(key, body, contentType) {
  assertOwnKey(key);
  await getClient().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: ASSET_CACHE_CONTROL,
    })
  );
}

/** Reads one object back as a Buffer. Only the thumbnail backfill needs this — the app itself never reads its own bytes back. */
async function getObject(key) {
  assertOwnKey(key);
  const result = await getClient().send(new GetObjectCommand({ Bucket: getBucket(), Key: key }));
  return Buffer.from(await result.Body.transformToByteArray());
}

async function deleteObject(key) {
  assertOwnKey(key);
  await getClient().send(new DeleteObjectCommand({ Bucket: getBucket(), Key: key }));
}

/** Public URL for an object this app wrote. */
function publicUrlFor(key) {
  if (!config.r2.publicUrl) throw new Error("R2_PUBLIC_URL is not set");
  return `${config.r2.publicUrl.replace(/\/$/, "")}/${key}`;
}

module.exports = { buildAssetKey, variantKeyFor, uploadObject, getObject, deleteObject, publicUrlFor };
