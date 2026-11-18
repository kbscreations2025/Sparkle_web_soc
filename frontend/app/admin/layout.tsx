"use client";

import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/AppShell";
import { AdminNav } from "@/components/admin/AdminNav";
import { ReconnectingScreen } from "@/components/auth/ReconnectingScreen";

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  const { user, sessionUnreachable } = useAuth();

  // The server couldn't be reached to check the session: say so while the
  // app retries, rather than showing nothing.
  if (!user && sessionUnreachable) return <ReconnectingScreen />;

  // The proxy already sent every non-super-admin to the dashboard, so this is
  // only the brief gap before that redirect lands. Rendering nothing keeps the
  // console off screen for anyone who doesn't belong in it.
  if (!user?.isSuperAdmin) return null;

  return <AppShell nav={<AdminNav />}>{children}</AppShell>;
}
