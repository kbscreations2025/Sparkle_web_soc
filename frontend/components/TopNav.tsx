"use client";

import { useCallback, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { House } from "lucide-react";
import { useNavItems } from "@/lib/nav";
import { usePageActionsValue, usePageToolbarValue } from "@/lib/page-toolbar-context";
import { NavBar } from "@/components/nav/NavBar";
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

  const creditsText = credits
    ? `${credits.available.toLocaleString()} available${
        credits.reserved
          ? ` · ${credits.reserved.toLocaleString()} held for runs in progress — charged when a run finishes, returned if it fails`
          : ""
      }`
    : "Loading your balance…";
  const [creditsTipOpen, setCreditsTipOpen] = useState(false);
  const creditsRef = useRef<HTMLSpanElement>(null);
  const closeCreditsTip = useCallback(() => setCreditsTipOpen(false), []);
  useDismissable(creditsRef, creditsTipOpen, closeCreditsTip);

  // A second tap on the logo within this window counts as a double tap.
  // Tracked by hand rather than with `onDoubleClick`, which phone browsers
  // don't fire reliably for taps.
  const router = useRouter();
  const lastTapRef = useRef(0);
  const onLogoTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 350) {
      lastTapRef.current = 0;
      setDrawerOpen(false);
      router.push("/");
      return;
    }
    lastTapRef.current = now;
    setDrawerOpen((value) => !value);
  };

  return (
    // Unpinned: the sidebar owns the full height beside this, so a header
    // fixed across the viewport would lie over it.
    <NavBar floating={false}>
      {/* Phones only — from `md` up the mark lives at the top of the sidebar
          and the sidebar is the navigation. Here the mark *is* the menu:
          one tap opens the routes, a double tap goes to the dashboard. */}
      <div className="md:hidden shrink-0" ref={drawerRef}>
        <button
          type="button"
          onClick={onLogoTap}
          aria-expanded={drawerOpen}
          aria-label={drawerOpen ? "Close menu" : "Open menu"}
          title="Tap for menu · double-tap for dashboard"
          className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-white/[0.07]"
        >
          <Image
            src="/logo/sparklelogo2.png"
            alt="Sparkle"
            width={64}
            height={64}
            priority
            className="h-7 w-7 object-contain"
          />
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
              className="fixed left-2 right-2 top-[3.25rem] max-h-[calc(100dvh-4rem)] overflow-y-auto rounded-xl border border-white/10 bg-surface-raised shadow-lg p-1.5 grid grid-cols-2 gap-1"
            >
              {/* The sidebar's logo is its way home; the drawer has no logo
                  of its own to tap, so home gets a row. */}
              {[{ id: "dashboard", label: "Dashboard", icon: House, href: "/" as string | undefined }, ...navItems].map(({ id, label, icon: Icon, href }) => {
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
        <div className="flex min-w-0 flex-1 items-center gap-2">{toolbar}</div>
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
        <div className="flex items-center gap-1.5 md:gap-2 pl-2.5 pr-1 py-0.5 md:px-1.5 md:py-px lg:py-1 rounded-full bg-surface-raised/80 backdrop-blur-md border border-gold/25">
          {/* No coin on phones — the bar needs the room for the route trail. */}
          <span
            aria-hidden
            className="relative w-[18px] h-[18px] md:w-[22px] md:h-[22px] rounded-full hidden md:flex items-center justify-center shrink-0 shadow-[0_1px_3px_rgba(0,0,0,0.4)]"
            style={{ background: "repeating-conic-gradient(var(--color-gold-dim) 0deg 6deg, var(--color-gold-bright) 6deg 12deg)" }}
          >
            <span
              className="absolute inset-[2px] rounded-full flex items-center justify-center text-[9px] md:text-[11px] font-bold leading-none text-[#4A3410]"
              style={{ background: "linear-gradient(to bottom right, var(--color-gold-bright), var(--color-gold), var(--color-gold-dim))" }}
            >
              ₹
            </span>
          </span>
          {/* The real balance, not a placeholder. It shows what is spendable
              rather than what is owned: credits frozen by a run already in
              flight cannot pay for the next one, so `available` is the
              number that decides whether the next click works. What is
              frozen is in the tooltip only, to keep the bar uncluttered. A
              touch screen has no hover for the tooltip, so a tap opens the
              same text as a small card instead. */}
          <span ref={creditsRef} className="relative flex items-center">
            <button
              type="button"
              title={creditsText}
              onClick={(event) => {
                if ((event.nativeEvent as PointerEvent).pointerType === "mouse") return;
                setCreditsTipOpen((value) => !value);
              }}
              className={cn(
                "cursor-default text-[11px] md:text-xs font-semibold tabular-nums leading-none",
                // Red is "you cannot run anything", which is only true once the
                // frozen credits are gone too. Nothing spendable *because* runs
                // are holding it all is a wait, not a wall.
                credits && credits.balance === 0 ? "text-error" : "text-gold-shine"
              )}
            >
              {credits ? credits.available.toLocaleString() : "—"}
            </button>
            {creditsTipOpen && (
              <span
                role="tooltip"
                className="absolute right-0 top-full z-50 mt-3 w-56 rounded-lg border border-gold/20 bg-surface-raised px-2.5 py-2 text-[11px] leading-snug text-muted shadow-lg"
              >
                {creditsText}
              </span>
            )}
          </span>

          <span aria-hidden className="w-px h-4 md:h-5 shrink-0 bg-gold/20" />

          <AccountMenu avatarClassName="w-6 h-6 md:w-7 md:h-7" />
        </div>
      </div>
    </NavBar>
  );
}
