import type { ApiUser } from "./api";

/** The super-admin console. Everything under it is super-admin only. */
export const ADMIN_ROOT = "/admin";
export const DASHBOARD_ROOT = "/";
export const LOGIN_PATH = "/login";

/**
 * Which of the two shells a signed-in person belongs in. Decided in one place
 * so the proxy and the client can't disagree and bounce someone between them.
 */
export function homeFor(user: ApiUser): string {
  return user.isSuperAdmin ? ADMIN_ROOT : DASHBOARD_ROOT;
}

/**
 * A shared Live Lookbook (`/l/<slug>`): the one page anyone may open without
 * signing in. Exactly one segment under /l, nothing more, so this can't be
 * stretched to cover another route.
 */
export function isPublicPath(pathname: string): boolean {
  return /^\/l\/[^/]+\/?$/.test(pathname);
}

export function isAdminPath(pathname: string): boolean {
  return pathname === ADMIN_ROOT || pathname.startsWith(`${ADMIN_ROOT}/`);
}

/** True when this person is in the wrong shell and should be sent home. */
export function isWrongShell(user: ApiUser, pathname: string): boolean {
  return isAdminPath(pathname) !== Boolean(user.isSuperAdmin);
}
