const { S3Client, PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
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
function buildAssetKey({ tenantId, userId, conversationId, generationId, role, assetId, extension }) {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return (
    `${PREFIX}tenants/${tenantId}/users/${userId}/${yyyy}/${mm}/` +
    `${conversationId}/${generationId}/${role}/${assetId}.${extension}`
  );
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

async function deleteObject(key) {
  assertOwnKey(key);
  await getClient().send(new DeleteObjectCommand({ Bucket: getBucket(), Key: key }));
}

/** Public URL for an object this app wrote. */
function publicUrlFor(key) {
  if (!config.r2.publicUrl) throw new Error("R2_PUBLIC_URL is not set");
  return `${config.r2.publicUrl.replace(/\/$/, "")}/${key}`;
}

module.exports = { buildAssetKey, uploadObject, deleteObject, publicUrlFor };
