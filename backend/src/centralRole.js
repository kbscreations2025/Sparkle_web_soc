const config = require("./config");

const SUPER_ADMIN = "super_admin";

// The central login is consulted for exactly ONE thing: is this person a super
// admin? That decides whether they get the admin console or the dashboard.
// Their role label and every permission inside this app come from our own
// database, never from here.
//
// Central answers two different questions with the same field name:
//   - top-level `role`            — their role in the central console itself
//   - permissioned_applications[] — their role per application
// Those genuinely disagree: a "Team Mate" at the top level can hold super_admin
// on one app. So when an entry for THIS app exists, it is the only thing
// allowed to speak for this app.
function isCentralSuperAdmin(centralUser) {
  const apps = centralUser?.permissioned_applications;

  if (config.centralAppCode && Array.isArray(apps) && apps.length > 0) {
    const entry = apps.find((app) => app.code === config.centralAppCode);
    // No entry for this app means no role in this app — never its super admin.
    return entry?.role === SUPER_ADMIN;
  }

  // verify-otp returns permissioned_applications as [], so right after login
  // the top-level role is the only signal available.
  return centralUser?.role === SUPER_ADMIN;
}

module.exports = { isCentralSuperAdmin, SUPER_ADMIN };
