const { checkSession } = require("../session");
const { setAuthCookies, clearAuthCookies, readUserProfile } = require("../cookies");
const { resolveAppUser } = require("../appUser");
const { hasPermission } = require("../permissions");
const { resolveStoredImages, InlineImageError } = require("./inlineImages");

// Two deliberately separate steps: checkSession proves who this is against
// the central login, resolveAppUser decides what this application lets them
// do. Passing the first has never implied the second.
async function requireAuth(req, res, next) {
  const accessToken = req.cookies.access_token;
  const session = await checkSession(accessToken, req.cookies.refresh_token);

  // The central login couldn't be reached to check. That's not the same as
  // it saying no. Ask the client to try again and leave the cookies alone:
  // clearing them here is what used to sign people out whenever central was
  // slow, waking up or briefly unreachable.
  if (session.status === "unavailable") {
    res.set("Retry-After", "5");
    return res.status(503).json({
      status: "error",
      code: "auth_unavailable",
      message: "Couldn't reach the sign-in service. Please try again in a moment.",
    });
  }

  if (session.status !== "ok") {
    // Central refused the refresh token, so the session really has ended.
    // The trusted-device cookie is kept, as on a normal logout: whether the
    // device is still trusted is central's call, made at the next sign-in.
    // Clearing it here forced an OTP on every one of these.
    clearAuthCookies(res, { keepDeviceToken: true });
    return res.status(401).json({ status: "error", code: "not_authenticated", message: "not authenticated" });
  }

  // Only rewrite the cookie when resolveSession actually had to refresh it.
  if (session.accessToken !== accessToken) {
    setAuthCookies(res, { access_token: session.accessToken });
  }

  let resolved;
  try {
    resolved = await resolveAppUser(session.user, readUserProfile(req));
  } catch (err) {
    console.error("resolveAppUser failed:", err.message);
    return res.status(500).json({ status: "error", message: "could not resolve your access" });
  }

  // 403, not 401: they are signed in, so clearing their cookies and bouncing
  // them to the login form would only loop them through a successful login.
  if (resolved.denied) {
    return res.status(403).json({ status: "error", ...resolved.denied });
  }

  req.appUser = resolved.user;
  req.dbUser = resolved.dbUser;
  req.isSuperAdmin = resolved.isSuperAdmin;

  // Images named as `stored:<url>` (a past result being edited) are fetched
  // here, after the caller is known, so the route sees the data URI it always
  // has. See middleware/inlineImages.js.
  if (req.method !== "GET") {
    try {
      await resolveStoredImages(req);
    } catch (err) {
      if (err instanceof InlineImageError) {
        return res.status(err.status).json({ status: "error", code: err.code, message: err.message });
      }
      console.error("resolveStoredImages failed:", err.message);
      return res.status(500).json({ status: "error", message: "Couldn't load the image. Please try again." });
    }
  }

  next();
}

// Gate for an individual API route. Reads only our database — the central
// login has no say in what a route allows.
function requirePermission(required) {
  return function checkPermission(req, res, next) {
    if (req.isSuperAdmin) return next();
    if (hasPermission(req.dbUser, required)) return next();

    return res.status(403).json({
      status: "error",
      message: `missing permission: ${required}`,
      code: "forbidden",
    });
  };
}

/**
 * Any one of these is enough.
 *
 * For a resource two tools share rather than one owning it — the saved model
 * library belongs to Lifestyle and Marketing Kit equally, and someone
 * granted only the second must still be able to pick a model.
 */
function requireAnyPermission(required) {
  return function checkAnyPermission(req, res, next) {
    if (req.isSuperAdmin) return next();
    if (required.some((grant) => hasPermission(req.dbUser, grant))) return next();

    return res.status(403).json({
      status: "error",
      message: `missing permission: one of ${required.join(", ")}`,
      code: "forbidden",
    });
  };
}

// The console's gate. Only a central super_admin may create organizations or
// change anyone's permissions.
function requireSuperAdmin(req, res, next) {
  if (req.isSuperAdmin) return next();
  return res.status(403).json({ status: "error", message: "super admin only", code: "forbidden" });
}

module.exports = { requireAuth, requirePermission, requireAnyPermission, requireSuperAdmin };
