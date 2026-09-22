const mongoose = require("mongoose");
const { TOOL_KEYS } = require("../grants");
const User = require("../models/user");

const { SCOPE_KINDS } = User;

/**
 * The pieces every admin-facing route was writing out for itself.
 *
 * `handle`, `bad` and `isId` had been copied into five route files, and had
 * already drifted: admin.js mapped a duplicate key to 409 and a validation
 * error to 400, adminPricing.js mapped only the second, and the three
 * newest files mapped neither — so the same bad request answered 409, 400 or
 * 500 depending on which route received it. The version here is the
 * superset, so every route answers the same way.
 */

/**
 * Wraps an async handler so a rejection becomes a reply rather than a hung
 * request — Express 4 does not forward a rejected promise to the error
 * middleware, so without this the client waits forever.
 */
const handle = (fn) => (req, res, next) => {
  fn(req, res, next).catch((err) => {
    // 11000 is Mongo's duplicate-key error: a slug or an email already taken.
    if (err.code === 11000) {
      return res.status(409).json({ status: "error", message: "that already exists", code: "duplicate" });
    }
    if (err.name === "ValidationError") {
      return res.status(400).json({ status: "error", message: err.message, code: "invalid" });
    }
    // Mongoose throws this for a malformed ObjectId, which means the same
    // thing to a caller as no such row.
    if (err.name === "CastError") {
      return res.status(404).json({ status: "error", message: "not found", code: "not_found" });
    }
    console.error(`${req.method} ${req.originalUrl} failed:`, err);
    res.status(500).json({ status: "error", message: "something went wrong" });
  });
};

const bad = (res, message) => res.status(400).json({ status: "error", message, code: "invalid" });
const notFound = (res, what) => res.status(404).json({ status: "error", message: `${what} not found`, code: "not_found" });
const isId = (value) => mongoose.Types.ObjectId.isValid(value);

/**
 * One member, shaped for the console.
 *
 * Shared because two routes serve the same `Member` type to the same table
 * component (see frontend/lib/api.ts): adding a field to one and forgetting
 * the other gave `undefined` in the UI for one caller only.
 */
const toMember = (user, liveSessions = 0, credits = null) => ({
  id: user._id,
  authUserId: user.authUserId,
  name: user.name,
  email: user.email,
  role: user.role,
  status: user.status,
  permissions: user.permissions,
  dataScope: user.dataScope,
  permissionVersion: user.permissionVersion,
  /** Tells the admin whether this person has ever actually signed in. */
  linked: Boolean(user.authUserId),
  lastLoginAt: user.lastLoginAt,
  /** Open connections right now — 0 means they aren't using the app. */
  liveSessions,
  /**
   * What this person can spend. Zero means they cannot generate at all,
   * since charging is enforced — the one thing about a member an admin most
   * needs from the list rather than by opening them.
   */
  credits: credits ?? { balance: 0, reserved: 0, available: 0 },
});

/**
 * Validates a data scope against one organization.
 *
 * Shared for a reason found the hard way: a second, hand-rolled copy checked
 * the kind and the member ids but knew nothing about `toolKeys`, `notBefore`
 * or `canExport` — so saving a member through that route silently dropped
 * their tool limiter, and `resultReadFilter` treats a missing limiter as no
 * limit at all.
 *
 * @returns `{ value }` with the normalized scope, or `{ error }`.
 */
async function validateScope(scope, tenantId) {
  if (!scope) return { value: undefined };
  if (!SCOPE_KINDS.includes(scope.kind)) {
    return { error: `dataScope.kind must be one of: ${SCOPE_KINDS.join(", ")}` };
  }

  const value = { kind: scope.kind };

  if (scope.kind === "selected") {
    const ids = (scope.userIds || []).filter(isId);
    if (ids.length === 0) return { error: 'a "selected" scope needs at least one member' };

    // Everyone named has to be in this organization — a scope reaching
    // across tenants is the one thing it must never do.
    const found = await User.countDocuments({ _id: { $in: ids }, tenantId, deletedAt: null });
    if (found !== ids.length) {
      return { error: "a selected member does not belong to this organization" };
    }
    value.userIds = ids;
  }

  // Absent limiters mean "no limit", so only carry the ones actually set.
  if (Array.isArray(scope.toolKeys) && scope.toolKeys.length) {
    // A typo here would silently narrow this member's reach forever —
    // resultReadFilter treats an unmatched toolKey as "no access".
    const unknown = scope.toolKeys.filter((key) => !TOOL_KEYS.includes(key));
    if (unknown.length) return { error: `unknown tool key(s): ${unknown.join(", ")}` };
    value.toolKeys = scope.toolKeys;
  }
  if (scope.notBefore) value.notBefore = new Date(scope.notBefore);
  if (typeof scope.canExport === "boolean") value.canExport = scope.canExport;

  return { value };
}

module.exports = { handle, bad, notFound, isId, toMember, validateScope };
