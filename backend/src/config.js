require("dotenv").config();

module.exports = {
  port: process.env.PORT || 4000,
  nodeEnv: process.env.NODE_ENV || "development",
  loginApiBaseUrl: process.env.LOGIN_API_BASE_URL,
  clientId: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  frontendOrigin: process.env.FRONTEND_ORIGIN || "http://localhost:3000",
  // This app's code in the central login's permissioned_applications list.
  // Without it, super-admin detection falls back to the central top-level role.
  centralAppCode: process.env.CENTRAL_APP_CODE,
  /**
   * Body cap for every JSON route. Express defaults to 100kb, which the image
   * tools blow through immediately: they post pictures as base64 data URIs,
   * and base64 is ~33% larger than the bytes it carries. A 2048px photo is
   * roughly 1–2MB encoded, and a refinement can carry several at once.
   *
   * Set deliberately high rather than compressing harder — retouching detail
   * is the product, so picture quality is not the thing to trade away.
   */
  jsonBodyLimit: process.env.JSON_BODY_LIMIT || "25mb",
  mongoUri: process.env.MONGODB_URI,
  mongoDbName: process.env.MONGODB_DB_NAME || "sparkle",

  // Cloudflare R2 (S3-compatible). Mongo only ever stores the object key
  // pointing at an image — never the bytes (see models/asset.js). The bucket
  // is shared with other apps, so everything this app writes is confined to
  // one prefix inside it (see prefix() in storage/r2.js) rather than owning
  // the whole bucket.
  r2: {
    accountId: process.env.R2_ACCOUNT_ID,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucket: process.env.R2_BUCKET_NAME,
    publicUrl: process.env.R2_PUBLIC_URL,
  },
};
