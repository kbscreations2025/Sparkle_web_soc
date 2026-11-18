"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { checkCurrentUser, logout as apiLogout, clearLocalSession, type ApiUser } from "./api";
import { acquireSocket, releaseSocket } from "./socket";
import { LOGIN_PATH } from "./shell";
import { clearPageCache } from "./pageCache";

type AuthContextValue = {
  user: ApiUser | null;
  liveConnected: boolean;
  loggingOut: boolean;
  /**
   * There's no user yet because the server couldn't be reached to check, not
   * because nobody is signed in. The shells show a "reconnecting" screen
   * meanwhile instead of nothing.
   */
  sessionUnreachable: boolean;
  /** Checks the session again now, rather than at the next scheduled retry. */
  retrySession: () => void;
  setUser: (user: ApiUser) => void;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  liveConnected: false,
  loggingOut: false,
  sessionUnreachable: false,
  retrySession: () => {},
  setUser: () => {},
  logout: async () => {},
});

/** Retries of an unreachable session check start at 2s and double, up to this. */
const MAX_RETRY_MS = 15_000;

export function AuthProvider({
  initialUser,
  initialUnreachable = false,
  children,
}: {
  initialUser: ApiUser | null;
  /** The proxy couldn't reach the backend to check the session for this page. */
  initialUnreachable?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<ApiUser | null>(initialUser);
  const [liveConnected, setLiveConnected] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [sessionUnreachable, setSessionUnreachable] = useState(initialUnreachable && !initialUser);
  // Bumped by "Try again" to run the check below straight away.
  const [retryKey, setRetryKey] = useState(0);

  // Normally the user is already here: the proxy passes it in with the HTML, and
  // signing in seeds it from the login response. This covers the gaps where
  // neither did. One is a client-side navigation into the app from a
  // signed-out page. The other is a page the proxy let through because it
  // couldn't reach the backend to check.
  //
  // Only a definite "signed out" sends anyone to the login page. A check that
  // couldn't get through (offline, timed out, a server asleep or erroring) is
  // tried again. It backs off to once every 15 seconds, and retries straight
  // away when the connection or the tab comes back. Before, any failure here
  // was a trip to the login page.
  useEffect(() => {
    if (user || loggingOut || pathname === LOGIN_PATH) return;

    let cancelled = false;
    let checking = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function check() {
      if (cancelled || checking) return;
      checking = true;
      clearTimeout(timer);
      const result = await checkCurrentUser();
      checking = false;
      if (cancelled) return;

      if (result.kind === "user") {
        setSessionUnreachable(false);
        setUser(result.user);
      } else if (result.kind === "signed_out") {
        setSessionUnreachable(false);
        clearPageCache();
        router.replace(result.deniedCode ? `${LOGIN_PATH}?denied=${result.deniedCode}` : LOGIN_PATH);
      } else {
        setSessionUnreachable(true);
        attempt += 1;
        timer = setTimeout(check, Math.min(2000 * 2 ** (attempt - 1), MAX_RETRY_MS));
      }
    }

    function checkNow() {
      if (document.visibilityState === "hidden") return;
      attempt = 0;
      void check();
    }

    window.addEventListener("online", checkNow);
    document.addEventListener("visibilitychange", checkNow);
    void check();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener("online", checkNow);
      document.removeEventListener("visibilitychange", checkNow);
    };
  }, [user, loggingOut, pathname, router, retryKey]);

  // Reaching the login page means no one is signed in here (the proxy sends a
  // signed-in visitor straight on). So whatever the last person left on this
  // device goes too, including when their session simply ran out rather than
  // ending with Logout.
  useEffect(() => {
    if (pathname === LOGIN_PATH) clearPageCache();
  }, [pathname]);

  // Keyed on the id, not the object: every /me response is a fresh object, and
  // depending on it would drop and re-dial the socket for the same person.
  const userId = user?.user_id;

  // Lets the backend end this session in real time — an admin revoking access,
  // or a sign-out elsewhere — without waiting for the next page load.
  useEffect(() => {
    if (!userId) return;

    // The tab's shared connection (see lib/socket.ts), which also retries a
    // handshake turned away only because the session couldn't be checked.
    const socket = acquireSocket();

    const onConnect = () => setLiveConnected(true);
    const onDisconnect = () => setLiveConnected(false);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    // Another part of the app may have opened it first, so it can already be
    // up, with its "connect" already gone by.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing once with an external connection that may predate this effect; the events above keep it current after
    if (socket.connected) setLiveConnected(true);

    // Sent only once the central login has refused this session's refresh
    // token. A sweep that couldn't reach central sends nothing.
    const onRevoked = () => {
      setUser(null);
      clearPageCache();
      // Clearing the cookies is what actually ends it here. The access token
      // stays valid at the central login for up to 15 minutes after the
      // session was killed, so without this the proxy would verify it on the
      // way to /login and send this device straight back into the app.
      //
      // Local-only on purpose: the upstream session is already gone, and
      // calling the real logout would revoke the user's trusted devices and
      // force a fresh OTP on whichever device just displaced this one.
      clearLocalSession()
        .catch(() => {})
        .finally(() => router.replace(`${LOGIN_PATH}?denied=signed_out_elsewhere`));
    };
    socket.on("auth:revoked", onRevoked);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("auth:revoked", onRevoked);
      releaseSocket();
    };
  }, [userId, router]);

  async function logout() {
    setLoggingOut(true);
    try {
      await apiLogout();
    } finally {
      setUser(null);
      clearPageCache();
      // Must be cleared: the recovery effect above is gated on it, so leaving
      // it true would disable the "no user → re-fetch me" fallback for the
      // rest of this tab's life.
      setLoggingOut(false);
      router.replace(LOGIN_PATH);
    }
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        liveConnected,
        loggingOut,
        sessionUnreachable: !user && sessionUnreachable,
        retrySession: () => setRetryKey((key) => key + 1),
        setUser,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
