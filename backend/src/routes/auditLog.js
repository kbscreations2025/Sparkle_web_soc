const express = require("express");
const mongoose = require("mongoose");
const { requireAuth, requirePermission } = require("../middleware/auth");
const AuditLog = require("../models/auditLog");
const Tenant = require("../models/tenant");
const User = require("../models/user");

const { AUDIT_ACTIONS, TARGET_TYPES } = AuditLog;

const router = express.Router();

/*
 * An organization's own audit trail, for whoever in it holds
 * `org.audit.read` — and, for a central super admin, every organization's.
 *
 * The scoping rule for this whole file: for a tenant user, `tenantId` comes
 * from the session and never from the request. A client-supplied tenant
 * filter is the one way this route could leak another company's history, so
 * from them it is not accepted at all rather than accepted and validated.
 *
 * A central super admin is the deliberate exception, and the only caller that
 * may pass `?tenantId=`: they administer every organization, the console they
 * work in already reads across all of them, and an audit log that could not
 * answer "what happened across the platform" would send them to the database
 * instead. Their exemption is `req.isSuperAdmin`, set by requireAuth from the
 * central login — never anything the browser sends.
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

/**
 * One row as the table shows it.
 *
 * Deliberately without `metadata` and `userAgent`. They are the two widest
 * fields and neither is on screen until a row is expanded — a single
 * `member.updated` row carries two full permission arrays and a dataScope,
 * which is heavier than ten ordinary rows, and fifty of them made the list
 * response mostly payload nobody was looking at. `hasDetail` is all the table
 * needs to know; the rest arrives from `/:id` when someone actually asks.
 */
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
  ip: row.ip,
  createdAt: row.createdAt,
  hasDetail: Object.keys(row.metadata ?? {}).length > 0 || Boolean(row.userAgent),
});

/**
 * The tenant clause, which is the only part of the filter a caller cannot
 * widen. A super admin gets every organization, narrowed to one only if they
 * asked; everyone else gets theirs and no way to say otherwise.
 */
function tenantScope(req) {
  if (!req.isSuperAdmin) return { tenantId: req.dbUser.tenantId };

  const { tenantId } = req.query;
  if (!tenantId) return {};

  // Repeatable, like the other filters: one organization or several.
  const ids = (Array.isArray(tenantId) ? tenantId : [tenantId])
    .filter((value) => mongoose.Types.ObjectId.isValid(value))
    .map((value) => new mongoose.Types.ObjectId(value));

  return ids.length ? { tenantId: { $in: ids } } : {};
}

/**
 * Builds the Mongo filter from the query string.
 *
 * Every branch is additive on top of `tenantScope`, so no combination of
 * params can widen the query past what that allows.
 */
function buildFilter(req) {
  const filter = tenantScope(req);
  const { action, status, actorUserId, targetType, q, from, to, before } = req.query;

  // Repeatable: ?action=a&action=b arrives as an array, which is how the
  // page's multi-select sends a group of actions.
  if (action) {
    const actions = (Array.isArray(action) ? action : [action]).filter((value) =>
      AUDIT_ACTIONS.includes(value)
    );
    if (actions.length) filter.action = { $in: actions };
  }

  if (status) {
    const values = (Array.isArray(status) ? status : [status]).filter(
      (value) => value === "success" || value === "failure"
    );
    if (values.length) filter.status = { $in: values };
  }

  // Repeatable like `action`, for the same reason: "what did these two do"
  // is one question, and asking it twice and merging by hand is not an answer.
  if (actorUserId) {
    const ids = (Array.isArray(actorUserId) ? actorUserId : [actorUserId])
      .filter((value) => mongoose.Types.ObjectId.isValid(value))
      .map((value) => new mongoose.Types.ObjectId(value));
    if (ids.length) filter.actorUserId = { $in: ids };
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

    /*
     * Which organization each row belongs to, but only for the reader who can
     * see more than one — for everyone else every row is their own and the
     * column would say the same thing all the way down.
     *
     * Named here rather than by populating the query: one lookup for the
     * handful of organizations on this page beats a join per row.
     */
    let tenantNames = null;
    if (req.isSuperAdmin) {
      // Dropped before stringifying, not after: a row with no tenant — a
      // failed login belongs to nobody yet — would otherwise become the
      // string "null", which is truthy and is not an id.
      const ids = [...new Set(page.filter((row) => row.tenantId).map((row) => String(row.tenantId)))];
      const tenants = await Tenant.find({ _id: { $in: ids } }).select("name").lean();
      tenantNames = new Map(tenants.map((tenant) => [String(tenant._id), tenant.name]));
    }

    res.json({
      status: "success",
      entries: page.map((row) => ({
        ...toRow(row),
        tenant: tenantNames ? tenantNames.get(String(row.tenantId)) ?? "—" : undefined,
      })),
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
    // The same scope the rows use, so the dropdowns can never offer a filter
    // that returns nothing because it was never in range to begin with.
    const scope = tenantScope(req);
    const memberScope = req.isSuperAdmin ? {} : { tenantId: req.dbUser.tenantId };

    const [actions, members, tenants] = await Promise.all([
      AuditLog.distinct("action", scope),
      // The actors to choose from — every member, including ones who have
      // done nothing yet, so the list doesn't change shape as people act.
      User.find({ ...memberScope, deletedAt: null }).select("name email").sort({ name: 1 }).lean(),
      // Only a super admin can filter by organization, so only they are told
      // which ones exist.
      req.isSuperAdmin ? Tenant.find({}).select("name").sort({ name: 1 }).lean() : null,
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
      tenants: tenants
        ? tenants.map((tenant) => ({ id: String(tenant._id), name: tenant.name }))
        : undefined,
    });
  })
);

/**
 * The two heavy fields for one row, fetched when it is expanded.
 *
 * Scoped exactly like the list is — the same `tenantScope` clause, not a bare
 * lookup by id — so a row id guessed or kept from elsewhere still cannot be
 * read across organizations.
 */
router.get(
  "/:id",
  handle(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ status: "error", message: "invalid id" });
    }

    const row = await AuditLog.findOne({ _id: req.params.id, ...tenantScope(req) })
      .select("metadata userAgent")
      .lean();

    if (!row) return res.status(404).json({ status: "error", message: "not found" });

    res.json({
      status: "success",
      metadata: row.metadata ?? {},
      userAgent: row.userAgent ?? null,
    });
  })
);

module.exports = router;
