const { resolveSession } = require("../session");
const { setAuthCookies, clearAuthCookies } = require("../cookies");

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

  req.user = session.user;
  next();
}

module.exports = { requireAuth };
