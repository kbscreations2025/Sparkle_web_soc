const http = require("http");
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const config = require("./config");
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

httpServer.listen(config.port, () => {
  console.log(`Backend listening on http://localhost:${config.port}`);
});
