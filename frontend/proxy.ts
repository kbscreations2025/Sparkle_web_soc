import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { ApiUser } from "@/lib/api";
import { USER_HEADER, encodeUser } from "@/lib/session-header";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";
const LOGIN_PATH = "/login";

type SessionCheck = {
  user: ApiUser | null;
  /** Set-Cookie lines from the backend, e.g. an access token it just refreshed. */
  setCookies: string[];
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
    if (!res.ok) return { user: null, setCookies };

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
  const isLoginPage = request.nextUrl.pathname === LOGIN_PATH;
  const hasSessionCookies = Boolean(
    request.cookies.get("access_token") || request.cookies.get("refresh_token")
  );

  // Someone who was never logged in needs no backend round-trip to be shown the
  // login page, and can't be allowed anywhere else.
  if (!hasSessionCookies) {
    return isLoginPage ? allow(request, null) : redirectTo(LOGIN_PATH, request);
  }

  const { user, setCookies } = await checkSession(request);

  if (isLoginPage) {
    return withCookies(user ? redirectTo("/", request) : allow(request, null), setCookies);
  }
  return withCookies(user ? allow(request, user) : redirectTo(LOGIN_PATH, request), setCookies);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|mp4|webp)$).*)"],
};
