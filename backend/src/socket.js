const { Server } = require("socket.io");
const cookie = require("cookie");
const config = require("./config");
const { resolveSession } = require("./session");

const REVALIDATE_INTERVAL_MS = 60 * 1000;

let ioInstance = null;

function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: config.frontendOrigin, credentials: true },
  });

  io.use(async (socket, next) => {
    const cookies = cookie.parse(socket.handshake.headers.cookie || "");
    const session = await resolveSession(cookies.access_token, cookies.refresh_token);

    if (!session) return next(new Error("unauthorized"));

    socket.data.user = session.user;
    socket.data.accessToken = session.accessToken;
    socket.data.refreshToken = cookies.refresh_token;
    next();
  });

  io.on("connection", (socket) => {
    socket.join(`user:${socket.data.user.user_id}`);
  });

  setInterval(() => revalidateAll(io), REVALIDATE_INTERVAL_MS);

  ioInstance = io;
  return io;
}

// Same rule as the REST requireAuth middleware: only a session whose refresh
// token is truly gone gets disconnected here, not one whose access token just
// expired between sweeps.
async function revalidateAll(io) {
  for (const socket of io.sockets.sockets.values()) {
    if (!socket.data.user) continue;

    const session = await resolveSession(socket.data.accessToken, socket.data.refreshToken);
    if (!session) {
      socket.emit("auth:revoked");
      socket.disconnect(true);
      continue;
    }

    socket.data.accessToken = session.accessToken;
  }
}

function forceLogout(userId) {
  if (!ioInstance || !userId) return;
  const room = `user:${userId}`;
  ioInstance.in(room).emit("auth:revoked");
  ioInstance.in(room).disconnectSockets(true);
}

module.exports = { initSocket, forceLogout };
