"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useNavItems } from "@/lib/nav";
import { cn } from "@/lib/utils";

/** Shared by every row so the pill geometry can't drift between the three states. */
const ROW_BASE = "group relative flex shrink-0 items-center rounded-lg text-xs transition-colors";

/** Labelled: a full-width pill with the icon and name side by side. */
const ROW_EXPANDED = "gap-2.5 px-2.5 py-2";

/**
 * Icon only: a fixed square rather than a squashed pill, so the boxes read as
 * a column of equal tiles instead of inheriting whatever width the rail
 * happens to be.
 */
const ROW_COLLAPSED = "h-10 w-10 justify-center p-0";

/**
 * The active state, as an overlay rather than a left border.
 *
 * A border would add 2px to one side and need matching padding taken off the
 * other to stop the row shifting — and in the collapsed square it would sit
 * off-centre. An inset shadow paints the same gold bar inside the box, so the
 * geometry is identical whether the row is active or not, in both states.
 */
const ROW_ACTIVE_OVERLAY = "absolute inset-0 rounded-lg bg-gold/[0.10] shadow-[inset_3px_0_0_var(--color-gold)]";

/**
 * The product mark and the tool routes, down the left edge of every dashboard
 * page.
 *
 * Owns the full height of the window — which is the point of putting the logo
 * here rather than in the top bar: the mark sits at the very top of the
 * column it belongs to, and the header spans only the content beside it.
 *
 * Hidden on phones, where the top bar's drawer is the navigation.
 */
export function SideNav() {
  const pathname = usePathname();

  /**
   * Two separate reasons to be open, and they behave differently.
   *
   * `pinned` is a decision — the rail stays wide and takes real space in the
   * layout. `peeking` is a glance: the pointer is over it, so it widens but
   * floats over the page instead of pushing it. Reflowing a whole workspace
   * every time the cursor crosses the left edge would be far more disruptive
   * than the rail is useful.
   */
  const [pinned, setPinned] = useState(false);
  const [peeking, setPeeking] = useState(false);
  const expanded = pinned || peeking;
  const collapsed = !expanded;

  // Only the tools this person was granted.
  const items = useNavItems();

  return (
    // The outer element is only a spacer: it holds the width the layout
    // reserves, which follows `pinned` alone. The panel inside is what
    // actually widens on hover, overhanging this box.
    <aside
      className={cn(
        "relative z-50 hidden shrink-0 md:block transition-[width] duration-200",
        pinned ? "w-48" : "w-16"
      )}
    >
      <div
        // `focus`/`blur` as well as the pointer: tabbing into the nav has to
        // open it too, or a keyboard user is picking between unlabelled
        // icons. React's handlers here are focusin/focusout, so they fire for
        // descendants.
        onMouseEnter={() => setPeeking(true)}
        onMouseLeave={() => setPeeking(false)}
        onFocus={() => setPeeking(true)}
        onBlur={() => setPeeking(false)}
        className={cn(
          // `glass-raised` is the top bar's surface: the two meet at a corner,
          // so sharing one class is what keeps them the same colour in both
          // themes — and it already carries its own reduced-motion fallback.
          //
          // The `z-50` on the spacer above is not decoration. A
          // `backdrop-filter` creates a stacking context, so the moment this
          // became a glass surface the edge tab's own `z-50` stopped competing
          // at the root and became an order *within* it. That left the sidebar
          // at `auto`, underneath the header's `z-40` — which paints across
          // the strip the tab hangs into, and hid it.
          "absolute inset-y-0 left-0 flex flex-col border-r border-white/[0.06] glass-raised transition-[width] duration-200",
          expanded ? "w-48" : "w-16"
        )}
      >
        <CollapseTab pinned={pinned} onToggle={() => setPinned((value) => !value)} />

        <div className="flex shrink-0 items-center justify-center border-b border-white/[0.06] px-3 py-3">
          <Link href="/" title="Dashboard" className="flex min-w-0 items-center">
            {/* The star alone has no room for the wordmark beside it. The
                `width`/`height` props are the intrinsic size hint behind the
                srcset, so they track what each actually renders — otherwise
                the browser is asked for a variant sized for the old height. */}
            {collapsed ? (
              <Image
                src="/logo/sparklelogo2.png"
                alt="Sparkle"
                width={32}
                height={32}
                priority
                className="h-8 w-8 object-contain"
              />
            ) : (
              <Image
                src="/logo/sparkle5.png"
                alt="Sparkle"
                width={128}
                height={36}
                priority
                className="h-9 w-auto object-contain"
              />
            )}
          </Link>
        </div>

        <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto p-2">
          {/* Only with the wordmark — under the bare star it would be a line of
              text wider than the rail it sits in. Outside the list, not inside
              it: a `ul` may only contain `li`. */}
          {!collapsed && (
            <p className="truncate px-1 pb-2 text-[9px] font-medium uppercase tracking-[0.18em] text-faint/70">
              Brilliance… made effortless
            </p>
          )}

          {/* Centred when collapsed: the squares are a fixed 40px, narrower
              than the rail, so without this they would hug the left edge. */}
          <ul className={cn("flex flex-col gap-1", collapsed && "items-center")}>
            {items.map(({ id, label, icon: Icon, href }) => {
              // Prefix match, not equality: a tool's workspace lives under its
              // own route (/cleaning/default), and exact matching would leave
              // the nav showing nothing selected once you were inside one.
              const isActive = Boolean(href) && (pathname === href || pathname.startsWith(`${href}/`));

              const shape = cn(ROW_BASE, collapsed ? ROW_COLLAPSED : ROW_EXPANDED);

              // `relative z-10` lifts these above the active overlay, which is
              // painted behind them.
              const content = (
                <>
                  <Icon size={16} className="relative z-10 shrink-0" />
                  {!collapsed && <span className="relative z-10 truncate">{label}</span>}
                </>
              );

              // No page yet. A span, not a disabled button: there is nothing to
              // activate, and the title carries what the hidden label would say.
              if (!href) {
                return (
                  <li key={id}>
                    <span
                      title={`${label} — coming soon`}
                      className={cn(shape, "cursor-not-allowed bg-white/[0.02] text-faint/50")}
                    >
                      {content}
                    </span>
                  </li>
                );
              }

              return (
                <li key={id}>
                  <Link
                    href={href}
                    title={label}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      shape,
                      isActive
                        ? "font-medium text-gold"
                        : "bg-white/[0.04] text-muted hover:bg-white/[0.07] hover:text-cream"
                    )}
                  >
                    {isActive && <span aria-hidden className={ROW_ACTIVE_OVERLAY} />}
                    {content}
                  </Link>
                </li>
              );
            })}
            </ul>
          </nav>
      </div>
    </aside>
  );
}

