const express = require("express");
const { requireAuth, requirePermission, requireSuperAdmin } = require("../middleware/auth");
const { hasPermission } = require("../permissions");
const { handle, bad, isId } = require("./_shared");
const { logAudit, requestMeta, actorFrom } = require("../auditLog");
const credit = require("../services/credits");
const CreditAccount = require("../models/creditAccount");
const CreditLedger = require("../models/creditLedger");
const Tenant = require("../models/tenant");
const User = require("../models/user");

const router = express.Router();

router.use(requireAuth);

/** A whole, positive number of credits, and not an absurd one. */
function parseAmount(value) {
  const amount = Number(value);
  if (!Number.isInteger(amount) || amount <= 0 || amount > 100_000_000) return null;
  return amount;
}

const toAccount = (account, holder) => ({
  id: account._id,
  userId: account.userId,
  holder,
  balance: account.balance,
  reserved: account.reserved,
  available: account.available,
  lifetimeGranted: account.lifetimeGranted,
  lifetimeSpent: account.lifetimeSpent,
  updatedAt: account.updatedAt,
});

const toEntry = (entry) => ({
  id: entry._id,
  kind: entry.kind,
  amount: entry.amount,
  held: entry.held,
  tool: entry.tool,
  modelId: entry.modelId,
  quality: entry.quality,
  unit: entry.unit,
  unitPrice: entry.unitPrice,
  units: entry.units,
  jobId: entry.jobId,
  actorName: entry.actorName,
  reason: entry.reason,
  createdAt: entry.createdAt,
});

// ── what the signed-in person has ──────────────────────────────────────────

/**
 * This user's own balance. No permission needed beyond being signed in: a
 * person is always allowed to know what they can spend, and refusing a run
 * for want of credits is only fair if the figure is visible.
 */
router.get(
  "/me",
  handle(async (req, res) => {
    /*
     * A read, and only a read. This used to call `ensure`, which is an
     * upsert — and the balance badge in the top bar polls this on every page
     * view and every tab focus, so reading your balance was writing to the
     * accounts collection. Nothing here needs the row to exist: no account
     * means no credits, which is what an empty balance says.
     */
    const account = await CreditAccount.findOne({ tenantId: req.dbUser.tenantId, userId: req.dbUser._id })
      .select("balance reserved available")
      .lean();

    res.json({
      status: "success",
      credits: {
        balance: account?.balance ?? 0,
        reserved: account?.reserved ?? 0,
        available: account?.available ?? 0,
      },
    });
  })
);

// ── the admin of one organization ──────────────────────────────────────────


/**
 * The signed-in admin's own organization: its pool, and what each member
 * holds.
 *
 * Deliberately has no organization id in it. An admin sees their own
 * organization and no other, and the surest way to guarantee that is to give
 * them no way to name a different one — a route taking an id would need a
 * check that someone will eventually forget.
 */
router.get(
  "/my",
  requirePermission("org.credits.read"),
  handle(async (req, res) => {
    const tenantId = req.dbUser.tenantId;
    if (!tenantId) return bad(res, "you are not a member of an organization");

    const [tenant, users, accounts] = await Promise.all([
      Tenant.findOne({ _id: tenantId, deletedAt: null }).select("name slug status"),
      User.find({ tenantId, deletedAt: null }).select("name email status role").sort({ name: 1 }).exec(),
      CreditAccount.find({ tenantId }).exec(),
    ]);
    if (!tenant) return res.status(404).json({ status: "error", message: "not found", code: "not_found" });

    const byUser = new Map(accounts.filter((a) => a.userId).map((a) => [String(a.userId), a]));
    const pool = accounts.find((a) => a.userId === null);

    res.json({
      status: "success",
      tenant: { id: tenant._id, name: tenant.name, slug: tenant.slug, status: tenant.status },
      pool: pool
        ? toAccount(pool, "Organization pool")
        : { id: null, holder: "Organization pool", balance: 0, reserved: 0, available: 0 },
      canManage: Boolean(req.isSuperAdmin || hasPermission(req.dbUser, "org.credits.manage")),
      /*
       * The reader's own row leads the list, then everyone else by name.
       *
       * Sorted here rather than in the browser because the server is the
       * only side that knows who is asking — and their own balance is the
       * one they look for first, so alphabetical order buries it somewhere
       * in the middle of a long roster.
       */
      members: users
        .map((user) => {
          const account = byUser.get(String(user._id));
          return {
            userId: user._id,
            name: user.name || user.email,
            email: user.email,
            status: user.status,
            role: user.role,
            /** Lets the row be labelled, so its position reads as deliberate. */
            isSelf: String(user._id) === String(req.dbUser._id),
            balance: account?.balance ?? 0,
            reserved: account?.reserved ?? 0,
            available: account?.available ?? 0,
            lifetimeSpent: account?.lifetimeSpent ?? 0,
          };
        })
        .sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || a.name.localeCompare(b.name)),
    });
  })
);

