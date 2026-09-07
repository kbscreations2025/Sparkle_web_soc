// Authorization primitives. `role` is never an input here — it is a display
// label only, and reading it in a decision would silently reintroduce the
// role-based model that `permissions` replaces.

// Grants are dot-separated, with `*` standing in for exactly one segment:
// "tool.*.run" grants "tool.cleaning.run" but not "tool.cleaning.run.batch".
function grantMatches(grant, required) {
  const grantParts = grant.split(".");
  const requiredParts = required.split(".");
  if (grantParts.length !== requiredParts.length) return false;
  return grantParts.every((part, i) => part === "*" || part === requiredParts[i]);
}

function hasPermission(user, required) {
  if (!user || user.status !== "active") return false;
  if (user.isPlatformAdmin) return true; // platform staff bypass; never true for a customer
  return (user.permissions || []).some((grant) => grantMatches(grant, required));
}

function hasAnyPermission(user, requiredList) {
  return requiredList.some((required) => hasPermission(user, required));
}

// Which users' results this user may read, as a Mongo filter fragment scoped to
// their own tenant. `permissions` decides *whether* they can read other people's
// results at all; `dataScope` decides how far that reach goes.
function resultReadFilter(user, { toolKey } = {}) {
  if (!hasPermission(user, "result.read.own")) return null;

  const filter = { tenantId: user.tenantId };
  const scope = user.dataScope || { kind: "own" };
  const reachesOthers = hasPermission(user, "result.read.others");

  if (!reachesOthers || scope.kind === "own") {
    filter.userId = user._id;
    return filter;
  }

  if (scope.kind === "selected") {
    // Always include themselves: "selected" widens own access, never narrows it.
    filter.userId = { $in: [user._id, ...(scope.userIds || [])] };
  }
  // kind === "organization" adds no userId clause — the whole tenant is in reach.

  // Omitted limiters mean "no limit", so only apply the ones actually set.
  if (scope.toolKeys?.length) {
    if (toolKey && !scope.toolKeys.includes(toolKey)) return null;
    filter.toolKey = { $in: scope.toolKeys };
  }
  if (scope.notBefore) filter.createdAt = { $gte: scope.notBefore };

  return filter;
}

function canExport(user) {
  const scope = user.dataScope || {};
  // Exporting only your own data needs no scope grant; exporting anyone else's does.
  if (!hasPermission(user, "result.read.others") || scope.kind === "own") return true;
  return scope.canExport === true;
}

module.exports = { grantMatches, hasPermission, hasAnyPermission, resultReadFilter, canExport };
