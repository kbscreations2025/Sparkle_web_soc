"use client";

import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";
import { usePreloadRoutes } from "@/lib/usePreloadRoutes";
import { CreditGuardProvider } from "@/lib/credit-guard";
import { JobsProvider } from "@/lib/jobs-context";
import { PageToolbarProvider } from "@/lib/page-toolbar-context";
import { AppShell } from "@/components/AppShell";
import { TopNav } from "@/components/TopNav";
import { SideNav } from "@/components/nav/SideNav";
import { QueueRail } from "@/components/studio/QueueRail";
import { JobToasts } from "@/components/studio/JobToasts";
import { ReconnectingScreen } from "@/components/auth/ReconnectingScreen";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { user, sessionUnreachable } = useAuth();
  // Every tool page loaded in the background, so switching between them is instant.
  usePreloadRoutes();

  // Normally the proxy guarantees a signed-in user before this renders, so no
  // user means one of two short gaps. Either a signed-out visitor is being
  // sent to /login (render nothing, rather than a half-built dashboard), or
  // the server couldn't be reached to check the session. In that case, say so
  // while the app retries.
  if (!user) return sessionUnreachable ? <ReconnectingScreen /> : null;

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
      <CreditGuardProvider>
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
      </CreditGuardProvider>
    </JobsProvider>
  );
}