/**
 * Shares out the organization's own credits, pool → member.
 *
 * The organization is taken from the signed-in admin, never from the body:
 * a tenant id in the request would be a way to move another organization's
 * credits by editing one field.
 */
router.post(
  "/distribute",
  requirePermission("org.credits.manage"),
  handle(async (req, res) => {
    const { userId, amount: rawAmount, reason } = req.body || {};
    const tenantId = req.dbUser.tenantId;

    if (!tenantId) return bad(res, "you are not a member of an organization");
    if (!isId(userId)) return bad(res, "a valid member is required");

    const amount = parseAmount(rawAmount);
    if (amount === null) return bad(res, "amount must be a whole number of credits above zero");

    const member = await User.findOne({ _id: userId, tenantId, deletedAt: null }).select("_id name email");
    if (!member) return bad(res, "that user is not a member of your organization");

    try {
      const { source, target } = await credit.transfer({
        tenantId,
        fromUserId: null,
        toUserId: userId,
        amount,
        actorUserId: req.dbUser._id,
        actorName: req.dbUser.name || req.dbUser.email,
        reason: reason?.trim() || null,
      });

      logAudit({
        ...actorFrom(req),
        ...requestMeta(req),
        tenantId,
        action: "credits.distributed",
        status: "success",
        targetType: "credit_account",
        targetId: String(target._id),
        message: `shared out ${amount} credits to ${member.name || member.email}`,
        metadata: { amount, userId: String(userId) },
      });

      res.json({ status: "success", pool: toAccount(source, "Organization pool"), member: toAccount(target, "User") });
    } catch (err) {
      if (err.code === "insufficient_credits") {
        return res.status(400).json({
          status: "error",
          message: `The organization pool has only ${err.available} credits available.`,
          code: "insufficient_credits",
        });
      }
      throw err;
    }
  })
);

/** Pulls a member's unspent credits back into the pool. */
router.post(
  "/reclaim",
  requirePermission("org.credits.manage"),
  handle(async (req, res) => {
    const { userId, amount: rawAmount, reason } = req.body || {};
    const tenantId = req.dbUser.tenantId;

    if (!tenantId) return bad(res, "you are not a member of an organization");
    if (!isId(userId)) return bad(res, "a valid member is required");

    const amount = parseAmount(rawAmount);
    if (amount === null) return bad(res, "amount must be a whole number of credits above zero");

    try {
      const { source, target } = await credit.transfer({
        tenantId,
        fromUserId: userId,
        toUserId: null,
        amount,
        actorUserId: req.dbUser._id,
        actorName: req.dbUser.name || req.dbUser.email,
        reason: reason?.trim() || null,
      });

      logAudit({
        ...actorFrom(req),
        ...requestMeta(req),
        tenantId,
        action: "credits.reclaimed",
        status: "success",
        targetType: "credit_account",
        targetId: String(source._id),
        message: `took back ${amount} credits`,
        metadata: { amount, userId: String(userId) },
      });

      res.json({ status: "success", pool: toAccount(target, "Organization pool"), member: toAccount(source, "User") });
    } catch (err) {
      if (err.code === "insufficient_credits") {
        return res.status(400).json({
          status: "error",
          // Names the reason, because "not enough" is confusing when the
          // balance on screen looks sufficient — the difference is frozen.
          message: `Only ${err.available} of their credits are unspent — the rest is frozen by runs in progress.`,
          code: "insufficient_credits",
        });
      }
      throw err;
    }
  })
);

