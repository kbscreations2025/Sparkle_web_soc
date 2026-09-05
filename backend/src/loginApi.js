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

const verifyLogin = ({ email, password, deviceToken }) =>
  post("/api/v1/verify-login", {
    email,
    password,
    ...(deviceToken && { device_token: deviceToken }),
  });

const verifyOtp = ({ email, otp }) => post("/api/v1/verify-otp", { email, otp });

const verifyToken = (accessToken) => post("/api/v1/verify-token", { access_token: accessToken });

const refreshToken = (refreshTokenValue) => post("/api/v1/refresh-token", { refresh_token: refreshTokenValue });

const logout = (refreshTokenValue) => post("/api/v1/logout", { refresh_token: refreshTokenValue });

module.exports = { verifyLogin, verifyOtp, verifyToken, refreshToken, logout };
