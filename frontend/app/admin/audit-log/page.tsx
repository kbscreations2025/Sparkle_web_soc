/*
 * The same audit log the dashboard has, mounted inside the console.
 *
 * A central super admin cannot leave `/admin` — the proxy sends them straight
 * back (see `isWrongShell`) — so the dashboard's own `/audit-log` is a link
 * they can never open. Rather than a second copy of an 800-line page that
 * would drift from the first, the route is re-pointed at the same component;
 * the backend widens its scope for a super admin, so the page shows every
 * organization without knowing it is doing anything different.
 */
export { default } from "@/app/(dashboard)/audit-log/page";
