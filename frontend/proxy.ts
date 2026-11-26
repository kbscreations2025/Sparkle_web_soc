import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { ApiUser } from "@/lib/api";
import { SESSION_STATE_HEADER, USER_HEADER, encodeUser } from "@/lib/session-header";
import { SESSION_CHECK_TIMEOUT_MS, readSessionResponse, timeoutSignal, type SessionCheck } from "@/lib/session-check";
import { LOGIN_PATH, homeFor, isPublicPath, isWrongShell } from "@/lib/shell";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";

/** Plus any Set-Cookie lines from the backend, e.g. an access token it just refreshed. */
type ProxySessionCheck = SessionCheck & { setCookies: string[] };

/**
 * Verifies against the backend rather than just checking that a cookie exists.
 * Nothing else on the server re-checks the session (the pages are all client
 * components talking to a separate API), so an optimistic check would let a
 * stale cookie through to the browser and only fail once the page was already
 * on screen — the flash this whole layer exists to prevent.
 *
 * Bounded, so a backend that's asleep or unreachable can't hold the page
 * hostage: past the timeout the check counts as unreachable, the page goes
 * through, and the browser keeps trying.
 */
async function checkSession(request: NextRequest): Promise<ProxySessionCheck> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/auth/me`, {
      headers: { cookie: request.headers.get("cookie") ?? "" },
      signal: timeoutSignal(SESSION_CHECK_TIMEOUT_MS),
    });
    const setCookies = res.headers.getSetCookie();
    return { ...(await readSessionResponse(res)), setCookies };
  } catch {
    return { kind: "unreachable", setCookies: [] };
  }
}

function withCookies(response: NextResponse, setCookies: string[]) {
  setCookies.forEach((cookie) => response.headers.append("set-cookie", cookie));
  return response;
}

/**
 * Lets the page render, carrying the verified user through to the root layout
 * — or, when the session couldn't be checked, word that it couldn't.
 */
function allow(request: NextRequest, user: ApiUser | null, { unreachable = false } = {}) {
  const headers = new Headers(request.headers);
  if (user) headers.set(USER_HEADER, encodeUser(user));
  else headers.delete(USER_HEADER);
  if (unreachable) headers.set(SESSION_STATE_HEADER, "unreachable");
  else headers.delete(SESSION_STATE_HEADER);
  return NextResponse.next({ request: { headers } });
}

function redirectTo(path: string, request: NextRequest) {
  return NextResponse.redirect(new URL(path, request.url));
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // A shared Live Lookbook is for anyone with the link, signed in or not, and
  // a signed-in visitor isn't sent off to their own shell either. No session
  // check: the page never uses one. `allow` with no user also strips any
  // user header the request arrived with, so none can be smuggled through.
  if (isPublicPath(pathname)) return allow(request, null);

  const isLoginPage = pathname === LOGIN_PATH;
  const hasSessionCookies = Boolean(
    request.cookies.get("access_token") || request.cookies.get("refresh_token")
  );

  // Someone who was never logged in needs no backend round-trip to be shown the
  // login page, and can't be allowed anywhere else.
  if (!hasSessionCookies) {
    return isLoginPage ? allow(request, null) : redirectTo(LOGIN_PATH, request);
  }

  const check = await checkSession(request);

  // Couldn't find out: the backend or the central login is slow, asleep or
  // unreachable. That's no reason to sign anyone out. Sending people to the
  // login page here is what made a slow connection look like a logout. The
  // page goes through without a user, and the app retries from the browser,
  // showing that it's reconnecting, until the backend answers.
  if (check.kind === "unreachable") {
    return withCookies(allow(request, null, { unreachable: true }), check.setCookies);
  }

  if (check.kind === "signed_out") {
    // Carry the reason so the form can say why, rather than silently
    // re-presenting itself to someone whose credentials are perfectly valid.
    const target = check.deniedCode ? `${LOGIN_PATH}?denied=${check.deniedCode}` : LOGIN_PATH;
    return withCookies(isLoginPage ? allow(request, null) : redirectTo(target, request), check.setCookies);
  }

  const { user, setCookies } = check;

  // Signed in: send them to their own shell if they're anywhere else. A central
  // super_admin gets the console, everyone else the dashboard.
  if (isLoginPage || isWrongShell(user, pathname)) {
    return withCookies(redirectTo(homeFor(user), request), setCookies);
  }

  return withCookies(allow(request, user), setCookies);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|mp4|webp)$).*)"],
};
