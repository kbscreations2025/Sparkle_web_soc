const config = require("./config");

const isProd = config.nodeEnv === "production";

const baseCookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? "none" : "lax",
  path: "/",
};

// Browsers cap cookie lifetime at 400 days; the underlying session itself
// has no time-based expiry per the login server, only logout/deactivation end it.
const LONG_MAX_AGE = 400 * 24 * 60 * 60 * 1000;
const ACCESS_MAX_AGE = 15 * 60 * 1000;

function setAuthCookies(res, { access_token, refresh_token, device_token, user } = {}) {
  if (access_token) {
    res.cookie("access_token", access_token, { ...baseCookieOptions, maxAge: ACCESS_MAX_AGE });
  }
  if (refresh_token) {
    res.cookie("refresh_token", refresh_token, { ...baseCookieOptions, maxAge: LONG_MAX_AGE });
  }
  if (device_token) {
    res.cookie("device_token", device_token, { ...baseCookieOptions, maxAge: LONG_MAX_AGE });
  }
  if (user) {
    const encoded = Buffer.from(JSON.stringify(user)).toString("base64");
    res.cookie("user_profile", encoded, { ...baseCookieOptions, maxAge: LONG_MAX_AGE });
  }
}

/**
 * Logout revokes the trusted device server-side too, so device_token goes with
 * it by default. `keepDeviceToken` is for the one caller that ends only this
 * browser's session (/session/clear): the device is still trusted upstream, so
 * dropping the cookie would force a needless OTP on the next sign-in.
 */
function clearAuthCookies(res, { keepDeviceToken = false } = {}) {
  const names = ["access_token", "refresh_token", "user_profile"];
  if (!keepDeviceToken) names.push("device_token");

  names.forEach((name) => res.clearCookie(name, baseCookieOptions));
}

// Split out so the socket layer can decode the same cookie from a raw
// handshake value, without an Express `req` to read it from.
function decodeUserProfile(raw) {
  try {
    return JSON.parse(Buffer.from(raw || "", "base64").toString("utf8"));
  } catch (err) {
    return {};
  }
}

function readUserProfile(req) {
  return decodeUserProfile(req.cookies.user_profile);
}

module.exports = { setAuthCookies, clearAuthCookies, readUserProfile, decodeUserProfile };
