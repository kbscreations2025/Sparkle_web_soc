"use client";

import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/AppShell";
import { TopNav } from "@/components/TopNav";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  // The proxy guarantees a signed-in user before this ever renders, so this is
  // only the brief gap while a signed-out visitor is being sent to /login.
  // Rendering nothing keeps them from seeing a half-built dashboard.
  if (!user) return null;

  return <AppShell nav={<TopNav />}>{children}</AppShell>;
}
