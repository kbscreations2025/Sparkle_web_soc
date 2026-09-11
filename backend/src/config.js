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

  /**
   * Redis backs the job queue (see queue.js). `rediss://` turns on TLS, which
   * every managed provider (Render, Upstash) requires from outside its own
   * network — ioredis reads that from the scheme, so nothing else to set.
   */
  redis: {
    url: process.env.REDIS_URL || "redis://127.0.0.1:6379",
  },

  queue: {
    // One queue for every tool. Jobs are told apart by their `type`, the same
    // way the generations collection is shared and told apart by `tool`.
    name: process.env.QUEUE_NAME || "sparkle-jobs",
    /**
     * How many jobs one worker runs at once. These jobs are I/O-bound — they
     * spend almost all their time awaiting an AI provider — so this is really
     * "how hard are we willing to hit the provider at once", not a CPU budget.
     * Keep it at or under what the tenant's API keys can take before the
     * provider starts answering 429s.
     */
    concurrency: Number(process.env.WORKER_CONCURRENCY || 3),
    /**
     * How many times a job is retried before it is marked failed for good.
     * This is the outer loop: each attempt already retries transient errors on
     * one key and fails over across the tenant's other keys (see gemini.js).
     */
    attempts: Number(process.env.JOB_ATTEMPTS || 2),
    /**
     * A job whose worker stops renewing its lock is assumed dead and handed to
     * another worker. It MUST exceed the slowest legitimate run or a slow-but-
     * healthy generation gets duplicated: the provider call alone is allowed
     * 150s (gemini.js/openai.js), plus R2 uploads afterwards.
     */
    lockDurationMs: Number(process.env.JOB_LOCK_DURATION_MS || 300_000),
    /**
     * In development the worker runs inside the API process, so `npm run dev`
     * is still one command. In production it is a separate service (Render
     * background worker) — see `npm run worker`.
     */
    runInProcess:
      process.env.RUN_WORKER_IN_PROCESS !== undefined
        ? process.env.RUN_WORKER_IN_PROCESS === "true"
        : (process.env.NODE_ENV || "development") !== "production",
  },

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
