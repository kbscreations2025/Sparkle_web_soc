const loginApi = require("./loginApi");

async function safeVerify(accessToken) {
  if (!accessToken) return null;
  try {
    const result = await loginApi.verifyToken(accessToken);
    return result.status === "success" ? result : null;
  } catch (err) {
    return null;
  }
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

module.exports = { resolveSession };
