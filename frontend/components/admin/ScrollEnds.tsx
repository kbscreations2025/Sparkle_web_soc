"use client";

import { useEffect, useState, type RefObject } from "react";
import { cn } from "@/lib/utils";

/**
 * Jump-to-top and jump-to-bottom arrows at the two ends of a `.thin-scrollbar`
 * lane, standing in for the native scrollbar's arrow buttons — which step a
 * few pixels, where these go the whole way.
 *
 * Render it as a sibling of the scroller inside a `relative` wrapper, not
 * inside the scroller, or the arrows would scroll away with the rows. The
 * lane reserves room for them (see `.thin-scrollbar` in globals.css), so the
 * thumb never slides under an arrow.
 *
 * Each arrow dims when there is nowhere further to go that way, and both go
 * when the content fits without scrolling.
 */
export function ScrollEnds({
  scrollerRef,
  insetTop = 0,
}: {
  scrollerRef: RefObject<HTMLElement | null>;
  /** Height of a sticky header, so the up arrow sits just below it. */
  insetTop?: number;
}) {
  const [state, setState] = useState({ scrollable: false, atTop: true, atBottom: false });

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    const measure = () => {
      const scrollable = el.scrollHeight > el.clientHeight + 1;
      setState({
        scrollable,
        atTop: el.scrollTop <= 1,
        atBottom: el.scrollTop + el.clientHeight >= el.scrollHeight - 1,
      });
    };

    measure();
    el.addEventListener("scroll", measure, { passive: true });
    // Rows arrive in pages and expand in place, so size changes matter as
    // much as scrolling does.
    const observer = new ResizeObserver(measure);
    const observeChildren = () => {
      observer.disconnect();
      observer.observe(el);
      for (const child of el.children) observer.observe(child);
    };
    observeChildren();
    // Content can also be swapped wholesale (a tab switch, a loader giving
    // way to rows) — watch the new children, not the ones that left.
    const mutations = new MutationObserver(() => {
      observeChildren();
      measure();
    });
    mutations.observe(el, { childList: true });
    return () => {
      el.removeEventListener("scroll", measure);
      observer.disconnect();
      mutations.disconnect();
    };
  }, [scrollerRef]);

  if (!state.scrollable) return null;

  const jump = (to: "top" | "bottom") => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ top: to === "top" ? 0 : el.scrollHeight, behavior: "smooth" });
  };

  return (
    <>
      <Arrow label="Scroll to top" disabled={state.atTop} onClick={() => jump("top")} style={{ top: insetTop + 1 }}>
        <Triangle direction="up" />
      </Arrow>
      <Arrow label="Scroll to bottom" disabled={state.atBottom} onClick={() => jump("bottom")} style={{ bottom: 1 }}>
        <Triangle direction="down" />
      </Arrow>
    </>
  );
}

/** A small solid triangle, the classic scrollbar-button glyph. */
function Triangle({ direction }: { direction: "up" | "down" }) {
  return (
    <svg width="7" height="5" viewBox="0 0 7 5" aria-hidden="true" className="shrink-0" fill="currentColor">
      <path d={direction === "up" ? "M3.5 0.5 L6.5 4.5 H0.5 Z" : "M0.5 0.5 H6.5 L3.5 4.5 Z"} strokeLinejoin="round" />
    </svg>
  );
}

function Arrow({
  label,
  disabled,
  onClick,
  style,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  style: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      style={style}
      className={cn(
        // Lane-wide so the chevron lines up with the thumb; the ::before
        // widens the hit area past the lane without widening the lane.
        "absolute right-px z-20 flex h-3.5 w-[9px] items-center justify-center overflow-visible text-faint transition-[color,opacity]",
        "before:absolute before:-inset-x-1.5 before:-inset-y-0.5 before:content-['']",
        "hover:text-gold disabled:cursor-default disabled:opacity-30 disabled:hover:text-faint"
      )}
    >
      {children}
    </button>
  );
}
