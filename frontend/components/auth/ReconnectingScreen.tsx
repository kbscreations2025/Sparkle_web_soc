"use client";

import { RefreshCw, WifiOff } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

/**
 * Shown in place of the app while it can't reach the server to confirm who's
 * signed in: a slow or dropped connection, or a server waking up. It says so
 * plainly, and that nothing is lost. The app keeps retrying on its own and
 * carries on the moment it gets through. Before this, the same moment sent
 * people to the login page.
 */
export function ReconnectingScreen() {
  const { retrySession } = useAuth();

  return (
    <main className="flex min-h-screen flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
      <WifiOff size={28} className="text-gold/80" aria-hidden />

      <div className="space-y-2" role="status">
        <h1 className="text-lg font-semibold text-cream">Can&rsquo;t reach Sparkle right now</h1>
        <p className="mx-auto max-w-sm text-[13px] leading-relaxed text-muted">
          Nothing is lost. Sparkle keeps retrying and carries on as soon as it can connect.
        </p>
      </div>

      <button
        type="button"
        onClick={retrySession}
        className="flex items-center gap-2 rounded-lg border border-gold/30 bg-gold/10 px-4 py-2 text-[13px] font-medium text-gold transition-colors hover:bg-gold/15"
      >
        <RefreshCw size={14} />
        Try again
      </button>
    </main>
  );
}
