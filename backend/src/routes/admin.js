const express = require("express");
const mongoose = require("mongoose");
const config = require("../config");
const loginApi = require("../loginApi");
const { requireAuth, requireSuperAdmin } = require("../middleware/auth");
const { liveSessionCounts, forceLogout } = require("../socket");
const { GRANT_GROUPS, TOOL_KEYS, unknownGrants } = require("../grants");
const Tenant = require("../models/tenant");
const User = require("../models/user");
const { SCOPE_KINDS } = User;

const router = express.Router();

// Every route here is super-admin only. Applied once at the top so no route
// added later can accidentally be left open.
router.use(requireAuth, requireSuperAdmin);

/** Wraps an async handler so a rejection becomes a 500 instead of a hung request. */
const handle = (fn) => (req, res, next) => {
  fn(req, res, next).catch((err) => {
    // 11000 is Mongo's duplicate-key error: a slug or an email already taken.
    if (err.code === 11000) {
      return res.status(409).json({ status: "error", message: "that already exists", code: "duplicate" });
    }
    if (err.name === "ValidationError") {
      return res.status(400).json({ status: "error", message: err.message, code: "invalid" });
    }
    console.error("admin route failed:", err);
    res.status(500).json({ status: "error", message: "something went wrong" });
  });
};

const bad = (res, message) => res.status(400).json({ status: "error", message, code: "invalid" });
const notFound = (res, what) => res.status(404).json({ status: "error", message: `${what} not found` });
const isId = (value) => mongoose.Types.ObjectId.isValid(value);

/**
 * Loads the organization named in the path and hangs it on `req.tenant`, for
 * every route nested under it — so no handler below repeats the id check, the
 * lookup and the 404. Handlers mutate `req.tenant` and save it rather than
 * issuing a second query of their own.
 */
router.use(
  "/organizations/:id",
  handle(async (req, res, next) => {
    const { id } = req.params;
    if (!isId(id)) return bad(res, "invalid organization id");

    req.tenant = await Tenant.findOne({ _id: id, deletedAt: null });
    if (!req.tenant) return notFound(res, "organization");
    next();
  })
);

/** Shapes an organization for the console — never leaks provider credentials. */
const toOrg = (tenant, { memberCount = 0, adminCount = 0 } = {}) => ({
  id: tenant._id,
  name: tenant.name,
  slug: tenant.slug,
  status: tenant.status,
  aiProviderCount: tenant.aiProviders?.length ?? 0,
  // The table shows both: total people, and how many carry the admin label.
  memberCount,
  adminCount,
  createdAt: tenant.createdAt,
});

const toMember = (user, liveSessions = 0) => ({
  id: user._id,
  authUserId: user.authUserId,
  name: user.name,
  email: user.email,
  role: user.role,
  status: user.status,
  permissions: user.permissions,
  dataScope: user.dataScope,
  permissionVersion: user.permissionVersion,
  // Tells the admin whether this person has ever actually signed in.
  linked: Boolean(user.authUserId),
  lastLoginAt: user.lastLoginAt,
  /** Open connections right now — 0 means they aren't using the app. */
  liveSessions,
});

/** Counts members and admins per tenant in one pass, rather than a query each. */
async function countsByTenant() {
  const rows = await User.aggregate([
    { $match: { deletedAt: null } },
    {
      $group: {
        _id: "$tenantId",
        memberCount: { $sum: 1 },
        adminCount: { $sum: { $cond: [{ $eq: ["$role", "admin"] }, 1, 0] } },
      },
    },
  ]);
  return new Map(rows.map((row) => [String(row._id), row]));
}

// ── catalogue ────────────────────────────────────────────────────────────────
// The console renders whatever this returns, so the grant list has exactly one
// definition and the UI can never offer a permission the backend rejects.
router.get(
  "/grants",
  handle(async (req, res) => {
    res.json({
      status: "success",
      groups: GRANT_GROUPS,
      scopeKinds: SCOPE_KINDS,
      // Served rather than duplicated in the console, so adding a provider
      // here is enough to make it selectable there.
      providers: Tenant.PROVIDERS,
    });
  })
);

