const AuditLog = require("./models/auditLog");

/**
 * Records one row to the audit trail. Never throws: a logging failure must
 * never turn an otherwise-successful login, permission change, or generation
 * into an error the user sees — the same "swallow and log" contract
 * `recordGeneration`'s callers already use for history-writing failures.
 */
async function logAudit(entry) {
  try {
    await AuditLog.create(entry);
  } catch (err) {
    console.error("audit log write failed:", err.message);
  }
}

/**
 * The two request-level facts almost every audit row wants. Requires
 * `app.set("trust proxy", ...)` in server.js for `req.ip` to be the real
 * client address rather than a reverse proxy's — see server.js for why.
 */
function requestMeta(req) {
  return { ip: req.ip || null, userAgent: req.headers["user-agent"] || null };
}

/**
 * Who did it, for any route already behind `requireAuth` — `req.appUser` and
 * `req.dbUser` are both populated there. Not usable inside `routes/auth.js`
 * itself: those routes run *before* a session exists, so they build their
 * actor fields by hand from whatever central/`resolveAppUser` gave back.
 */
function actorFrom(req) {
  return {
    actorUserId: req.dbUser?._id || null,
    actorAuthUserId: req.appUser?.user_id || req.dbUser?.authUserId || null,
    actorEmail: req.appUser?.email || req.dbUser?.email || null,
    actorName: req.appUser?.name || req.dbUser?.name || null,
  };
}

module.exports = { logAudit, requestMeta, actorFrom };
