"use client";

import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";
import { SidebarProvider, useSidebar } from "@/lib/sidebar-context";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";
import { cn } from "@/lib/utils";

function DashboardShell({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { open } = useSidebar();

  // The proxy guarantees a signed-in user before this ever renders, so this is
  // only the brief gap while a signed-out visitor is being sent to /login.
  // Rendering nothing keeps them from seeing a half-built dashboard.
  if (!user) return null;

  return (
    <div className="flex min-h-screen bg-void">
      <Sidebar />
      <main
        className={cn(
          "flex-1 flex flex-col min-h-screen transition-[margin] duration-[250ms] ease-[cubic-bezier(0.22,1,0.36,1)]",
          open ? "ml-[232px]" : "ml-[64px]"
        )}
      >
        {children}
      </main>
      <TopBar />
    </div>
  );
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <DashboardShell>{children}</DashboardShell>
    </SidebarProvider>
  );
}
