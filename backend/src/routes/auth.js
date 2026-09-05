const express = require("express");
const loginApi = require("../loginApi");
const { setAuthCookies, clearAuthCookies, readUserProfile } = require("../cookies");
const { requireAuth } = require("../middleware/auth");
const { resolveSession } = require("../session");
const { forceLogout } = require("../socket");

const router = express.Router();

function upstreamError(err) {
  return err.response?.data?.message || "login service unavailable";
}

// Shared by /login (recognized device) and /verify-otp — both get back the
// same {user, access_token, refresh_token, device_token} shape on success.
function respondWithSession(res, result) {
  setAuthCookies(res, result);
  res.json({ status: "success", user: result.user });
}

router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ status: "error", message: "email and password are required" });
  }

  try {
    const result = await loginApi.verifyLogin({
      email,
      password,
      deviceToken: req.cookies.device_token,
    });

    // Recognized device: verify-login returns tokens directly.
    // Otherwise it's otp_required (new device) or error (bad credentials) — pass through as-is.
    if (result.status === "success") return respondWithSession(res, result);
    return res.json(result);
  } catch (err) {
    return res.status(502).json({ status: "error", message: upstreamError(err) });
  }
});

router.post("/verify-otp", async (req, res) => {
  const { email, otp } = req.body || {};
  if (!email || !otp) {
    return res.status(400).json({ status: "error", message: "email and otp are required" });
  }

  try {
    const result = await loginApi.verifyOtp({ email, otp });
    if (result.status === "success") return respondWithSession(res, result);
    return res.json(result);
  } catch (err) {
    return res.status(502).json({ status: "error", message: upstreamError(err) });
  }
});

router.get("/me", requireAuth, (req, res) => {
  const profile = readUserProfile(req);
  res.json({
    status: "success",
    user: {
      user_id: req.user.user_id,
      role: req.user.role,
      permissions: req.user.permissions,
      name: profile.name,
      email: profile.email,
    },
  });
});

router.post("/logout", async (req, res) => {
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
  // periodic revalidation sweep. No refresh fallback here — logging out
  // shouldn't mint a fresh access token just to look up whose socket to drop.
  const session = await resolveSession(accessTokenValue, null);
  if (session) forceLogout(session.user.user_id);

  clearAuthCookies(res);
  res.json({ status: "success" });
});

module.exports = router;