// ── app users ───────────────────────────────────────────────────────────────
/**
 * Everyone the central login has registered against this application,
 * fetched with the service's own client id/secret rather than a caller's
 * bearer token — so it is never gated on that admin's own central role, and
 * always reflects the full list central holds for this app.
 *
 * This is both the read-only directory the console shows, and the only pool a
 * super admin can pick from when adding someone to an organization — each
 * entry is annotated with where (if anywhere) we already know them, so the
 * console can show who is still unassigned. There is deliberately no route to
 * create a user here; people are provisioned in the central login itself.
 */
router.get(
  "/app-users",
  handle(async (req, res) => {
    let centralUsers;
    try {
      centralUsers = await loginApi.listAppUsersByClient();
    } catch (err) {
      const status = err.response?.status;
      const detail = err.response?.data?.detail;
      console.warn(`app users unavailable [${status}]: ${detail}`);
      return res.status(502).json({
        status: "error",
        message: detail || "could not reach the central login",
        code: "central_unavailable",
      });
    }

    // Match on both keys: authUserId once someone has signed in, email before that.
    const known = await User.find({ deletedAt: null })
      .select("authUserId email tenantId role status")
      .populate("tenantId", "name slug")
      .lean();

    const byAuthId = new Map(known.filter((row) => row.authUserId).map((row) => [row.authUserId, row]));
    const byEmail = new Map(known.map((row) => [row.email, row]));

    const users = (Array.isArray(centralUsers) ? centralUsers : []).map((person) => {
      const match = byAuthId.get(person.user_id) || byEmail.get(String(person.email).toLowerCase());
      return {
        user_id: person.user_id,
        name: person.name,
        email: person.email,
        status: person.status,
        // Central's own role label. Shown for reference only — it grants nothing here.
        role: person.role,
        grantedAt: person.granted_at,
        organization: match?.tenantId
          ? { id: match.tenantId._id, name: match.tenantId.name, slug: match.tenantId.slug }
          : null,
        memberId: match?._id ?? null,
      };
    });

    res.json({ status: "success", users });
  })
);

// ── organizations ───────────────────────────────────────────────────────────
router.get(
  "/organizations",
  handle(async (req, res) => {
    const [tenants, counts] = await Promise.all([
      Tenant.find({ deletedAt: null }).sort({ name: 1 }),
      countsByTenant(),
    ]);

    res.json({
      status: "success",
      organizations: tenants.map((tenant) => toOrg(tenant, counts.get(String(tenant._id)))),
    });
  })
);

router.post(
  "/organizations",
  handle(async (req, res) => {
    const { name, slug } = req.body || {};
    if (!name?.trim()) return bad(res, "name is required");

    // Derived from the name when not given, since the slug is immutable and
    // most admins shouldn't have to think about it.
    const derived = (slug || name)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!derived) return bad(res, "could not build a URL-safe slug from that name");

    const tenant = await Tenant.create({ name: name.trim(), slug: derived });
    res.status(201).json({ status: "success", organization: toOrg(tenant) });
  })
);

router.patch(
  "/organizations/:id",
  handle(async (req, res) => {
    const { tenant } = req;
    const { name, status } = req.body || {};

    if (status && !Tenant.TENANT_STATUSES.includes(status)) {
      return bad(res, `status must be one of: ${Tenant.TENANT_STATUSES.join(", ")}`);
    }
    if (!name?.trim() && !status) return bad(res, "nothing to update");

    // Note: `slug` is immutable in the schema, so it is deliberately not
    // updatable here — it is baked into URLs.
    if (name?.trim()) tenant.name = name.trim();
    if (status) tenant.status = status;
    await tenant.save();

    const counts = await countsByTenant();
    res.json({ status: "success", organization: toOrg(tenant, counts.get(String(tenant._id))) });
  })
);

/**
 * Soft delete — sets deletedAt rather than dropping the document, so an
 * accidental removal is recoverable and past work keeps its owner.
 *
 * The members go with it: linkOnLogin() only filters on a member's own
 * deletedAt, so leaving them behind would let someone keep signing in to an
 * organization that no longer exists.
 */
router.delete(
  "/organizations/:id",
  handle(async (req, res) => {
    const { tenant } = req;
    const now = new Date();

    tenant.deletedAt = now;
    tenant.status = "archived";
    await tenant.save();

    const { modifiedCount } = await User.updateMany(
      { tenantId: tenant._id, deletedAt: null },
      { $set: { deletedAt: now, status: "removed" } }
    );

    res.json({ status: "success", removedMembers: modifiedCount });
  })
);