// ── platform staff ─────────────────────────────────────────────────────────

/*
 * Everything below is cross-tenant, and issuing credit from nothing is the
 * one act that must stay with whoever carries the cost — so it is the
 * central super admin only, the same gate that guards creating
 * organizations. Deliberately NOT isPlatformAdmin: that flag is a bypass on
 * a member's own row, and letting it through here once showed one
 * customer's admin the balances of every other customer.
 */
router.use(requireSuperAdmin);

/**
 * Every organization with its pool balance and its members' accounts.
 *
 * One query per collection rather than per organization: this page lists
 * every tenant, and a lookup inside the loop would be a query per row.
 */
router.get(
  "/tenants",
  handle(async (req, res) => {
    const tenants = await Tenant.find({ deletedAt: null }).select("name slug status").sort({ name: 1 }).exec();
    const tenantIds = tenants.map((t) => t._id);

    const [totals, peopleRows] = await Promise.all([
      /*
       * Summed in the database, not over the wire. Fetching every account
       * document to `reduce` them in JS made this page's payload scale with
       * the total number of users on the platform, when it should scale with
       * the number of organizations.
       */
      credit.totalsByTenant(tenantIds),
      /*
       * People, not accounts.
       *
       * Counting credit-account rows here reported one member for an
       * organization with three, because an account is only created the
       * first time someone's balance is touched — so the column counted who
       * had been granted credits rather than who was in the organization,
       * which is precisely backwards for a page whose job is to show who
       * still needs some.
       */
      User.aggregate([
        { $match: { tenantId: { $in: tenantIds }, deletedAt: null } },
        { $group: { _id: "$tenantId", count: { $sum: 1 } } },
      ]),
    ]);

    const peopleByTenant = new Map(peopleRows.map((row) => [String(row._id), row.count]));

    res.json({
      status: "success",
      tenants: tenants.map((tenant) => {
        const sums = totals.get(String(tenant._id));

        return {
          id: tenant._id,
          name: tenant.name,
          slug: tenant.slug,
          status: tenant.status,
          pool: sums ? { id: null, holder: "Organization pool", balance: sums.pool, reserved: 0, available: 0 } : null,
          // What the organization holds in total: its pool plus every
          // member's own balance. The figure a super admin actually wants.
          totalBalance: sums?.balance ?? 0,
          totalReserved: sums?.reserved ?? 0,
          memberCount: peopleByTenant.get(String(tenant._id)) ?? 0,
        };
      }),
    });
  })
);

/** One organization: its pool, and an account line per member. */
router.get(
  "/tenants/:id",
  handle(async (req, res) => {
    if (!isId(req.params.id)) return bad(res, "invalid organization id");

    // All three key off the id in the path, so none has to wait for another —
    // the sibling /my handler already does it this way.
    const tenantId = req.params.id;
    const [tenant, users, accounts] = await Promise.all([
      Tenant.findOne({ _id: tenantId, deletedAt: null }).select("name slug status"),
      User.find({ tenantId, deletedAt: null }).select("name email status role").sort({ name: 1 }).exec(),
      CreditAccount.find({ tenantId }).exec(),
    ]);
    if (!tenant) return res.status(404).json({ status: "error", message: "not found", code: "not_found" });

    const byUser = new Map(accounts.filter((a) => a.userId).map((a) => [String(a.userId), a]));
    const pool = accounts.find((a) => a.userId === null);

    res.json({
      status: "success",
      tenant: { id: tenant._id, name: tenant.name, slug: tenant.slug, status: tenant.status },
      pool: pool
        ? toAccount(pool, "Organization pool")
        : { id: null, holder: "Organization pool", balance: 0, reserved: 0, available: 0 },
      // Every member is listed, with or without an account — a person who
      // has never been granted anything is exactly who a super admin is
      // looking for on this page, and leaving them out would hide them.
      members: users.map((user) => {
        const account = byUser.get(String(user._id));
        return {
          userId: user._id,
          name: user.name || user.email,
          email: user.email,
          status: user.status,
          role: user.role,
          balance: account?.balance ?? 0,
          reserved: account?.reserved ?? 0,
          available: account?.available ?? 0,
          lifetimeSpent: account?.lifetimeSpent ?? 0,
        };
      }),
    });
  })
);

