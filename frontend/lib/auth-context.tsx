"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { io } from "socket.io-client";
import { getCurrentUser, logout as apiLogout, BACKEND_URL, type ApiUser } from "./api";

const LOGIN_PATH = "/login";

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

  // Lets the backend end this session in real time — an admin revoking access,
  // or a sign-out elsewhere — without waiting for the next page load.
  useEffect(() => {
    if (!user) return;

    const socket = io(BACKEND_URL, { withCredentials: true });

    socket.on("connect", () => setLiveConnected(true));
    socket.on("disconnect", () => setLiveConnected(false));
    socket.on("auth:revoked", () => {
      setUser(null);
      router.replace(LOGIN_PATH);
    });

    return () => {
      socket.disconnect();
    };
  }, [user, router]);

  async function logout() {
    setLoggingOut(true);
    try {
      await apiLogout();
    } finally {
      setUser(null);
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
