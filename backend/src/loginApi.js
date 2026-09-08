const axios = require("axios");
const config = require("./config");

const client = axios.create({
  baseURL: config.loginApiBaseUrl,
  headers: {
    "X-Client-Id": config.clientId,
    "X-Client-Secret": config.clientSecret,
  },
});

async function post(path, body) {
  const { data } = await client.post(path, body);
  return data;
}

// `forceLogoutOthers` is the retry after the user confirms a session_limit_reached
// prompt. It must be the SAME request as the one that was refused, otherwise the
// login server has nothing to match the confirmation against.
const verifyLogin = ({ email, password, deviceToken, forceLogoutOthers }) =>
  post("/api/v1/verify-login", {
    email,
    password,
    ...(deviceToken && { device_token: deviceToken }),
    ...(forceLogoutOthers && { force_logout_others: true }),
  });

// The OTP is not consumed by a session_limit_reached response, so the retry
// reuses the same code rather than asking the user for a fresh one.
const verifyOtp = ({ email, otp, forceLogoutOthers }) =>
  post("/api/v1/verify-otp", {
    email,
    otp,
    ...(forceLogoutOthers && { force_logout_others: true }),
  });

const verifyToken = (accessToken) => post("/api/v1/verify-token", { access_token: accessToken });

const refreshToken = (refreshTokenValue) => post("/api/v1/refresh-token", { refresh_token: refreshTokenValue });

const logout = (refreshTokenValue) => post("/api/v1/logout", { refresh_token: refreshTokenValue });

/**
 * Every user registered against this application, as far as the central login
 * is concerned. Unlike `listAppUsers`, this is authorized with the service's
 * own client id and secret (the default headers on `client`) rather than a
 * caller's bearer token — so it is not scoped to what one super admin can see,
 * it is the whole list central holds for this app.
 *
 * Responds `{ status, users: [{ user_id, name, email, status, is_test_user,
 * test_access_expires_at, role, permissions, granted_at }] }`.
 */
const listAppUsersByClient = async () => {
  const { data } = await client.get("/api/v1/app-users");
  return data.users;
};

module.exports = { verifyLogin, verifyOtp, verifyToken, refreshToken, logout, listAppUsersByClient };
