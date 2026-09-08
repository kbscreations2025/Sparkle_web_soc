const { resolveSession } = require("../session");
const { setAuthCookies, clearAuthCookies, readUserProfile } = require("../cookies");
const { resolveAppUser } = require("../appUser");
const { hasPermission } = require("../permissions");

// Two deliberately separate steps: resolveSession proves who this is against
// the central login, resolveAppUser decides what this application lets them
// do. Passing the first has never implied the second.
async function requireAuth(req, res, next) {
  const accessToken = req.cookies.access_token;
  const session = await resolveSession(accessToken, req.cookies.refresh_token);

  if (!session) {
    clearAuthCookies(res);
    return res.status(401).json({ status: "error", message: "not authenticated" });
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

// The console's gate. Only a central super_admin may create organizations or
// change anyone's permissions.
function requireSuperAdmin(req, res, next) {
  if (req.isSuperAdmin) return next();
  return res.status(403).json({ status: "error", message: "super admin only", code: "forbidden" });
}

module.exports = { requireAuth, requirePermission, requireSuperAdmin };
