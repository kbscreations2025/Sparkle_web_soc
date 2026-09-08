"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { LogOut, Loader2, Sun, Moon } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import { cn } from "@/lib/utils";

/**
 * The avatar and everything behind it — who you are, whether the live socket
 * is up, the theme toggle and sign out. Shared so the dashboard and the
 * console present the same control in the same place.
 */
export function AccountMenu() {
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

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={menuRef} onMouseEnter={openMenu} onMouseLeave={closeSoon}>
      {/* Opens rather than toggles: on touch the browser fires a synthetic
          mouseenter first, so a toggle here would close what that just opened. */}
      <button
        onClick={openMenu}
        aria-haspopup="menu"
        aria-expanded={open}
        title={user?.name ?? "Account"}
        className="w-8 h-8 rounded-full bg-gold/10 border border-gold/15 flex items-center justify-center hover:border-gold/40 transition-colors"
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
