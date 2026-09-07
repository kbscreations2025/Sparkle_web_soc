const http = require("http");
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const config = require("./config");
const { connectDb } = require("./db");
const authRoutes = require("./routes/auth");
const { initSocket } = require("./socket");

const app = express();

app.use(cors({ origin: config.frontendOrigin, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.get("/health", (req, res) => res.json({ status: "ok" }));
app.use("/api/auth", authRoutes);

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
