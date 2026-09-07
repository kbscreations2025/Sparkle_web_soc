const mongoose = require("mongoose");
const config = require("./config");

async function connectDb() {
  if (!config.mongoUri) throw new Error("MONGODB_URI is not configured");

  mongoose.connection.on("error", (err) => console.error("MongoDB error:", err.message));
  mongoose.connection.on("disconnected", () => console.warn("MongoDB disconnected"));

  await mongoose.connect(config.mongoUri, {
    dbName: config.mongoDbName,
    serverSelectionTimeoutMS: 10000,
  });

  // Unique constraints on tenants.slug and users.{authUserId,tenantId} are
  // correctness, not optimization — build them at boot instead of relying on
  // autoIndex, which is a no-op once the process is running in production.
  await Promise.all([
    require("./models/tenant").syncIndexes(),
    require("./models/user").syncIndexes(),
  ]);

  console.log(`MongoDB connected (${mongoose.connection.name})`);
  return mongoose.connection;
}

module.exports = { connectDb };
