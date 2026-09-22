"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Lock, Menu, X } from "lucide-react";
import { useNavItems } from "@/lib/nav";
import { usePageActionsValue, usePageToolbarValue } from "@/lib/page-toolbar-context";
import { NavBar, NavLogo } from "@/components/nav/NavBar";
import { Breadcrumbs } from "@/components/nav/Breadcrumbs";
import { AccountMenu } from "@/components/nav/AccountMenu";
import { QueueIndicator } from "@/components/studio/QueueIndicator";
import { useCredits } from "@/lib/useCredits";
import { useDismissable } from "@/lib/useEscapeKey";
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
  const { credits } = useCredits();
  // Set by pages that need controls of their own here instead of the route
  // trail — e.g. History's filters, which replace it rather than sit beside it.
  const toolbar = usePageToolbarValue();
  const actions = usePageActionsValue();

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  useDismissable(drawerRef, drawerOpen, closeDrawer);

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

      {/* From `md` up the logo lives in the sidebar, so this bar would
          otherwise sit empty on the left — the route trail fills it, unless
          the page has put its own controls here instead. */}
      {toolbar ? (
        <div className="hidden min-w-0 flex-1 items-center gap-2 md:flex">{toolbar}</div>
      ) : (
        <Breadcrumbs />
      )}

      {/* ml-auto holds the cluster right wherever the nav row isn't filling the
          gap — on phones, and at xl where the row is absolutely positioned. */}
      <div className="flex items-center gap-1.5 md:gap-2.5 shrink-0 ml-auto">
        {/* The current page's own action, if it has one — a tool's "Start over".
            Beside the credits rather than in the toolbar slot above, so it
            doesn't cost the page its breadcrumb trail. */}
        {actions}

        {/* Small screens only: from md up the queue lives in the right rail,
            which is always visible and doesn't have to be opened. Renders
            nothing when there is nothing queued. */}
        <span className="md:hidden">
          <QueueIndicator />
        </span>

        {/* Credits and the account avatar as one pill, not two — a divider
            between them instead of a gap that reads as unrelated controls. */}
        <div className="flex items-center gap-2 pl-1.5 pr-1.5 py-1 rounded-full bg-surface-raised/80 backdrop-blur-md border border-gold/25">
          <span
            aria-hidden
            className="relative w-[22px] h-[22px] rounded-full flex items-center justify-center shrink-0 shadow-[0_1px_3px_rgba(0,0,0,0.4)]"
            style={{ background: "repeating-conic-gradient(var(--color-gold-dim) 0deg 6deg, var(--color-gold-bright) 6deg 12deg)" }}
          >
            <span
              className="absolute inset-[2px] rounded-full flex items-center justify-center text-[11px] font-bold leading-none text-[#4A3410]"
              style={{ background: "linear-gradient(to bottom right, var(--color-gold-bright), var(--color-gold), var(--color-gold-dim))" }}
            >
              ₹
            </span>
          </span>
          {/* The real balance, not a placeholder. It shows what is spendable
              rather than what is owned: credits frozen by a run already in
              flight cannot pay for the next one, so `available` is the
              number that decides whether the next click works. */}
          <span
            title={
              credits
                ? `${credits.available.toLocaleString()} available${
                    credits.reserved ? ` · ${credits.reserved.toLocaleString()} frozen by runs in progress` : ""
                  }`
                : "Loading your balance…"
            }
            className={cn(
              "text-xs font-semibold tabular-nums leading-none",
              // Red is "you cannot run anything", which is only true once the
              // frozen credits are gone too. Nothing spendable *because* runs
              // are holding it all is a wait, not a wall.
              credits && credits.balance === 0 ? "text-error" : "text-gold-shine"
            )}
          >
            {credits ? credits.available.toLocaleString() : "—"}
          </span>

          {/* Frozen credits, said out loud. They were only ever in the tooltip,
              so a balance that dropped the moment a run started looked like it
              had been spent — and then partly came back when the run settled
              for fewer images than it asked for, which looked like a bug. */}
          {credits && credits.reserved > 0 && (
            <span
              title={`${credits.reserved.toLocaleString()} credits are held for runs in progress. They are charged when a run finishes, and returned if it fails.`}
              className="flex items-center gap-1 text-[10px] font-medium tabular-nums leading-none text-muted"
            >
              <Lock size={9} className="shrink-0 opacity-70" aria-hidden />
              {credits.reserved.toLocaleString()}
            </span>
          )}

          <span aria-hidden className="w-px h-5 shrink-0 bg-gold/20" />

          <AccountMenu avatarClassName="w-7 h-7" />
        </div>
      </div>
    </NavBar>
  );
}
