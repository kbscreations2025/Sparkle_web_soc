import type { ApiUser } from "./api";

/**
 * Mirror of the backend's grant matching in `backend/src/permissions.js` — the
 * grammar has to agree in both places, so change them together.
 *
 * This decides what the UI *shows*. It is not a security boundary: every route
 * returning real data re-checks server-side, because anything shipped to the
 * browser can be edited there.
 */
function grantMatches(grant: string, required: string): boolean {
  const grantParts = grant.split(".");
  const requiredParts = required.split(".");
  if (grantParts.length !== requiredParts.length) return false;
  return grantParts.every((part, i) => part === "*" || part === requiredParts[i]);
}

export function can(user: ApiUser | null, required: string | undefined): boolean {
  if (!required) return true; // an item with no permission is open to everyone
  if (!user) return false;
  if (user.isSuperAdmin) return true;
  /*
   * The same blanket bypass the backend applies (`hasPermission` in
   * permissions.js). Without it the mirror this file promises was broken:
   * a platform admin with no explicit grant was refused the Credits link in
   * the menu while the page itself rendered fine, because one call site had
   * been patched with `|| user.isPlatformAdmin` and the other had not.
   *
   * One bypass here means no call site has to remember that prefix.
   */
  if (user.isPlatformAdmin) return true;
  return (user.permissions ?? []).some((grant) => grantMatches(grant, required));
}
