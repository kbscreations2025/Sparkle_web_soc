"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Menu, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/permissions";
import { NAV } from "@/lib/nav";
import { NavBar, NavLogo, NavDivider } from "@/components/nav/NavBar";
import { AccountMenu } from "@/components/nav/AccountMenu";
import { cn } from "@/lib/utils";

/** Icon-only, so a square target rather than a label-width pill. */
const PILL_BASE =
  "group relative flex items-center justify-center shrink-0 w-9 h-9 rounded-lg transition-all duration-150";

/** Keeps the tooltip fully on screen when hovering the first or last icon. */
const TIP_EDGE_MARGIN = 70;

/** Carried over from the sidebar rows; `bg-white/*` flips to a black tint on the light theme. */
const PILL_IDLE = "bg-white/[0.04]";


export function TopNav() {
  const pathname = usePathname();
  const { user } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  // Only the label lives in state. The x position is written straight to the
  // node inside a rAF, so moving the pointer across the bar doesn't re-render
  // the twelve pills (and the account menu) on every mousemove event.
  const [tipLabel, setTipLabel] = useState<string | null>(null);
  // Only the tools this person was granted. Memoised so the pills are not
  // re-filtered on every hover-driven render.
  const navItems = useMemo(() => NAV.filter((item) => can(user, item.permission)), [user]);
  const tipRef = useRef<HTMLSpanElement>(null);
  const tipX = useRef(0);
  const tipFrame = useRef<number | null>(null);

  /** The label follows the cursor horizontally; vertically it's pinned below the bar. */
  function positionTip(clientX: number) {
    tipX.current = Math.min(Math.max(clientX, TIP_EDGE_MARGIN), window.innerWidth - TIP_EDGE_MARGIN);
    if (tipFrame.current !== null) return;
    tipFrame.current = requestAnimationFrame(() => {
      tipFrame.current = null;
      if (tipRef.current) tipRef.current.style.left = `${tipX.current}px`;
    });
  }

  function hideTip() {
    setTipLabel(null);
  }

  useEffect(() => {
    return () => {
      if (tipFrame.current !== null) cancelAnimationFrame(tipFrame.current);
    };
  }, []);

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

  // Positions the tooltip the moment it mounts, without reading the ref during
  // render (which React's lint rules rightly reject).
  const attachTip = useCallback((node: HTMLSpanElement | null) => {
    tipRef.current = node;
    if (node) node.style.left = `${tipX.current}px`;
  }, []);

  return (
    <NavBar>
      <NavLogo />

      {/* Phones get the drawer toggle where the icon row would otherwise sit. */}
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

      <NavDivider />

      {/* Icons only — the label lives in the cursor-tracking tooltip below. */}
      <nav
        className="hidden md:flex flex-1 min-w-0 items-center gap-1 overflow-x-auto no-scrollbar"
        onMouseLeave={hideTip}
      >
        {navItems.map(({ id, label, icon: Icon, href }) => {
          const isActive = href !== undefined && pathname === href;
          const hint = href ? label : `${label} — coming soon`;

          const content = (
            <>
              {isActive && (
                <motion.div
                  layoutId="topnav-active"
                  className="absolute inset-0 rounded-lg bg-gold/[0.10] shadow-[inset_0_-2px_0_var(--color-gold)]"
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}
              <Icon
                size={17}
                className={cn(
                  "relative z-10 transition-colors",
                  isActive ? "text-gold" : "text-faint group-hover:text-cream"
                )}
              />
            </>
          );

          // `aria-label` carries the name now that no text is rendered; the
          // native `title` is left off so it can't race the custom tooltip.
          const hover = {
            onMouseEnter: (event: React.MouseEvent) => {
              positionTip(event.clientX);
              setTipLabel(hint);
            },
            onMouseMove: (event: React.MouseEvent) => positionTip(event.clientX),
          };

          if (!href) {
            return (
              <button
                key={id}
                type="button"
                // `aria-disabled` rather than `disabled`: a disabled button
                // fires no mouse events, so its tooltip would never appear.
                aria-disabled
                aria-label={hint}
                {...hover}
                className={cn(PILL_BASE, PILL_IDLE, "cursor-not-allowed opacity-70")}
              >
                {content}
              </button>
            );
          }

          return (
            <Link
              key={id}
              href={href}
              aria-label={hint}
              onClick={hideTip}
              {...hover}
              className={cn(PILL_BASE, isActive ? "text-gold" : cn(PILL_IDLE, "hover:bg-white/[0.07]"))}
            >
              {content}
            </Link>
          );
        })}
      </nav>

      {/* No key on the label: one element that glides between icons rather
          than remounting (and flickering) on every change. */}
      <AnimatePresence>
        {tipLabel && (
          <motion.span
            ref={attachTip}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
            style={{ top: "calc(100% + 8px)" }}
            className="pointer-events-none absolute z-50 -translate-x-1/2 rounded-md border border-white/10 bg-surface-raised px-2.5 py-1 text-[11px] font-medium tracking-wide text-cream shadow-lg whitespace-nowrap"
          >
            {tipLabel}
          </motion.span>
        )}
      </AnimatePresence>

      {/* ml-auto holds the cluster right wherever the nav row isn't filling the
          gap — on phones, and at xl where the row is absolutely positioned. */}
      <div className="flex items-center gap-1.5 md:gap-2.5 shrink-0 ml-auto">
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
