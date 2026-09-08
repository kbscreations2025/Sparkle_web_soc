const loginApi = require("./loginApi");

// requireAuth runs on every request (REST) and every socket in the 60s sweep,
// and each call was hitting the central login on Render — cold-start prone and
// the single biggest cost in this backend. An access token's claims don't
// change during its ~15min life, so verifying the same token twice inside a
// short window is pure waste. Cache the verified result briefly instead.
//
// Short enough that a revocation (deactivation, deletion) is still noticed
// quickly; long enough to collapse the usual burst of requests one page load
// or one socket-sweep tick produces into a single upstream call.
// The cached value is the in-flight *promise*, not the settled result. Caching
// only the result would let a burst of concurrent requests carrying the same
// cold token each miss and each call upstream — the very cost this exists to
// remove. Storing the promise means the first caller makes the call and the
// rest await it.
const VERIFY_CACHE_MS = 30 * 1000;
const verifyCache = new Map(); // accessToken -> { promise, expiresAt }

function cachedVerify(accessToken) {
  const hit = verifyCache.get(accessToken);
  if (hit && hit.expiresAt > Date.now()) return hit.promise;
  verifyCache.delete(accessToken);
  return undefined;
}

function rememberVerify(accessToken, promise) {
  verifyCache.set(accessToken, { promise, expiresAt: Date.now() + VERIFY_CACHE_MS });
  // Bound the cache: a token this old has almost certainly been refreshed
  // away, so drop it rather than let dead entries accumulate forever.
  if (verifyCache.size > 5000) {
    const oldestKey = verifyCache.keys().next().value;
    verifyCache.delete(oldestKey);
  }
}

/**
 * Reads an already-verified session from cache without ever calling central.
 * Safe unlike a raw JWT decode: a forged token can only ever be a cache hit if
 * it is byte-identical to a token central has already vouched for, so this
 * grants no trust the cache didn't already establish through a real call.
 *
 * Used where a session is merely convenient to know (e.g. which socket room
 * to nudge on logout) and a cache miss is fine to just skip — not on any path
 * that decides whether a request is allowed through.
 */
async function peekVerifiedSession(accessToken) {
  const cached = cachedVerify(accessToken);
  if (!cached) return null;
  const user = await cached;
  return user ? { user, accessToken } : null;
}

function safeVerify(accessToken) {
  if (!accessToken) return Promise.resolve(null);

  const cached = cachedVerify(accessToken);
  if (cached !== undefined) return cached;

  const promise = loginApi
    .verifyToken(accessToken)
    .then((result) => (result.status === "success" ? result : null))
    .catch(() => {
      // A network hiccup is not a verdict worth keeping: drop the entry so the
      // next caller retries instead of inheriting the failure for 30 seconds.
      verifyCache.delete(accessToken);
      return null;
    });

  rememberVerify(accessToken, promise);
  return promise;
}

async function safeRefresh(refreshToken) {
  if (!refreshToken) return null;
  try {
    const result = await loginApi.refreshToken(refreshToken);
    return result.status === "success" ? result : null;
  } catch (err) {
    return null;
  }
}

// Shared by the REST middleware and the socket layer: an expired access token
// alone is never a logout, only a failed refresh (refresh_token itself revoked)
// means the session actually ended.
async function resolveSession(accessToken, refreshToken) {
  const verified = await safeVerify(accessToken);
  if (verified) return { user: verified, accessToken };

  const refreshed = await safeRefresh(refreshToken);
  if (!refreshed) return null;

  const reverified = await safeVerify(refreshed.access_token);
  if (!reverified) return null;

  return { user: reverified, accessToken: refreshed.access_token };
}

module.exports = { resolveSession, peekVerifiedSession };
