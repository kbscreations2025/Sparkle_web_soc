const { Server } = require("socket.io");
const cookie = require("cookie");
const config = require("./config");
const { decodeUserProfile } = require("./cookies");
const { resolveSession } = require("./session");
const User = require("./models/user");

const REVALIDATE_INTERVAL_MS = 60 * 1000;

let ioInstance = null;

/**
 * This app's User `_id` for a central `user_id`, or null for someone with no
 * row here yet (a super admin before provisioning).
 *
 * A read, never a write: linking an account is the login path's job, and a
 * websocket handshake must not be able to create rows.
 */
async function appUserFor(centralUserId) {
  if (!centralUserId) return null;
  try {
    const row = await User.findOne({ authUserId: centralUserId }).select("_id tenantId").lean();
    return row ? { id: String(row._id), tenantId: row.tenantId ? String(row.tenantId) : null } : null;
  } catch (err) {
    // A socket that can't resolve its second room still gets auth events on
    // the first one — worth degrading rather than refusing the connection.
    console.error("[socket] could not resolve app user id:", err.message);
    return null;
  }
}

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

    // This app's own id for the same person. Resolved here rather than in the
    // connection handler on purpose: an await there would leave a window after
    // the socket is live but before it has joined its rooms, and anything
    // emitted in that window would be dropped.
    const appUser = await appUserFor(socket.data.user.user_id);
    socket.data.appUserId = appUser?.id ?? null;
    socket.data.tenantId = appUser?.tenantId ?? null;
    next();
  });

  io.on("connection", (socket) => {
    socket.join(`user:${socket.data.user.user_id}`);

    /**
     * The same person has two ids, and both address them here.
     *
     * The central login knows them as `user_id`; everything this application
     * stores — jobs, generations, assets — references the Mongo `_id` of their
     * User row. Auth-side events (a forced logout) are addressed by the
     * former, and every application event by the latter, so a socket that
     * joined only one of the two rooms silently received half the traffic:
     * job progress was emitted to a room with nobody in it, and the queue only
     * appeared to update because opening it triggers a REST refresh.
     */
    if (socket.data.appUserId) socket.join(`user:${socket.data.appUserId}`);

    // Also joined by email, because a login that still needs an OTP is
    // answered with `otp_required` and no user object — the email is the only
    // handle we have on whose sessions were just displaced.
    if (socket.data.email) socket.join(`email:${socket.data.email}`);

    // Everyone in one organization, for the few events that concern all of
    // them — see emitToTenant, and why those events carry no content.
    if (socket.data.tenantId) socket.join(`tenant:${socket.data.tenantId}`);
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

/**
 * Pushes an event to every open tab in one organization.
 *
 * Only ever a ping, never the thing itself. Who may see a colleague's result
 * depends on each viewer's grants and data scope, and those are checked by
 * the REST routes — so a tenant-wide event says only "something changed",
 * and each page asks for what it is allowed to see. Putting a result in the
 * payload would hand it to everyone in the organization, scope or not.
 */
function emitToTenant(tenantId, event, payload = {}) {
  if (!ioInstance || !tenantId) return;
  ioInstance.to(`tenant:${tenantId}`).emit(event, payload);
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

module.exports = { initSocket, forceLogout, forceLogoutByEmail, liveSessionCounts, emitToUser, emitToTenant };
