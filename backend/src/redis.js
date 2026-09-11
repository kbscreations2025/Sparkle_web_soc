const IORedis = require("ioredis");
const config = require("./config");

/**
 * Every Redis connection this app opens, so a shutdown can close them all and
 * a health check can report on them. BullMQ wants its own connection per
 * Queue/Worker/QueueEvents rather than one shared client — its blocking reads
 * would otherwise stall every other command on the same socket.
 */
const connections = new Set();

/** How long one source stays quiet after logging, while a fault persists. */
const ERROR_LOG_INTERVAL_MS = 30_000;

/**
 * A logger that says it once, not hundreds of times a minute.
 *
 * ioredis retries continuously, so an unreachable Redis emits an `error` on
 * every attempt from every connection. Logged plainly that is thousands of
 * identical lines an hour, which doesn't tell you anything the first line
 * didn't and buries the errors that would.
 */
function throttledLogger(label) {
  let lastLoggedAt = 0;
  let muted = 0;

  return (message) => {
    const now = Date.now();
    if (now - lastLoggedAt < ERROR_LOG_INTERVAL_MS) {
      muted += 1;
      return;
    }
    const suffix = muted > 0 ? ` (${muted} identical since the last line)` : "";
    console.error(`[${label}] ${message}${suffix}`);
    lastLoggedAt = now;
    muted = 0;
  };
}

/**
 * One Redis connection, configured the way BullMQ needs it.
 *
 * `maxRetriesPerRequest: null` is mandatory, not a preference: BullMQ parks a
 * blocking read on the queue for seconds at a time, and ioredis' default retry
 * cap would abort it and leave the worker sitting there having quietly stopped
 * consuming. `enableReadyCheck: false` is the matching recommendation — a
 * managed provider that hides `INFO` would otherwise fail the check forever.
 *
 * TLS comes from the url scheme (`rediss://`), which is what Render and
 * Upstash hand out for access from outside their network.
 */
function createRedisConnection(label, { failFast = false } = {}) {
  const connection = new IORedis(config.redis.url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    /**
     * `failFast` is for the connection an HTTP request runs on. ioredis
     * otherwise parks commands in an offline queue until Redis returns, which
     * for a producer means the request hangs instead of answering — the user
     * waits on a spinner forever rather than being told the queue is down.
     * Workers want the opposite: their commands should wait for a reconnect
     * rather than erroring out mid-job.
     */
    enableOfflineQueue: !failFast,
    // Back off to a 5s ceiling rather than hammering a Redis that is down —
    // and never give up, since the queue is useless without it.
    retryStrategy: (attempt) => Math.min(attempt * 200, 5000),
  });

  const logError = throttledLogger(`redis:${label}`);
  connection.on("error", (err) => {
    // Logged, not thrown: ioredis reconnects on its own, and an unhandled
    // 'error' event on a Redis client would take the whole process down.
    logError(err.message);
  });
  connection.on("ready", () => console.log(`[redis:${label}] connected`));
  connection.on("end", () => console.warn(`[redis:${label}] connection closed`));

  connections.add(connection);
  return connection;
}

/** Closes every connection this process opened. Used on shutdown. */
async function closeRedisConnections() {
  await Promise.all(
    [...connections].map(async (connection) => {
      try {
        await connection.quit();
      } catch {
        // Already gone, or mid-reconnect — nothing useful left to do.
      }
    })
  );
  connections.clear();
}

/** True when at least one connection is live — for the health endpoint. */
function isRedisReady() {
  return [...connections].some((connection) => connection.status === "ready");
}

module.exports = { createRedisConnection, closeRedisConnections, isRedisReady, throttledLogger };
