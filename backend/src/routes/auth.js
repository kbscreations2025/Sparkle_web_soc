const express = require("express");
const loginApi = require("../loginApi");
const { setAuthCookies, clearAuthCookies } = require("../cookies");
const { requireAuth } = require("../middleware/auth");
const { resolveAppUser } = require("../appUser");
const { peekVerifiedSession } = require("../session");
const { forceLogout, forceLogoutByEmail } = require("../socket");
const { logAudit, requestMeta } = require("../auditLog");

const router = express.Router();

function upstreamError(err) {
  return err.response?.data?.message || "login service unavailable";
}

// Shared by /login (recognized device) and /verify-otp — both get back the
// same {user, access_token, refresh_token, device_token} shape on success.
//
// Central saying yes only settles identity, so app access is resolved before
// any cookie is set: someone this app doesn't know gets a plain explanation
// here instead of a session that fails on the very next request.
//
// `action` distinguishes which of the two flows landed here, purely for the
// audit trail — the actual logic is identical either way.
async function respondWithSession(res, result, { forcedLogoutOthers = false, meta, action = "auth.login_success" } = {}) {
  const resolved = await resolveAppUser(result.user);
  if (resolved.denied) {
    logAudit({
      action: "auth.login_failed",
      status: "failure",
      actorAuthUserId: result.user?.user_id || null,
      actorEmail: result.user?.email || null,
      message: resolved.denied.message,
      metadata: { code: resolved.denied.code },
      ...meta,
    });
    return res.status(403).json({ status: "error", ...resolved.denied });
  }

  // Central has just deleted the other sessions, so drop their live sockets in
  // the same breath. Without this the other device only finds out when its own
  // access token expires — up to 15 minutes of a screen that still works.
  //
  // Safe to fire before the new cookies are set: sockets are keyed by central
  // user_id, and the device logging in here has no socket yet (the client only
  // opens one once it has a user), so this can only reach the older sessions.
  if (forcedLogoutOthers) forceLogout(result.user.user_id);

  // Only name and email go into the profile cookie — it exists because
  // verify-token returns neither, not to carry central's role or permissions.
  setAuthCookies(res, {
    ...result,
    user: { name: resolved.user.name, email: resolved.user.email },
  });

  logAudit({
    tenantId: resolved.dbUser?.tenantId || null,
    actorUserId: resolved.dbUser?._id || null,
    actorAuthUserId: result.user.user_id,
    actorEmail: resolved.user.email,
    actorName: resolved.user.name,
    action,
    status: "success",
    targetType: "session",
    metadata: { forcedLogoutOthers, isSuperAdmin: resolved.isSuperAdmin },
    ...meta,
  });

  res.json({ status: "success", user: resolved.user });
}

router.post("/login", async (req, res) => {
  const meta = requestMeta(req);
  const { email, password, force_logout_others: forceLogoutOthers } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ status: "error", message: "email and password are required" });
  }

  try {
    const result = await loginApi.verifyLogin({
      email,
      password,
      deviceToken: req.cookies.device_token,
      forceLogoutOthers,
    });

    // A confirmed force-logout kills the other sessions the moment central
    // accepts it — even when the answer is otp_required, because a new device
    // still has to prove itself. So the eviction belongs HERE, not only on the
    // success path: waiting for tokens would leave the displaced device
    // running for the whole time it takes someone to fetch and type a code.
    //
    // Addressed by email: otp_required carries no user object.
    if (forceLogoutOthers && result.status !== "error") {
      const evicted = forceLogoutByEmail(email);
      if (evicted > 0) console.log(`force-logout: evicted ${evicted} socket(s) for ${email}`);
      logAudit({
        actorEmail: email,
        action: "auth.force_logout_others",
        status: "success",
        message: `evicted ${evicted} other session(s) for ${email}`,
        metadata: { evicted, keyedBy: "email" },
        ...meta,
      });
    }

    // Recognized device: verify-login returns tokens directly. Otherwise it's
    // otp_required (new device), session_limit_reached (already logged in
    // elsewhere — carries max_active_sessions and the active_sessions list the
    // client shows before confirming), or error. All pass through untouched.
    if (result.status === "success") {
      return await respondWithSession(res, result, {
        forcedLogoutOthers: Boolean(forceLogoutOthers),
        meta,
        action: "auth.login_success",
      });
    }

    if (result.status === "otp_required") {
      logAudit({ actorEmail: email, action: "auth.otp_required", status: "success", ...meta });
    } else if (result.status === "session_limit_reached") {
      logAudit({
        actorEmail: email,
        action: "auth.session_limit_reached",
        status: "failure",
        metadata: { max_active_sessions: result.max_active_sessions },
        ...meta,
      });
    } else if (result.status === "error") {
      logAudit({ actorEmail: email, action: "auth.login_failed", status: "failure", message: result.message, ...meta });
    }

    return res.json(result);
  } catch (err) {
    logAudit({ actorEmail: email, action: "auth.login_failed", status: "failure", message: upstreamError(err), ...meta });
    return res.status(502).json({ status: "error", message: upstreamError(err) });
  }
});

