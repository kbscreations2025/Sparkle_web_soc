"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Menu, X } from "lucide-react";
import { useNavItems } from "@/lib/nav";
import { NavBar, NavLogo } from "@/components/nav/NavBar";
import { AccountMenu } from "@/components/nav/AccountMenu";
import { QueueIndicator } from "@/components/studio/QueueIndicator";
import { cn } from "@/lib/utils";

/**
 * The top bar: identity, credits, account — and on phones, the navigation
 * drawer.
 *
 * The tool routes themselves moved to `SideNav` down the left edge, where
 * there is room to render their names instead of a row of unlabelled icons
 * and a tooltip that had to chase the cursor to explain them. Only the drawer
 * remains here, because the sidebar is hidden below `md`.
 */
export function TopNav() {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  // Only the tools this person was granted.
  const navItems = useNavItems();

  useEffect(() => {
    if (!drawerOpen) return;

    function onPointerDown(event: MouseEvent) {
      if (!drawerRef.current?.contains(event.target as Node)) setDrawerOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setDrawerOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [drawerOpen]);

  return (
    // Unpinned: the sidebar owns the full height beside this, so a header
    // fixed across the viewport would lie over it.
    <NavBar floating={false}>
      {/* Phones only. From `md` up the mark lives at the top of the sidebar,
          where it belongs to the column it heads. */}
      <span className="md:hidden">
        <NavLogo />
      </span>

      {/* Phones only — from `md` up the left sidebar is the navigation. */}
      <div className="md:hidden shrink-0" ref={drawerRef}>
        <button
          onClick={() => setDrawerOpen((value) => !value)}
          aria-expanded={drawerOpen}
          aria-label={drawerOpen ? "Close menu" : "Open menu"}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-muted hover:text-cream hover:bg-white/[0.07] transition-colors"
        >
          {drawerOpen ? <X size={18} /> : <Menu size={18} />}
        </button>

        <AnimatePresence>
          {drawerOpen && (
            <motion.nav
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              // Labels come back here: an icon grid is guesswork on a phone,
              // where there's no hover to reveal the tooltip.
              className="fixed left-2 right-2 top-[3.75rem] max-h-[calc(100dvh-4.5rem)] overflow-y-auto rounded-xl border border-white/10 bg-surface-raised shadow-lg p-1.5 grid grid-cols-2 gap-1"
            >
              {navItems.map(({ id, label, icon: Icon, href }) => {
                const isActive = href !== undefined && pathname === href;
                const row = "flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-xs transition-colors";

                if (!href) {
                  return (
                    <span key={id} className={cn(row, "text-faint")}>
                      <Icon size={15} className="shrink-0" />
                      <span className="truncate">{label}</span>
                    </span>
                  );
                }

                return (
                  <Link
                    key={id}
                    href={href}
                    // A tap that navigates should leave the drawer behind,
                    // not sitting on top of the page it just opened.
                    onClick={() => setDrawerOpen(false)}
                    className={cn(
                      row,
                      isActive ? "bg-gold/[0.10] text-gold font-medium" : "text-muted hover:text-cream hover:bg-white/[0.07]"
                    )}
                  >
                    <Icon size={15} className="shrink-0" />
                    <span className="truncate">{label}</span>
                  </Link>
                );
              })}
            </motion.nav>
          )}
        </AnimatePresence>
      </div>

      {/* ml-auto holds the cluster right wherever the nav row isn't filling the
          gap — on phones, and at xl where the row is absolutely positioned. */}
      <div className="flex items-center gap-1.5 md:gap-2.5 shrink-0 ml-auto">
        {/* Small screens only: from md up the queue lives in the right rail,
            which is always visible and doesn't have to be opened. Renders
            nothing when there is nothing queued. */}
        <span className="md:hidden">
          <QueueIndicator />
        </span>

        <span className="flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full bg-surface-raised/80 backdrop-blur-md border border-gold/25 shadow-[0_0px_8px_rgba(0,0,0,0.35)]">
          <span
            aria-hidden
            className="relative w-[22px] h-[22px] rounded-full flex items-center justify-center shadow-[0_1px_3px_rgba(0,0,0,0.4)]"
            style={{ background: "repeating-conic-gradient(var(--color-gold-dim) 0deg 6deg, var(--color-gold-bright) 6deg 12deg)" }}
          >
            <span
              className="absolute inset-[2px] rounded-full flex items-center justify-center text-[11px] font-bold leading-none text-[#4A3410]"
              style={{ background: "linear-gradient(to bottom right, var(--color-gold-bright), var(--color-gold), var(--color-gold-dim))" }}
            >
              ₹
            </span>
          </span>
          <span className="text-xs font-semibold tabular-nums leading-none text-gold-shine">100</span>
        </span>

        <AccountMenu />
      </div>
    </NavBar>
  );
}