/**
 * The collapse control, as a bump moulded onto the sidebar's outer edge.
 *
 * Sits entirely outside the sidebar box (`-right-3.5` matching its own
 * `w-3.5`) yet has to read as part of it, which takes four things:
 *
 * - No left border and rounding on the right only, so the flat side is the
 *   one meeting the edge and nothing draws a line between them.
 * - The sidebar's own border colour on the other three sides, continuing that
 *   line around the bump instead of outlining a separate object.
 * - No shadow. A shadow is what makes something read as lying *over* a
 *   surface rather than being part of it.
 * - The very same surface class as the sidebar, so they cannot drift apart
 *   in either theme. It works here because the bump overhangs the header,
 *   which is that same surface — so whether it composites over the sidebar
 *   or over the header, it lands on the same colour.
 *
 * `z-50` puts it above the header (`z-40`), which its top edge overlaps.
 * Nothing between here and the shell root clips overflow, which is what lets
 * it hang outside the sidebar at all.
 *
 * It pins rather than expands, now that hovering already expands: the choice
 * it offers is whether the rail *stays* open and holds its own space, so the
 * wording says that rather than describing a width the pointer is already
 * changing.
 */
function CollapseTab({ pinned, onToggle }: { pinned: boolean; onToggle: () => void }) {
  const label = pinned ? "Unpin navigation" : "Keep navigation open";

  return (
    <button
      type="button"
      onClick={onToggle}
      title={label}
      aria-label={label}
      aria-pressed={pinned}
      className="glass-raised absolute -right-3.5 top-6 z-50 flex h-7 w-3.5 items-center justify-center rounded-r-md border border-l-0 border-white/[0.06] text-faint transition-colors hover:text-cream"
    >
      {pinned ? <ChevronLeft size={10} /> : <ChevronRight size={10} />}
    </button>
  );
}