router.post("/verify-otp", async (req, res) => {
  const meta = requestMeta(req);
  const { email, otp, force_logout_others: forceLogoutOthers } = req.body || {};
  if (!email || !otp) {
    return res.status(400).json({ status: "error", message: "email and otp are required" });
  }

  try {
    // Can still come back session_limit_reached if someone took the last slot
    // between verify-login and here. The OTP survives that, so the client can
    // confirm and retry with this same code.
    const result = await loginApi.verifyOtp({ email, otp, forceLogoutOthers });
    if (result.status === "success") {
      return await respondWithSession(res, result, {
        forcedLogoutOthers: Boolean(forceLogoutOthers),
        meta,
        action: "auth.otp_verified",
      });
    }

    if (result.status === "session_limit_reached") {
      logAudit({
        actorEmail: email,
        action: "auth.session_limit_reached",
        status: "failure",
        metadata: { max_active_sessions: result.max_active_sessions },
        ...meta,
      });
    } else {
      logAudit({ actorEmail: email, action: "auth.otp_failed", status: "failure", message: result.message, ...meta });
    }

    return res.json(result);
  } catch (err) {
    logAudit({ actorEmail: email, action: "auth.otp_failed", status: "failure", message: upstreamError(err), ...meta });
    return res.status(502).json({ status: "error", message: upstreamError(err) });
  }
});

// The single source of truth for what the UI may render. `isSuperAdmin` is the
// only field the central login contributes; `role` and `permissions` come from
// this app's database, so central's own role and permissions never leak in.
router.get("/me", requireAuth, (req, res) => {
  res.json({ status: "success", user: req.appUser });
});

/**
 * Clears THIS browser's cookies and nothing else. Used by a client that has
 * just been told `auth:revoked` — its session was ended from elsewhere, so
 * there is nothing left to end upstream.
 *
 * Deliberately does NOT call the central logout: that revokes every trusted
 * device for the user, which would force a fresh OTP on the device that just
 * signed in and displaced this one. It also isn't optional — the displaced
 * device's access token stays valid at central for up to 15 minutes, so
 * without dropping these cookies the proxy would wave it straight back in.
 *
 * Not audit-logged: this is a local cookie clear the client runs *because*
 * it was already evicted — the eviction itself was logged at the moment it
 * happened, and this step carries no identity to attribute a row to.
 */
router.post("/session/clear", (req, res) => {
  // The device stays trusted upstream — only this browser's session ended.
  clearAuthCookies(res, { keepDeviceToken: true });
  res.json({ status: "success" });
});

router.post("/logout", async (req, res) => {
  const meta = requestMeta(req);
  const { refresh_token: refreshTokenValue, access_token: accessTokenValue } = req.cookies;

  try {
    if (refreshTokenValue) {
      await loginApi.logout(refreshTokenValue);
    }
  } catch (err) {
    // Clear cookies regardless — the client shouldn't stay "logged in" locally
    // just because the upstream call failed.
  }

  // Best-effort: disconnect the live socket now instead of waiting for its
  // periodic revalidation sweep. Cache-only — logging out shouldn't spend an
  // upstream round-trip (nor mint a fresh token) just to look up whose socket
  // to drop. A miss simply leaves it to the sweep.
  const session = await peekVerifiedSession(accessTokenValue);
  if (session) forceLogout(session.user.user_id);

  // A cache miss means no identity survives to attribute this to — logged
  // anyway, since "someone logged out with no verifiable session" is itself
  // worth a row, just with `actorEmail`/`actorAuthUserId` left null.
  logAudit({
    actorAuthUserId: session?.user?.user_id || null,
    actorEmail: session?.user?.email || null,
    action: "auth.logout",
    status: "success",
    ...meta,
  });

  clearAuthCookies(res);
  res.json({ status: "success" });
});

module.exports = router;
