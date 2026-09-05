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

// Logout revokes the trusted device server-side too, so clear device_token here as well.
function clearAuthCookies(res) {
  ["access_token", "refresh_token", "device_token", "user_profile"].forEach((name) => {
    res.clearCookie(name, baseCookieOptions);
  });
}

function readUserProfile(req) {
  try {
    return JSON.parse(Buffer.from(req.cookies.user_profile || "", "base64").toString("utf8"));
  } catch (err) {
    return {};
  }
}

module.exports = { setAuthCookies, clearAuthCookies, readUserProfile };
