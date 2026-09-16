"use client";

import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";
import { JobsProvider } from "@/lib/jobs-context";
import { PageToolbarProvider } from "@/lib/page-toolbar-context";
import { AppShell } from "@/components/AppShell";
import { TopNav } from "@/components/TopNav";
import { SideNav } from "@/components/nav/SideNav";
import { QueueRail } from "@/components/studio/QueueRail";
import { JobToasts } from "@/components/studio/JobToasts";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  // The proxy guarantees a signed-in user before this ever renders, so this is
  // only the brief gap while a signed-out visitor is being sent to /login.
  // Rendering nothing keeps them from seeing a half-built dashboard.
  if (!user) return null;

  // Wraps the whole dashboard, not one tool: a generation queued on Image
  // Cleaning stays visible after navigating to another tool, and the queue
  // rail needs the same list on every page.
  //
  // The rail sits beside every page rather than inside any of them, so work
  // that outlives the page that started it stays visible wherever the user
  // goes next.
  //
  // Navigation on the left, the page in the middle, work in flight on the
  // right — the two edges are fixtures of the shell and only the middle
  // column changes as you move around.
  return (
    <JobsProvider>
      <PageToolbarProvider>
        <AppShell nav={<TopNav />} sidebar={<SideNav />}>
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
            <QueueRail />
          </div>
          {/* Announces finished work over whatever page is open — the rail is
              easy to miss, and hidden entirely on a phone. */}
          <JobToasts />
        </AppShell>
      </PageToolbarProvider>
    </JobsProvider>
  );
}
