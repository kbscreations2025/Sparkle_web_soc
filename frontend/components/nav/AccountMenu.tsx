"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { LogOut, Loader2, ScrollText, Sun, Moon, Users } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import { can } from "@/lib/permissions";
import { useDismissable } from "@/lib/useEscapeKey";
import { cn } from "@/lib/utils";

/**
 * The avatar and everything behind it — who you are, whether the live socket
 * is up, the theme toggle and sign out. Shared so the dashboard and the
 * console present the same control in the same place.
 */
export function AccountMenu({ avatarClassName }: { avatarClassName?: string } = {}) {
  const { user, logout, loggingOut, liveConnected } = useAuth();
  const { theme, toggle: toggleTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Closing is delayed so the cursor can cross the gap between the avatar and
  // the panel without the menu vanishing underneath it.
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function cancelClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }

  function openMenu() {
    cancelClose();
    setOpen(true);
  }

  function closeSoon() {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 180);
  }

  useEffect(() => cancelClose, []);

  const closeNow = useCallback(() => setOpen(false), []);
  useDismissable(menuRef, open, closeNow);

  return (
    <div className="relative" ref={menuRef} onMouseEnter={openMenu} onMouseLeave={closeSoon}>
      {/* Opens rather than toggles: on touch the browser fires a synthetic
          mouseenter first, so a toggle here would close what that just opened. */}
      <button
        onClick={openMenu}
        aria-haspopup="menu"
        aria-expanded={open}
        title={user?.name ?? "Account"}
        className={cn(
          "w-8 h-8 rounded-full bg-gold/10 border border-gold/15 flex items-center justify-center hover:border-gold/40 transition-colors shrink-0",
          avatarClassName
        )}
      >
        <span className="text-gold text-[11px] font-semibold">
          {user?.name?.[0]?.toUpperCase() ?? "?"}
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            // Solid rather than glass: a backdrop-filter nested inside the
            // header's own composites unreliably across browsers.
            className="absolute right-0 top-full mt-2 w-48 rounded-lg border border-white/10 bg-surface-raised shadow-lg overflow-hidden"
          >
            <div className="px-2.5 py-2">
              <p className="text-cream text-xs font-medium truncate leading-tight">{user?.name ?? "User"}</p>
              <p className="text-faint text-[10px] truncate leading-tight">{user?.email ?? ""}</p>
            </div>

            {/* Sits with the account rather than in the tool rail: it is a
                record of what everyone here has done, not a tool anyone uses
                to make something. Hidden entirely without the grant, so a
                normal member never sees a link they cannot open. */}
            {can(user, "org.audit.read") && (
              <Link
                // A super admin lives in the console and the proxy will not
                // let them out of it, so the dashboard's copy of this page is
                // a link that only bounces them back.
                href={user?.isSuperAdmin ? "/admin/audit-log" : "/audit-log"}
                role="menuitem"
                onClick={closeNow}
                className="flex items-center gap-2 border-t border-white/5 px-2.5 py-2 text-[11px] text-muted transition-colors hover:bg-white/[0.07] hover:text-cream"
              >
                <ScrollText size={13} className="shrink-0" />
                Audit Log
              </Link>
            )}

            {/* Directly below the Audit Log, and gated the same way: on the
                grant alone. A super admin sees every organization here, an
                admin granted `org.credits.read` sees only their own and what
                each of their people holds, and nobody else sees the link.

                Called "Users" rather than "Credits" because the page is the
                roster: it is where members are listed and their access is
                changed, and the balances are one column of that.

                Hidden from a super admin: `/credits` is in the other shell and
                would only bounce them, and the console's own Organizations
                page is already the roster for every tenant. */}
            {!user?.isSuperAdmin && can(user, "org.credits.read") && (
              <Link
                href="/credits"
                role="menuitem"
                onClick={closeNow}
                className="flex items-center gap-2 border-t border-white/5 px-2.5 py-2 text-[11px] text-muted transition-colors hover:bg-white/[0.07] hover:text-cream"
              >
                <Users size={13} className="shrink-0" />
                Users
              </Link>
            )}

            {/* Status and both actions share one row — icons carry the labels. */}
            <div className="flex items-center gap-0.5 px-1.5 py-1 border-t border-white/5">
              <span
                title={liveConnected ? "Live" : "Connecting..."}
                className={cn(
                  "flex-1 flex items-center gap-1.5 px-1 text-[10px]",
                  liveConnected ? "text-success" : "text-faint"
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "h-1.5 w-1.5 rounded-full shrink-0",
                    liveConnected ? "bg-success" : "bg-faint animate-pulse"
                  )}
                />
                {liveConnected ? "Live" : "Connecting..."}
              </span>

              <button
                role="menuitem"
                onClick={toggleTheme}
                title={theme === "light" ? "Dark mode" : "Light mode"}
                aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
                className="p-1.5 rounded text-faint hover:text-cream hover:bg-white/[0.07] transition-colors"
              >
                {theme === "light" ? <Moon size={13} /> : <Sun size={13} />}
              </button>

              <button
                role="menuitem"
                onClick={logout}
                disabled={loggingOut}
                title="Sign out"
                aria-label="Sign out"
                className="p-1.5 rounded text-faint hover:text-cream hover:bg-white/[0.07] transition-colors"
              >
                {loggingOut ? <Loader2 size={13} className="animate-spin" /> : <LogOut size={13} />}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
