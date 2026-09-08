require("dotenv").config();

module.exports = {
  port: process.env.PORT || 4000,
  nodeEnv: process.env.NODE_ENV || "development",
  loginApiBaseUrl: process.env.LOGIN_API_BASE_URL,
  clientId: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  frontendOrigin: process.env.FRONTEND_ORIGIN || "http://localhost:3000",
  // This app's code in the central login's permissioned_applications list.
  // Without it, super-admin detection falls back to the central top-level role.
  centralAppCode: process.env.CENTRAL_APP_CODE,
  mongoUri: process.env.MONGODB_URI,
  mongoDbName: process.env.MONGODB_DB_NAME || "sparkle",
};
