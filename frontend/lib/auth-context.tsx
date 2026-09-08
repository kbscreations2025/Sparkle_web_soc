"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { io } from "socket.io-client";
import { getCurrentUser, logout as apiLogout, clearLocalSession, BACKEND_URL, type ApiUser } from "./api";
import { LOGIN_PATH } from "./shell";

type AuthContextValue = {
  user: ApiUser | null;
  liveConnected: boolean;
  loggingOut: boolean;
  setUser: (user: ApiUser) => void;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  liveConnected: false,
  loggingOut: false,
  setUser: () => {},
  logout: async () => {},
});

export function AuthProvider({
  initialUser,
  children,
}: {
  initialUser: ApiUser | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<ApiUser | null>(initialUser);
  const [liveConnected, setLiveConnected] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  // Normally the user is already here: the proxy passes it in with the HTML, and
  // signing in seeds it from the login response. This only covers the gap where
  // neither did — a client-side navigation into the app from a signed-out page.
  useEffect(() => {
    if (user || loggingOut || pathname === LOGIN_PATH) return;

    let cancelled = false;
    getCurrentUser()
      .then((result) => {
        if (cancelled) return;
        if (result.status === "success" && result.user) setUser(result.user);
        else router.replace(LOGIN_PATH);
      })
      .catch(() => {
        if (!cancelled) router.replace(LOGIN_PATH);
      });

    return () => {
      cancelled = true;
    };
  }, [user, loggingOut, pathname, router]);

  // Keyed on the id, not the object: every /me response is a fresh object, and
  // depending on it would drop and re-dial the socket for the same person.
  const userId = user?.user_id;

  // Lets the backend end this session in real time — an admin revoking access,
  // or a sign-out elsewhere — without waiting for the next page load.
  useEffect(() => {
    if (!userId) return;

    const socket = io(BACKEND_URL, { withCredentials: true });

    socket.on("connect", () => setLiveConnected(true));
    socket.on("disconnect", () => setLiveConnected(false));
    socket.on("auth:revoked", () => {
      setUser(null);
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
    });

    return () => {
      socket.disconnect();
    };
  }, [userId, router]);

  async function logout() {
    setLoggingOut(true);
    try {
      await apiLogout();
    } finally {
      setUser(null);
      // Must be cleared: the recovery effect above is gated on it, so leaving
      // it true would disable the "no user → re-fetch me" fallback for the
      // rest of this tab's life.
      setLoggingOut(false);
      router.replace(LOGIN_PATH);
    }
  }

  return (
    <AuthContext.Provider value={{ user, liveConnected, loggingOut, setUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
