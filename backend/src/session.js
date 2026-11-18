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

/*
 * What a session check can come back with. The first two are answers from the
 * central login; the third means it couldn't be asked.
 *
 * They call for opposite responses, so they are never folded together.
 * "invalid" ends the session: cookies cleared, the user sent to sign in.
 * "unavailable" must not. The central login sleeps and wakes (it's on Render),
 * drops a connection now and then, and is reached over a network like
 * anything else. Treating that as a sign-out is what logged people out in the
 * middle of their work. Because the trusted-device cookie was cleared with
 * the rest, they then also needed an OTP to get back in.
 */
const INVALID = Object.freeze({ status: "invalid" });
const UNAVAILABLE = Object.freeze({ status: "unavailable" });

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
 * Whether a failed call is the central login's verdict on the token, rather
 * than a failure to reach it. A 4xx is central answering: the token is
 * expired, revoked or malformed. Anything else isn't an answer. That covers
 * no reply at all (timeout, dropped connection, DNS), a 5xx (down, waking up,
 * mid-deploy) and a 408 or 429 (asked to come back later).
 */
function isVerdict(err) {
  const status = err?.response?.status;
  return typeof status === "number" && status >= 400 && status < 500 && status !== 408 && status !== 429;
}

/** No reply of any kind, and not because the call ran out of time. */
function isDroppedConnection(err) {
  return !err?.response && err?.code !== "ECONNABORTED" && err?.code !== "ETIMEDOUT";
}

const RETRY_DELAY_MS = 300;

/**
 * Calls central, and once more if the connection dropped before any reply.
 * A pooled connection the far side already closed ("socket hang up",
 * ECONNRESET) is the commonest blip, and a second try almost always lands.
 * A timeout is not retried, because it has already waited its full share.
 */
async function callCentral(call) {
  try {
    return await call();
  } catch (err) {
    if (!isDroppedConnection(err)) throw err;
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    return call();
  }
}

// One line in the logs per burst rather than one per request: when central is
// down, every request in flight would otherwise say the same thing.
const WARN_EVERY_MS = 10 * 1000;
let lastWarnAt = 0;

function warnUnavailable(step, err) {
  const now = Date.now();
  if (now - lastWarnAt < WARN_EVERY_MS) return;
  lastWarnAt = now;
  const detail = err?.response ? `HTTP ${err.response.status}` : err?.code || err?.message;
  console.warn(`[session] could not reach the central login to ${step} (${detail}); keeping the session`);
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
  const verdict = await cached;
  return verdict.status === "ok" ? { user: verdict.user, accessToken } : null;
}

function safeVerify(accessToken) {
  if (!accessToken) return Promise.resolve(INVALID);

  const cached = cachedVerify(accessToken);
  if (cached !== undefined) return cached;

  const promise = callCentral(() => loginApi.verifyToken(accessToken))
    .then((result) => (result?.status === "success" ? { status: "ok", user: result } : INVALID))
    .catch((err) => {
      if (isVerdict(err)) return INVALID;
      // Not a verdict worth keeping: drop the entry so the next caller asks
      // again instead of inheriting the failure for 30 seconds.
      if (verifyCache.get(accessToken)?.promise === promise) verifyCache.delete(accessToken);
      warnUnavailable("verify a session", err);
      return UNAVAILABLE;
    });

  rememberVerify(accessToken, promise);
  return promise;
}

async function safeRefresh(refreshToken) {
  if (!refreshToken) return INVALID;
  try {
    const result = await callCentral(() => loginApi.refreshToken(refreshToken));
    return result?.status === "success" && result.access_token
      ? { status: "ok", accessToken: result.access_token }
      : INVALID;
  } catch (err) {
    if (isVerdict(err)) return INVALID;
    warnUnavailable("refresh a session", err);
    return UNAVAILABLE;
  }
}

/**
 * Who this is, as `{ status: "ok", user, accessToken }`, or
 * `{ status: "invalid" }` when the session has ended, or
 * `{ status: "unavailable" }` when the central login couldn't be asked.
 * Shared by the REST middleware and the socket layer.
 *
 * An expired access token alone is never a sign-out, because it lapses every
 * 15 minutes. The session has ended only when central refuses the refresh
 * token. A verify that couldn't get through returns at once rather than
 * trying a refresh: central is just as unreachable for that, and a second
 * timeout would only double the wait.
 */
async function checkSession(accessToken, refreshToken) {
  const verified = await safeVerify(accessToken);
  if (verified.status === "ok") return { status: "ok", user: verified.user, accessToken };
  if (verified.status === "unavailable") return UNAVAILABLE;

  const refreshed = await safeRefresh(refreshToken);
  if (refreshed.status !== "ok") return refreshed;

  const reverified = await safeVerify(refreshed.accessToken);
  if (reverified.status !== "ok") return reverified;

  return { status: "ok", user: reverified.user, accessToken: refreshed.accessToken };
}

/**
 * The older yes-or-no form: the session, or null for anything else. Kept so a
 * caller that only needs "is there a session right now" has a simple shape.
 * Never use it to decide whether to end a session; use checkSession, which
 * tells "ended" apart from "couldn't check".
 */
async function resolveSession(accessToken, refreshToken) {
  const session = await checkSession(accessToken, refreshToken);
  return session.status === "ok" ? { user: session.user, accessToken: session.accessToken } : null;
}

module.exports = { checkSession, resolveSession, peekVerifiedSession };
