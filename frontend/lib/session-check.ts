import type { ApiUser } from "./api";

/**
 * What asking the backend "who is this?" (`GET /api/auth/me`) came back with,
 * read the same way by the proxy and by the browser.
 *
 * `unreachable` is its own answer, not a kind of signed-out. It means the
 * backend, or the central login it checks with, couldn't be reached or
 * didn't answer in time. Only `signed_out` may send someone to the login
 * page. Treating the two alike is what logged people out whenever the
 * network or a server was slow.
 */
export type SessionCheck =
  | { kind: "user"; user: ApiUser }
  | { kind: "signed_out"; deniedCode?: string }
  | { kind: "unreachable" };

/** How long a session check may take before it counts as unreachable. */
export const SESSION_CHECK_TIMEOUT_MS = 10_000;

/** Reads a `/api/auth/me` response. Only a 401 or a 403 is the backend saying no. */
export async function readSessionResponse(res: Response): Promise<SessionCheck> {
  if (res.status === 401) return { kind: "signed_out" };

  if (res.status === 403) {
    // Signed in but not let in: not provisioned, suspended. The code lets
    // the login page say why.
    const body = await res.json().catch(() => null);
    return { kind: "signed_out", deniedCode: typeof body?.code === "string" ? body.code : undefined };
  }

  // A 503 (the backend couldn't reach the central login), a 5xx from a
  // server that's down or waking up, a proxy's error page: none is an answer.
  if (!res.ok) return { kind: "unreachable" };

  const body = await res.json().catch(() => null);
  return body?.status === "success" && body.user ? { kind: "user", user: body.user } : { kind: "unreachable" };
}

/**
 * An abort signal that fires after `ms`. Uses `AbortSignal.timeout` where it
 * exists. Older Safari lacks it, and a check that threw there would read as
 * unreachable on every try.
 */
export function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}
