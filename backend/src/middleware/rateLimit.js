/**
 * A fixed-window rate limit, counted in this process's memory.
 *
 * For the few routes anyone can call without signing in (a shared Live
 * Lookbook), where nothing else stands between a script and the database.
 * Counted per process, so each API instance keeps its own tally. That makes
 * it a ceiling rather than an exact quota, and it keeps working when Redis
 * is away.
 *
 * @param {object} options
 * @param {number} options.windowMs  Length of one window.
 * @param {number} options.max       Requests allowed per key per window.
 * @param {(req) => string} options.key  What is counted: an address, usually.
 */
function rateLimit({ windowMs, max, key }) {
  /** key → { count, resetAt } */
  const hits = new Map();
  /** Past this many keys in one window, the table is dropped rather than grown without bound. */
  const MAX_KEYS = 50_000;
  let sweptAt = Date.now();

  return function limit(req, res, next) {
    const now = Date.now();
    if (now - sweptAt >= windowMs) {
      for (const [id, entry] of hits) if (entry.resetAt <= now) hits.delete(id);
      sweptAt = now;
    }
    if (hits.size > MAX_KEYS) hits.clear();

    const id = key(req);
    let entry = hits.get(id);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(id, entry);
    }
    entry.count += 1;

    if (entry.count > max) {
      res.set("Retry-After", String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))));
      return res.status(429).json({ status: "error", code: "rate_limited", message: "Too many requests. Try again in a moment." });
    }
    next();
  };
}

module.exports = { rateLimit };
