require("dotenv").config();
const mongoose = require("mongoose");
const { connectDb } = require("../db");
const User = require("../models/user");
const Tenant = require("../models/tenant");
const CreditAccount = require("../models/creditAccount");
const credit = require("../services/credits");

/**
 * Gives every active user an opening balance.
 *
 * This exists because charging is enforced from the moment it ships: a run
 * is refused when the user cannot pay for it, and nobody has an account yet.
 * Without this script the first deploy stops every generation in the app
 * until a super admin grants credits to each person by hand.
 *
 *   node src/scripts/seedCredits.js --dry-run          # show who would get what
 *   node src/scripts/seedCredits.js                    # 5000 credits each
 *   node src/scripts/seedCredits.js --amount 20000     # a different opening balance
 *   node src/scripts/seedCredits.js --tenant <slug>    # one organization only
 *   node src/scripts/seedCredits.js --top-up           # also grant to accounts that already have some
 *
 * Idempotent by default: a user who already holds credits is skipped, so
 * re-running after adding people tops up only the new ones. `--top-up`
 * overrides that and grants to everyone matched.
 *
 * For scale: 5000 credits is $50 of provider spend at the seeded markup —
 * roughly 200 flash images, or six 8-second Veo Standard clips.
 */

const DEFAULT_AMOUNT = 5000;

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const topUp = process.argv.includes("--top-up");
  const amount = Number(arg("amount", DEFAULT_AMOUNT));
  const slug = arg("tenant");

  if (!Number.isInteger(amount) || amount <= 0) {
    console.error("  --amount must be a whole number of credits above zero\n");
    process.exitCode = 1;
    return;
  }

  await connectDb();

  const tenantFilter = { deletedAt: null };
  if (slug) {
    const tenant = await Tenant.findOne({ slug, deletedAt: null }).select("_id name");
    if (!tenant) {
      console.error(`  no organization with slug "${slug}"\n`);
      process.exitCode = 1;
      return;
    }
    tenantFilter._id = tenant._id;
  }

  const tenants = await Tenant.find(tenantFilter).select("_id name slug").sort({ name: 1 });
  const users = await User.find({
    tenantId: { $in: tenants.map((t) => t._id) },
    deletedAt: null,
    status: "active",
  })
    .select("_id name email tenantId")
    .exec();

  const existing = await CreditAccount.find({ userId: { $in: users.map((u) => u._id) } }).exec();
  const balances = new Map(existing.map((account) => [String(account.userId), account.balance]));

  const targets = users.filter((user) => topUp || (balances.get(String(user._id)) ?? 0) === 0);

  console.log(
    `\n  ${targets.length} of ${users.length} active user(s) across ${tenants.length} organization(s) · ${amount} credits each\n`
  );

  const names = new Map(tenants.map((t) => [String(t._id), t.name]));
  for (const user of targets) {
    console.log(
      `  ${(names.get(String(user.tenantId)) || "—").padEnd(28)} ${(user.name || user.email).padEnd(34)} ` +
        `${String(balances.get(String(user._id)) ?? 0).padStart(8)} → ${amount + (balances.get(String(user._id)) ?? 0)}`
    );
  }
  console.log("");

  if (dryRun) {
    console.log("  --dry-run: nothing written.\n");
    return;
  }

  let granted = 0;
  for (const user of targets) {
    await credit.grant({
      tenantId: user.tenantId,
      userId: user._id,
      amount,
      actorUserId: null,
      actorName: "seedCredits",
      reason: "opening balance",
    });
    granted += 1;
  }

  console.log(`  granted ${granted} account(s)\n`);
  if (!topUp && targets.length < users.length) {
    console.log(`  ${users.length - targets.length} already had credits — re-run with --top-up to grant those too.\n`);
  }
}

main()
  .catch((err) => {
    console.error("seedCredits failed:", err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.connection.close());
