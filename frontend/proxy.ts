import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { ApiUser } from "@/lib/api";
import { USER_HEADER, encodeUser } from "@/lib/session-header";
import { LOGIN_PATH, homeFor, isWrongShell } from "@/lib/shell";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";

type SessionCheck = {
  user: ApiUser | null;
  /** Set-Cookie lines from the backend, e.g. an access token it just refreshed. */
  setCookies: string[];
  /**
   * Why the backend refused, when it did. A 403 means authenticated but not
   * allowed in — not provisioned, suspended — which is worth telling them,
   * since otherwise they log in successfully and land back on the form.
   */
  deniedCode?: string;
};

/**
 * Verifies against the backend rather than just checking that a cookie exists.
 * Nothing else on the server re-checks the session (the pages are all client
 * components talking to a separate API), so an optimistic check would let a
 * stale cookie through to the browser and only fail once the page was already
 * on screen — the flash this whole layer exists to prevent.
 */
async function checkSession(request: NextRequest): Promise<SessionCheck> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/auth/me`, {
      headers: { cookie: request.headers.get("cookie") ?? "" },
    });
    const setCookies = res.headers.getSetCookie();

    if (!res.ok) {
      const denied = res.status === 403 ? await res.json().catch(() => null) : null;
      return { user: null, setCookies, deniedCode: denied?.code };
    }

    const data = await res.json();
    return { user: data.status === "success" ? data.user : null, setCookies };
  } catch {
    return { user: null, setCookies: [] };
  }
}

function withCookies(response: NextResponse, setCookies: string[]) {
  setCookies.forEach((cookie) => response.headers.append("set-cookie", cookie));
  return response;
}

/** Lets the page render, carrying the verified user through to the root layout. */
function allow(request: NextRequest, user: ApiUser | null) {
  const headers = new Headers(request.headers);
  if (user) headers.set(USER_HEADER, encodeUser(user));
  else headers.delete(USER_HEADER);
  return NextResponse.next({ request: { headers } });
}

function redirectTo(path: string, request: NextRequest) {
  return NextResponse.redirect(new URL(path, request.url));
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isLoginPage = pathname === LOGIN_PATH;
  const hasSessionCookies = Boolean(
    request.cookies.get("access_token") || request.cookies.get("refresh_token")
  );

  // Someone who was never logged in needs no backend round-trip to be shown the
  // login page, and can't be allowed anywhere else.
  if (!hasSessionCookies) {
    return isLoginPage ? allow(request, null) : redirectTo(LOGIN_PATH, request);
  }

  const { user, setCookies, deniedCode } = await checkSession(request);

  if (!user) {
    // Carry the reason so the form can say why, rather than silently
    // re-presenting itself to someone whose credentials are perfectly valid.
    const target = deniedCode ? `${LOGIN_PATH}?denied=${deniedCode}` : LOGIN_PATH;
    return withCookies(isLoginPage ? allow(request, null) : redirectTo(target, request), setCookies);
  }

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
