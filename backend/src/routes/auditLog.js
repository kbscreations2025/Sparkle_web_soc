const express = require("express");
const mongoose = require("mongoose");
const { requireAuth, requirePermission } = require("../middleware/auth");
const AuditLog = require("../models/auditLog");
const User = require("../models/user");

const { AUDIT_ACTIONS, TARGET_TYPES } = AuditLog;

const router = express.Router();

/*
 * An organization's own audit trail, for whoever in it holds
 * `org.audit.read` — distinct from the super admin console, which reads
 * across every tenant.
 *
 * The scoping rule for this whole file: `tenantId` comes from the session
 * and never from the request. A client-supplied tenant filter is the one way
 * this route could leak another company's history, so it is not accepted at
 * all rather than accepted and validated.
 */
router.use(requireAuth, requirePermission("org.audit.read"));

const handle = (fn) => (req, res, next) => {
  fn(req, res, next).catch((err) => {
    console.error("audit log route failed:", err);
    res.status(500).json({ status: "error", message: "something went wrong" });
  });
};

/**
 * How many rows one page returns.
 *
 * Capped rather than trusted: an audit log is the one collection that grows
 * without bound, and `?limit=100000` on it is a cheap way to tie up the
 * database. 50 fills a screen; 200 is enough for a wide export.
 */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function readLimit(raw) {
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

/** A date query param, or null when absent or unparseable. */
function readDate(raw) {
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Escapes a user's search text so a stray `(` or `*` can't break the regex. */
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const toRow = (row) => ({
  id: String(row._id),
  action: row.action,
  status: row.status,
  actor: {
    userId: row.actorUserId ? String(row.actorUserId) : null,
    name: row.actorName,
    email: row.actorEmail,
  },
  targetType: row.targetType,
  targetId: row.targetId,
  message: row.message,
  metadata: row.metadata ?? {},
  ip: row.ip,
  userAgent: row.userAgent,
  createdAt: row.createdAt,
});

/**
 * Builds the Mongo filter from the query string.
 *
 * Every branch is additive on top of the session's own `tenantId`, so no
 * combination of params can widen the query past this organization.
 */
function buildFilter(req) {
  const filter = { tenantId: req.dbUser.tenantId };
  const { action, status, actorUserId, targetType, q, from, to, before } = req.query;

  // Repeatable: ?action=a&action=b arrives as an array, which is how the
  // page's multi-select sends a group of actions.
  if (action) {
    const actions = (Array.isArray(action) ? action : [action]).filter((value) =>
      AUDIT_ACTIONS.includes(value)
    );
    if (actions.length) filter.action = { $in: actions };
  }

  if (status === "success" || status === "failure") filter.status = status;

  if (actorUserId && mongoose.Types.ObjectId.isValid(actorUserId)) {
    filter.actorUserId = new mongoose.Types.ObjectId(actorUserId);
  }

  if (targetType && TARGET_TYPES.includes(targetType)) filter.targetType = targetType;

  if (q && String(q).trim()) {
    const needle = new RegExp(escapeRegex(String(q).trim()), "i");
    // The three fields someone actually searches by: what happened, and who
    // did it. Deliberately not `metadata` — it is an unindexed free-form bag
    // whose shape varies per action, and scanning it would make the common
    // case slow to serve the rare one.
    filter.$or = [{ message: needle }, { actorName: needle }, { actorEmail: needle }];
  }

  const fromDate = readDate(from);
  const toDate = readDate(to);
  const beforeDate = readDate(before);

  // `before` is the pagination cursor and `from`/`to` are the user's date
  // filter; all three constrain createdAt, so they merge into one clause
  // rather than overwriting each other.
  const createdAt = {};
  if (fromDate) createdAt.$gte = fromDate;
  if (toDate) createdAt.$lte = toDate;
  if (beforeDate) createdAt.$lt = beforeDate;
  if (Object.keys(createdAt).length) filter.createdAt = createdAt;

  return filter;
}

/**
 * One page of this organization's audit trail, newest first.
 *
 * Paginated by cursor (`?before=<ISO date>`) rather than by skip: the log is
 * append-only and read newest-first, so a skip-based page 20 would both scan
 * every row before it and shift under the reader as new rows land on top.
 */
router.get(
  "/",
  handle(async (req, res) => {
    const limit = readLimit(req.query.limit);
    const filter = buildFilter(req);

    // One extra row, purely to answer "is there another page?" without a
    // second count query over a collection that only grows.
    const rows = await AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .lean();

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    res.json({
      status: "success",
      entries: page.map(toRow),
      hasMore,
      // What to pass back as `?before=` for the next page.
      nextCursor: hasMore ? page[page.length - 1].createdAt : null,
    });
  })
);

/**
 * The filter dropdowns' contents.
 *
 * `actions` is only the ones this organization has actually produced, not the
 * full catalogue: a dropdown of forty actions where thirty-five can never
 * match anything here is worse than a short, true one.
 */
router.get(
  "/facets",
  handle(async (req, res) => {
    const { tenantId } = req.dbUser;

    const [actions, members] = await Promise.all([
      AuditLog.distinct("action", { tenantId }),
      // The actors to choose from — every member, including ones who have
      // done nothing yet, so the list doesn't change shape as people act.
      User.find({ tenantId, deletedAt: null }).select("name email").sort({ name: 1 }).lean(),
    ]);

    res.json({
      status: "success",
      actions: actions.sort(),
      targetTypes: TARGET_TYPES,
      actors: members.map((member) => ({
        id: String(member._id),
        name: member.name || member.email,
        email: member.email,
      })),
    });
  })
);

module.exports = router;
