"use client";

import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/AppShell";
import { AdminNav } from "@/components/admin/AdminNav";

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  const { user } = useAuth();

  // The proxy already sent every non-super-admin to the dashboard, so this is
  // only the brief gap before that redirect lands. Rendering nothing keeps the
  // console off screen for anyone who doesn't belong in it.
  if (!user?.isSuperAdmin) return null;

  return <AppShell nav={<AdminNav />}>{children}</AppShell>;
}
