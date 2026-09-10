const http = require("http");
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const config = require("./config");
const { connectDb } = require("./db");
const authRoutes = require("./routes/auth");
const adminRoutes = require("./routes/admin");
const cleaningRoutes = require("./routes/cleaning");
const chatToEditRoutes = require("./routes/chatToEdit");
const historyRoutes = require("./routes/history");
const { initSocket } = require("./socket");

const app = express();

// So `req.ip` is the real client address, not a reverse proxy's, for the
// audit log (and anything else that ever wants it). `1` trusts exactly one
// hop in front of this process — the typical single load balancer/reverse
// proxy deployment — rather than blindly trusting an arbitrary chain.
app.set("trust proxy", 1);

app.use(cors({ origin: config.frontendOrigin, credentials: true }));
app.use(express.json({ limit: config.jsonBodyLimit }));
app.use(cookieParser());

app.get("/health", (req, res) => res.json({ status: "ok" }));
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/cleaning", cleaningRoutes);
app.use("/api/chat-to-edit", chatToEditRoutes);
app.use("/api/history", historyRoutes);

/**
 * Last stop for anything a route didn't handle itself.
 *
 * Without this, Express answers an oversized body with an HTML stack trace,
 * which the frontend then fails to parse as JSON and reports as "could not
 * reach the server" — hiding the real cause. Everything here answers in the
 * same `{ status, message, code }` envelope the routes use.
 */
// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity; `next` must stay.
app.use((err, req, res, next) => {
  // Thrown by body-parser before any route runs, so no route can catch it.
  if (err.type === "entity.too.large") {
    return res.status(413).json({
      status: "error",
      message: `That request is larger than the ${config.jsonBodyLimit} limit. Try fewer or smaller images.`,
      code: "payload_too_large",
    });
  }

  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ status: "error", message: "malformed JSON body", code: "invalid_json" });
  }

  console.error("unhandled error:", err);
  res.status(500).json({ status: "error", message: "something went wrong" });
});

const httpServer = http.createServer(app);
initSocket(httpServer);

// Fail fast rather than accepting requests that would all 500 on the first query.
connectDb()
  .then(() => {
    httpServer.listen(config.port, () => {
      console.log(`Backend listening on http://localhost:${config.port}`);
    });
  })
  .catch((err) => {
    console.error("Startup failed:", err.message);
    process.exit(1);
  });
