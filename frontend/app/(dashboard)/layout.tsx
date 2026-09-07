"use client";

import type { ReactNode } from "react";
import { MotionConfig } from "framer-motion";
import { useAuth } from "@/lib/auth-context";
import { TopNav } from "@/components/TopNav";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  // The proxy guarantees a signed-in user before this ever renders, so this is
  // only the brief gap while a signed-out visitor is being sent to /login.
  // Rendering nothing keeps them from seeing a half-built dashboard.
  if (!user) return null;

  return (
    // Framer animates via rAF, so the reduced-motion CSS in globals.css can't
    // reach it — this is what honours the OS setting for every motion element.
    <MotionConfig reducedMotion="user">
      <div className="flex flex-col min-h-screen bg-void">
        <TopNav />
        {/* Clears the fixed TopNav, which sits outside the flow — must track its height. */}
        <main className="flex-1 flex flex-col min-h-screen pt-14 md:pt-16">{children}</main>
      </div>
    </MotionConfig>
  );
}