/** An organization's statement, everyone in it. */
router.get(
  "/tenants/:id/ledger",
  handle(async (req, res) => {
    if (!isId(req.params.id)) return bad(res, "invalid organization id");
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));

    const entries = await CreditLedger.find({ tenantId: req.params.id })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("userId", "name email")
      .exec();

    res.json({
      status: "success",
      entries: entries.map((entry) => ({
        ...toEntry(entry),
        holder: entry.userId ? entry.userId.name || entry.userId.email : "Organization pool",
      })),
    });
  })
);

/**
 * Puts credits into an organization's pool, or straight into one person's
 * account.
 *
 * `userId` omitted means the pool. Granting directly to a person is the
 * path that matters right now: a run is charged to the user who asked for
 * it and nothing falls back to the pool, so a user with an empty account
 * cannot generate until someone grants to them specifically.
 */
router.post(
  "/grant",
  handle(async (req, res) => {
    const { tenantId, userId = null, amount: rawAmount, reason } = req.body || {};

    if (!isId(tenantId)) return bad(res, "a valid organization id is required");
    if (userId !== null && !isId(userId)) return bad(res, "invalid user id");

    const amount = parseAmount(rawAmount);
    if (amount === null) return bad(res, "amount must be a whole number of credits above zero");

    const tenant = await Tenant.findOne({ _id: tenantId, deletedAt: null }).select("_id name");
    if (!tenant) return res.status(404).json({ status: "error", message: "organization not found", code: "not_found" });

    // Checked rather than trusted: a user id from another organization would
    // otherwise create an account under the wrong tenant, and the holder
    // would be invisible on both organizations' pages.
    if (userId) {
      const member = await User.findOne({ _id: userId, tenantId, deletedAt: null }).select("_id name email");
      if (!member) return bad(res, "that user is not a member of this organization");
    }

    const account = await credit.grant({
      tenantId,
      userId,
      amount,
      actorUserId: req.dbUser?._id ?? null,
      actorName: req.appUser?.name || req.appUser?.email || "platform staff",
      reason: reason?.trim() || null,
    });

    logAudit({
      ...actorFrom(req),
      ...requestMeta(req),
      tenantId,
      action: "credits.granted",
      status: "success",
      targetType: "credit_account",
      targetId: String(account._id),
      message: `granted ${amount} credits to ${userId ? "a user" : "the organization pool"} in ${tenant.name}`,
      metadata: { amount, userId: userId ? String(userId) : null, reason: reason?.trim() || null },
    });

    res.json({ status: "success", account: toAccount(account, userId ? "User" : "Organization pool") });
  })
);

/**
 * Takes credits back.
 *
 * Capped at what is spendable — credits frozen by a job already running are
 * spoken for, and pulling them out would leave that job unable to settle.
 */
router.post(
  "/revoke",
  handle(async (req, res) => {
    const { tenantId, userId = null, amount: rawAmount, reason } = req.body || {};

    if (!isId(tenantId)) return bad(res, "a valid organization id is required");
    if (userId !== null && !isId(userId)) return bad(res, "invalid user id");

    const amount = parseAmount(rawAmount);
    if (amount === null) return bad(res, "amount must be a whole number of credits above zero");

    try {
      const account = await credit.revoke({
        tenantId,
        userId,
        amount,
        actorUserId: req.dbUser?._id ?? null,
        actorName: req.appUser?.name || req.appUser?.email || "platform staff",
        reason: reason?.trim() || null,
      });

      logAudit({
        ...actorFrom(req),
        ...requestMeta(req),
        tenantId,
        action: "credits.revoked",
        status: "success",
        targetType: "credit_account",
        targetId: String(account._id),
        message: `revoked ${amount} credits`,
        metadata: { amount, userId: userId ? String(userId) : null, reason: reason?.trim() || null },
      });

      res.json({ status: "success", account: toAccount(account, userId ? "User" : "Organization pool") });
    } catch (err) {
      if (err.code === "insufficient_credits") {
        return res.status(400).json({
          status: "error",
          message: `Only ${err.available} credits are available to take back — the rest is frozen by runs in progress.`,
          code: "insufficient_credits",
        });
      }
      throw err;
    }
  })
);

module.exports = router;
