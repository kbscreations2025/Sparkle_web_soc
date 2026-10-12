/**
 * Logs this process's memory once a minute, so a climb on the host's memory
 * graph can be told apart from the logs:
 *
 * - `heap` growing run after run → objects are being kept alive in JS (a real
 *   leak: a cache, listener or array that never lets go).
 * - `rss` growing while `heap` stays flat → native memory (sharp/libvips,
 *   Buffers, allocator fragmentation), which no JS fix will touch.
 *
 * `external`/`buffers` are the Buffer and ArrayBuffer bytes held outside the
 * JS heap — base64-decoded images live there.
 */
const INTERVAL_MS = Number(process.env.MEMORY_LOG_INTERVAL_MS || 60_000);

const mb = (bytes) => Math.round(bytes / 1024 / 1024);

function startMemoryLog(label) {
  if (!(INTERVAL_MS > 0)) return;

  const timer = setInterval(() => {
    const { rss, heapUsed, heapTotal, external, arrayBuffers } = process.memoryUsage();
    console.log(
      `[memory:${label}] rss=${mb(rss)}MB heap=${mb(heapUsed)}/${mb(heapTotal)}MB external=${mb(external)}MB buffers=${mb(arrayBuffers)}MB`
    );
  }, INTERVAL_MS);

  // Never be the thing that keeps the process alive during shutdown.
  timer.unref();
}

module.exports = { startMemoryLog };
