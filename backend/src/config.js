require("dotenv").config();

module.exports = {
  port: process.env.PORT || 4000,
  nodeEnv: process.env.NODE_ENV || "development",
  loginApiBaseUrl: process.env.LOGIN_API_BASE_URL,
  clientId: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  frontendOrigin: process.env.FRONTEND_ORIGIN || "http://localhost:3000",
  mongoUri: process.env.MONGODB_URI,
  mongoDbName: process.env.MONGODB_DB_NAME || "sparkle",
};
