const { Server } = require("socket.io");
const cookie = require("cookie");
const config = require("./config");
const { decodeUserProfile } = require("./cookies");
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
    // verify-token returns no email, so it comes from the profile cookie we
    // wrote at login.
    socket.data.email = decodeUserProfile(cookies.user_profile).email?.toLowerCase() || null;
    next();
  });

  io.on("connection", (socket) => {
    socket.join(`user:${socket.data.user.user_id}`);

    // Also joined by email, because a login that still needs an OTP is
    // answered with `otp_required` and no user object — the email is the only
    // handle we have on whose sessions were just displaced.
    if (socket.data.email) socket.join(`email:${socket.data.email}`);
  });

  setInterval(() => revalidateAll(io), REVALIDATE_INTERVAL_MS);

  ioInstance = io;
  return io;
}

/**
 * Only a session whose refresh token is truly gone gets disconnected here, not
 * one whose access token just expired between sweeps.
 *
 * This is a narrower rule than the REST requireAuth middleware, which also
 * runs resolveAppUser and refuses a member who is no longer active. Changes to
 * a member's standing in *this* app are pushed out at the moment they happen
 * (admin.js calls forceLogout) rather than waited for here — so this sweep
 * only has to catch sessions ended at the central login.
 *
 * Run in parallel: every socket carries its own token, so the verify cache
 * can't help, and one sequential upstream call each would make a sweep of a
 * few hundred sockets outlast the interval that scheduled it.
 */
let sweeping = false;

async function revalidateAll(io) {
  if (sweeping) return; // a slow sweep must not stack up behind itself
  sweeping = true;

  try {
    const live = [...io.sockets.sockets.values()].filter((socket) => socket.data.user);

    await Promise.all(
      live.map(async (socket) => {
        const session = await resolveSession(socket.data.accessToken, socket.data.refreshToken);
        if (!session) {
          socket.emit("auth:revoked");
          socket.disconnect(true);
          return;
        }
        socket.data.accessToken = session.accessToken;
      })
    );
  } finally {
    sweeping = false;
  }
}

// How many live connections each of these people currently holds. Sockets join
// a `user:<central user_id>` room on connect, so the room size IS the count of
// open tabs/devices — which is what the console's "active" column shows.
function liveSessionCounts(userIds = []) {
  if (!ioInstance) return {};
  const rooms = ioInstance.sockets.adapter.rooms;

  return userIds.reduce((counts, id) => {
    if (id) counts[id] = rooms.get(`user:${id}`)?.size ?? 0;
    return counts;
  }, {});
}

/**
 * Pushes a live event to every open tab/device of one user — e.g. History
 * pages watching for new generations without polling. A no-op before the
 * socket server has started (a request could in principle race server
 * startup) or if nobody of theirs is currently connected.
 */
function emitToUser(userId, event, payload) {
  if (!ioInstance || !userId) return;
  ioInstance.to(`user:${userId}`).emit(event, payload);
}

/** Evicts every socket in `room`, returning how many there were. */
function evictRoom(room) {
  if (!ioInstance) return 0;

  // Read the size before disconnecting — the room is gone afterwards.
  const size = ioInstance.sockets.adapter.rooms.get(room)?.size ?? 0;
  if (size === 0) return 0;

  ioInstance.in(room).emit("auth:revoked");
  ioInstance.in(room).disconnectSockets(true);
  return size;
}

function forceLogout(userId) {
  if (!userId) return 0;
  return evictRoom(`user:${userId}`);
}

/**
 * Same eviction, addressed by email. Needed because the new-device login path
 * clears a session conflict and then answers `otp_required` — which carries no
 * user id — so at the moment the other sessions die, email is all we know.
 */
function forceLogoutByEmail(email) {
  if (!email) return 0;
  return evictRoom(`email:${String(email).toLowerCase()}`);
}

module.exports = { initSocket, forceLogout, forceLogoutByEmail, liveSessionCounts, emitToUser };
