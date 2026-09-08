const { isCentralSuperAdmin } = require("./centralRole");
const User = require("./models/user");

// The only user shape the frontend ever sees. Identity comes from the central
// login; `role` and `permissions` come from our database. Central's own role
// and permissions are dropped here on purpose — passed through, a
// "super_admin" in the central console or an unrelated grant like
// "invoice:read" would start deciding what this app renders.
function toSessionUser({ central, dbUser, isSuperAdmin, profile = {} }) {
  return {
    user_id: central.user_id,
    // verify-token carries no name or email, so those fall back to our row
    // and then to the profile cookie written at login.
    name: dbUser?.name || central.name || profile.name,
    email: dbUser?.email || central.email || profile.email,
    isSuperAdmin,
    // A super admin not yet provisioned into any organization still needs a label.
    role: dbUser?.role || (isSuperAdmin ? "super_admin" : "user"),
    permissions: dbUser?.permissions || [],
    permissionVersion: dbUser?.permissionVersion || 0,
    tenantId: dbUser?.tenantId || null,
  };
}

// A refusal is invisible from the outside — the person just sees the login form
// again — so record who was turned away and why. Without this, "why can't I get
// in" is pure guesswork.
function deny(code, message, central) {
  console.warn(`auth denied [${code}] ${central?.email || central?.user_id || "unknown"}: ${message}`);
  return { denied: { code, message } };
}

/**
 * Turns a verified central identity into this app's view of them, or an
 * explanation of why they may not come in. Passing the central check proves
 * only who someone is — never that this application knows them.
 *
 * Returns `{ user, dbUser, isSuperAdmin }` or `{ denied: { code, message } }`.
 */
async function resolveAppUser(central, profile) {
  const isSuperAdmin = isCentralSuperAdmin(central);
  let dbUser = null;

  try {
    dbUser = await User.linkOnLogin({
      authUserId: central.user_id,
      email: central.email || profile?.email,
      name: central.name || profile?.name,
    });
  } catch (err) {
    if (err.code !== "AMBIGUOUS_TENANT") throw err;
    return deny(
      "ambiguous_tenant",
      "Your account belongs to more than one organization. Ask an admin to resolve it.",
      central
    );
  }

  const resolved = {
    user: toSessionUser({ central, dbUser, isSuperAdmin, profile }),
    dbUser,
    isSuperAdmin,
  };

  // A super admin creates the organizations and provisions everyone, so they
  // get in before being provisioned themselves — otherwise the very first
  // super admin could never set anything up.
  if (isSuperAdmin) return resolved;

  if (!dbUser) {
    return deny(
      "not_provisioned",
      "You don't have access to this application yet. Ask an admin to add you.",
      central
    );
  }
  if (dbUser.status !== "active") {
    return deny("account_inactive", `Your account is ${dbUser.status}.`, central);
  }

  return resolved;
}

module.exports = { resolveAppUser, toSessionUser };
