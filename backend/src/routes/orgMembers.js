const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { hasPermission } = require("../permissions");
const { GRANT_GROUPS, ALL_GRANTS, unknownGrants } = require("../grants");
const { handle, bad, isId, toMember, validateScope } = require("./_shared");
const { liveSessionCounts, forceLogout } = require("../socket");
const { logAudit, requestMeta, actorFrom } = require("../auditLog");
const User = require("../models/user");
const { balancesByUser } = require("../services/credits");

/**
 * An organization admin managing their own colleagues.
 *
 * Deliberately a separate file from routes/admin.js rather than a relaxed
 * gate inside it. That console is cross-tenant by design and its routes take
 * an organization id; this one has no organization in it at all, because an
 * admin acts only inside their own and the surest way to guarantee that is
 * to give them no way to name another.
 *
 * ── the two rules that make this safe ──────────────────────────────────
 * An admin can widen what their team can do, but never what they
 * themselves can do:
 *
 *   1. They cannot edit their own row. Without this, the grant is simply
 *      "give yourself everything", one click at a time.
 *   2. They cannot give away a permission they do not hold. Without this,
 *      an admin with no video access could grant it to a colleague — which
 *      is the same privilege reaching the organization by a longer route,
 *      and makes the admin's own permission list meaningless as a limit.
 *
 * Both are enforced here, server-side, and not merely hidden in the UI.
 */
const router = express.Router();

router.use(requireAuth);

router.use(requirePermission("org.members.manage"));


/**
 * The admin's own colleagues, with the grant catalogue and — crucially —
 * which grants this admin is allowed to hand out.
 *
 * `assignableGrants` is sent so the editor can show the rest as unavailable
 * rather than offering a checkbox whose save will be refused. The server
 * still re-checks every write; this only saves the user a dead end.
 */
router.get(
  "/",
  handle(async (req, res) => {
    const tenantId = req.dbUser.tenantId;
    if (!tenantId) return bad(res, "you are not a member of an organization");

    // Independent of each other — one round trip rather than two.
    const [members, balances] = await Promise.all([
      User.find({ tenantId, deletedAt: null }).sort({ role: 1, email: 1 }),
      balancesByUser(tenantId),
    ]);
    const live = liveSessionCounts(members.map((m) => m.authUserId));

    res.json({
      status: "success",
      groups: GRANT_GROUPS,
      assignableGrants: req.isSuperAdmin
        ? ALL_GRANTS
        : ALL_GRANTS.filter((grant) => hasPermission(req.dbUser, grant)),
      selfId: String(req.dbUser._id),
      members: members
        .map((m) => toMember(m, live[m.authUserId] ?? 0, balances.get(String(m._id)) ?? null))
        // The reader's own row first, as everywhere else this list appears.
        .sort((a, b) => {
          const selfA = String(a.id) === String(req.dbUser._id);
          const selfB = String(b.id) === String(req.dbUser._id);
          return Number(selfB) - Number(selfA) || (a.name || a.email).localeCompare(b.name || b.email);
        }),
    });
  })
);

/**
 * Changes one colleague's permissions, scope, role or status.
 *
 * Everything an admin may not do is refused here with a reason, rather than
 * silently ignored — a checkbox that appears to save and then reverts on
 * reload is worse than a clear refusal.
 */
router.patch(
  "/:id",
  handle(async (req, res) => {
    const { id } = req.params;
    if (!isId(id)) return bad(res, "invalid member id");

    const tenantId = req.dbUser.tenantId;
    const member = await User.findOne({ _id: id, tenantId, deletedAt: null });
    if (!member) {
      // The same answer for "no such person" and "not in your organization":
      // an admin has no business learning that an id exists elsewhere.
      return res.status(404).json({ status: "error", message: "member not found", code: "not_found" });
    }

    const isSelf = String(member._id) === String(req.dbUser._id);
    if (isSelf && !req.isSuperAdmin) {
      return res.status(403).json({
        status: "error",
        message: "You cannot change your own permissions. Ask a platform admin.",
        code: "forbidden_self",
      });
    }

    const { role, status, permissions, dataScope } = req.body || {};

    if (permissions !== undefined) {
      if (!Array.isArray(permissions)) return bad(res, "permissions must be an array");

      const unknown = unknownGrants(permissions);
      if (unknown.length) return bad(res, `unknown permission(s): ${unknown.join(", ")}`);

      /*
       * Only what this admin holds. Compared against the grants being ADDED,
       * not the whole list: a permission the member already has and the
       * admin does not must still survive an unrelated edit, or saving one
       * checkbox would quietly strip it.
       */
      if (!req.isSuperAdmin) {
        const added = permissions.filter((grant) => !member.permissions.includes(grant));
        const beyond = added.filter((grant) => !hasPermission(req.dbUser, grant));
        if (beyond.length) {
          return res.status(403).json({
            status: "error",
            message: `You can only give permissions you hold yourself. Not yours to give: ${beyond.join(", ")}`,
            code: "forbidden_escalation",
          });
        }
      }
    }

    if (status !== undefined && !User.USER_STATUSES.includes(status)) {
      return bad(res, `status must be one of: ${User.USER_STATUSES.join(", ")}`);
    }

    /*
     * Widening someone's reach over other people's results is itself a
     * privilege, and `dataScope` is not a grant the check above can see —
     * so it is gated on the admin holding the permission that scope exists
     * to qualify.
     */
    if (dataScope !== undefined && !req.isSuperAdmin && !hasPermission(req.dbUser, "result.read.others")) {
      return res.status(403).json({
        status: "error",
        message: "You cannot change what results someone can see, because you do not have that access yourself.",
        code: "forbidden_escalation",
      });
    }

    /*
     * The shared validator, not a hand-rolled copy. The copy that used to
     * live here checked the kind and the member ids but knew nothing about
     * `toolKeys`, `notBefore` or `canExport` — so saving a member through
     * this route silently dropped their tool limiter, and resultReadFilter
     * reads a missing limiter as no limit at all.
     */
    const scope = await validateScope(dataScope, tenantId);
    if (scope.error) return bad(res, scope.error);
    const scopeValue = scope.value;

    const before = {
      role: member.role,
      status: member.status,
      permissions: [...member.permissions],
      dataScope: member.dataScope,
    };

    if (role !== undefined) member.role = role;
    if (status !== undefined) member.status = status;

    /*
     * The derived grants are the model's job, not this route's — the
     * normalizePermissions hook adds the baseline, syncs
     * `result.read.others` to the data scope, and strips organization-wide
     * grants from a "user" role. Recomputed on every save, so a request
     * that changes only the role still lands consistent.
     */
    if (permissions !== undefined || scopeValue) {
      member.applyGrants({
        ...(permissions !== undefined && { permissions }),
        ...(scopeValue && { dataScope: scopeValue }),
        grantedByUserId: req.dbUser._id,
      });
    }

    await member.save();

    logAudit({
      ...actorFrom(req),
      ...requestMeta(req),
      tenantId,
      action: "member.updated",
      status: "success",
      targetType: "user",
      targetId: String(member._id),
      message: `updated colleague ${member.email}`,
      metadata: {
        byOrgAdmin: true,
        before,
        after: {
          role: member.role,
          status: member.status,
          permissions: member.permissions,
          dataScope: member.dataScope,
        },
      },
    });

    // Suspending someone has to reach the tabs they already have open —
    // the central login still considers them signed in.
    if (status !== undefined && status !== "active" && member.authUserId) {
      forceLogout(member.authUserId);
    }

    res.json({ status: "success", member: toMember(member) });
  })
);

module.exports = router;