// ── members ─────────────────────────────────────────────────────────────────
router.get(
  "/organizations/:id/members",
  handle(async (req, res) => {
    const { tenant } = req;
    const members = await User.find({ tenantId: tenant._id, deletedAt: null }).sort({ role: 1, email: 1 });

    // Admins first, then everyone else — matching how the console lists them.
    const live = liveSessionCounts(members.map((m) => m.authUserId));
    const adminCount = members.filter((m) => m.role === "admin").length;

    res.json({
      status: "success",
      organization: toOrg(tenant, { memberCount: members.length, adminCount }),
      members: members.map((m) => toMember(m, live[m.authUserId] ?? 0)),
    });
  })
);

/**
 * Validates a dataScope from the console. "selected" is only meaningful with
 * ids, and those ids must be members of this same organization — otherwise a
 * scope could reach across tenants.
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

router.post(
  "/organizations/:id/members",
  handle(async (req, res) => {
    const { email, name, role, authUserId, permissions = [], dataScope } = req.body || {};
    if (!email?.trim()) return bad(res, "email is required");

    const unknown = unknownGrants(permissions);
    if (unknown.length) return bad(res, `unknown permission(s): ${unknown.join(", ")}`);

    const scope = await validateScope(dataScope, req.tenant._id);
    if (scope.error) return bad(res, scope.error);

    // Picked from the central list, so we already know the id central assigned
    // them and can link now. Typed in by hand it stays null, and linkOnLogin()
    // stamps it from their email on first sign-in.
    const member = new User({
      tenantId: req.tenant._id,
      email: email.trim().toLowerCase(),
      ...(authUserId && { authUserId }),
      ...(name?.trim() && { name: name.trim() }),
      // Defaults to "user", the least-privileged label. It is display-only;
      // `permissions` is what actually decides access.
      role: role || "user",
      status: "invited",
    });

    member.applyGrants({
      permissions,
      dataScope: scope.value ?? { kind: "own" },
      grantedByUserId: req.dbUser?._id,
    });
    await member.save();

    res.status(201).json({ status: "success", member: toMember(member) });
  })
);

router.patch(
  "/members/:id",
  handle(async (req, res) => {
    const { id } = req.params;
    if (!isId(id)) return bad(res, "invalid member id");

    const member = await User.findOne({ _id: id, deletedAt: null });
    if (!member) return notFound(res, "member");

    const { name, role, status, permissions, dataScope } = req.body || {};

    if (permissions !== undefined) {
      if (!Array.isArray(permissions)) return bad(res, "permissions must be an array");
      const unknown = unknownGrants(permissions);
      if (unknown.length) return bad(res, `unknown permission(s): ${unknown.join(", ")}`);
    }
    if (status !== undefined && !User.USER_STATUSES.includes(status)) {
      return bad(res, `status must be one of: ${User.USER_STATUSES.join(", ")}`);
    }

    const scope = await validateScope(dataScope, member.tenantId);
    if (scope.error) return bad(res, scope.error);

    if (name !== undefined) member.name = name.trim();
    if (role !== undefined) member.role = role;
    if (status !== undefined) member.status = status;

    // Routed through applyGrants so permissionVersion always moves with the
    // grants and the dataScope keeps its "who granted this" trail.
    if (permissions !== undefined || scope.value) {
      member.applyGrants({
        ...(permissions !== undefined && { permissions }),
        ...(scope.value && { dataScope: scope.value }),
        grantedByUserId: req.dbUser?._id,
      });
    }

    await member.save();

    // Suspending someone has to reach their open tabs. The socket sweep only
    // checks the central login, which still considers them signed in, so
    // without this they would keep a working page until they reloaded.
    if (status !== undefined && status !== "active" && member.authUserId) {
      forceLogout(member.authUserId);
    }

    res.json({ status: "success", member: toMember(member) });
  })
);

/**
 * Soft delete, and status "removed" alongside it so any cached session that
 * still holds this row is refused by resolveAppUser on its next request.
 */
router.delete(
  "/members/:id",
  handle(async (req, res) => {
    const { id } = req.params;
    if (!isId(id)) return bad(res, "invalid member id");

    const member = await User.findOneAndUpdate(
      { _id: id, deletedAt: null },
      { $set: { deletedAt: new Date(), status: "removed" } },
      { new: true }
    );
    if (!member) return notFound(res, "member");

    // Drop their live sockets now rather than letting them keep a working page
    // until the next revalidation sweep.
    if (member.authUserId) forceLogout(member.authUserId);

    res.json({ status: "success" });
  })
);

// ── AI provider keys ────────────────────────────────────────────────────────
/**
 * Priority decides failover order, so a non-number would poison the sort in
 * `routableProviders` and silently scramble which key gets tried first.
 */
function invalidPriority(priority) {
  if (priority === undefined) return null;
  if (!Number.isInteger(priority) || priority < 0) return "priority must be a whole number, 0 or more";
  return null;
}

/** Shapes a provider entry for the console — the credential itself never leaves the model. */
const toProvider = (entry) => ({
  id: entry._id,
  provider: entry.provider,
  label: entry.label,
  keyHint: entry.keyHint,
  orgId: entry.orgId,
  enabled: entry.enabled,
  priority: entry.priority,
  health: entry.health,
  createdAt: entry.createdAt,
});

router.get(
  "/organizations/:id/ai-providers",
  handle(async (req, res) => {
    // Sorted the way routableProviders() will try them, so the console lists
    // them in the order they actually run rather than in insertion order.
    const providers = [...req.tenant.aiProviders].sort((a, b) => a.priority - b.priority);
    res.json({ status: "success", providers: providers.map(toProvider) });
  })
);

router.post(
  "/organizations/:id/ai-providers",
  handle(async (req, res) => {
    const { tenant } = req;
    const { provider, label, apiKey, orgId, priority, enabled } = req.body || {};
    if (!Tenant.PROVIDERS.includes(provider)) {
      return bad(res, `provider must be one of: ${Tenant.PROVIDERS.join(", ")}`);
    }
    if (!label?.trim()) return bad(res, "label is required");
    if (!apiKey?.trim()) return bad(res, "apiKey is required");

    const priorityError = invalidPriority(priority);
    if (priorityError) return bad(res, priorityError);

    if (tenant.hasProviderKey(apiKey.trim())) {
      return res.status(409).json({
        status: "error",
        message: "this organization already has that key — add a different one",
        code: "duplicate_key",
      });
    }

    const entry = tenant.addProvider({
      provider,
      label: label.trim(),
      apiKey: apiKey.trim(),
      createdByUserId: req.dbUser?._id,
      priority,
      enabled,
    });
    if (orgId?.trim()) entry.orgId = orgId.trim();

    await tenant.save();
    res.status(201).json({ status: "success", provider: toProvider(entry) });
  })
);

router.patch(
  "/organizations/:id/ai-providers/:providerId",
  handle(async (req, res) => {
    const { tenant } = req;
    const { providerId } = req.params;

    const entry = tenant.aiProviders.id(providerId);
    if (!entry) return notFound(res, "provider");

    const { label, apiKey, orgId, priority, enabled } = req.body || {};

    const priorityError = invalidPriority(priority);
    if (priorityError) return bad(res, priorityError);

    // Rotating onto a key another entry already holds would create the
    // duplicate the POST path refuses, so it is refused here too.
    if (apiKey?.trim() && tenant.hasProviderKey(apiKey.trim(), { exceptId: providerId })) {
      return res.status(409).json({
        status: "error",
        message: "this organization already has that key — add a different one",
        code: "duplicate_key",
      });
    }

    if (label !== undefined) entry.label = label.trim();
    if (orgId !== undefined) entry.orgId = orgId.trim() || null;
    if (priority !== undefined) entry.priority = priority;
    if (enabled !== undefined) entry.enabled = enabled;
    // A fresh key rotates in place so routing history and health stats survive.
    if (apiKey?.trim()) tenant.replaceProviderKey(providerId, apiKey.trim());

    await tenant.save();
    res.json({ status: "success", provider: toProvider(entry) });
  })
);

router.delete(
  "/organizations/:id/ai-providers/:providerId",
  handle(async (req, res) => {
    const { tenant } = req;

    const entry = tenant.aiProviders.id(req.params.providerId);
    if (!entry) return notFound(res, "provider");

    entry.deleteOne();
    await tenant.save();
    res.json({ status: "success" });
  })
);

module.exports = router;
