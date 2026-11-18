"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Loader2, MoreVertical, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type TileMenuAction = {
  icon: LucideIcon;
  label: string;
  onSelect: () => void;
  /** Destructive — drawn in the error colour. */
  danger?: boolean;
};

/** Where there is a real pointer, a dropdown; on touch screens, a sheet from the bottom. */
const POINTER_QUERY = "(hover: hover) and (pointer: fine)";
const MENU_WIDTH = 160;
const EDGE = 8;

/**
 * A tile's actions behind one ⋮ button, so a grid of small pictures carries
 * one control per tile instead of a row of them.
 *
 * With a mouse it opens as a dropdown under the button; on a touch screen as
 * a sheet from the bottom — a dropdown off a tile a third of a phone wide
 * runs off the edge, and a sheet is what a phone expects (the same call the
 * model library makes). Portalled either way: tiles clip their overflow, and
 * a virtualized grid stacks rows that would otherwise sit above it. Closes on
 * a click elsewhere or Escape; a dropdown follows its button as the page
 * scrolls, and closes once the tile has scrolled away.
 *
 * Every click inside stops at the menu: a portal still bubbles through React
 * to the tile, and a tile click opens the lightbox.
 */
export function TileActionsMenu({
  title,
  actions,
  busy = false,
  className,
}: {
  /** What the sheet says it is about — the tile's subject. */
  title: string;
  actions: (TileMenuAction | false | null | undefined)[];
  /** An action on this tile is running (a delete): a spinner in place of the ⋮, and no menu. */
  busy?: boolean;
  className?: string;
}) {
  const items = actions.filter(Boolean) as TileMenuAction[];
  const [open, setOpen] = useState<"dropdown" | "sheet" | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback((refocus = false) => {
    setOpen(null);
    setPosition(null);
    if (refocus) triggerRef.current?.focus();
  }, []);

  /**
   * Puts the dropdown under the button — right edges aligned, flipped above
   * when the screen runs out below, kept inside the viewport — and says
   * whether there is still a button on screen to hang it from.
   */
  const place = useCallback(() => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger?.isConnected || !menu) return false;
    const rect = trigger.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) return false;
    const height = menu.offsetHeight;
    const left = Math.max(EDGE, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - EDGE));
    let top = rect.bottom + 4;
    if (top + height > window.innerHeight - EDGE) top = Math.max(EDGE, rect.top - 4 - height);
    setPosition({ top, left });
    return true;
  }, []);

  // Placed once it has a height to place.
  useLayoutEffect(() => {
    if (open === "dropdown") place();
  }, [open, place]);

  // Keyboard users land on the first action. Without scrolling: any scroll
  // closes the dropdown (below), and it is already on screen.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() =>
      menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true })
    );
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      close();
    }
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") close(true);
    }
    // The dropdown follows its button as the grid scrolls — the page nudges
    // its own scroll as rows settle, and closing on every nudge made the menu
    // vanish as it opened — and closes once the button is gone: scrolled off
    // screen, or its row unmounted by the virtualized grid. A sheet covers
    // the page, so nothing scrolls beneath it. Straight from the event: the
    // browser already sends scroll at most once a frame.
    const follow = () => {
      if (open === "dropdown" && !place()) close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [open, close, place]);

  if (items.length === 0 && !busy) return null;

  function toggle() {
    if (open) {
      close();
      return;
    }
    setOpen(window.matchMedia(POINTER_QUERY).matches ? "dropdown" : "sheet");
  }

  function select(action: TileMenuAction) {
    close();
    action.onSelect();
  }

  // Up and down move between the actions, wrapping; Tab leaves and closes.
  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const entries = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = entries.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      entries[(at + step + entries.length) % entries.length]?.focus({ preventScroll: true });
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      entries[event.key === "Home" ? 0 : entries.length - 1]?.focus({ preventScroll: true });
    } else if (event.key === "Tab") {
      close();
    }
  }

  const menu =
    open === "dropdown" ? (
      <div
        ref={menuRef}
        role="menu"
        aria-label={`${title} — actions`}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onMenuKeyDown}
        style={{ width: MENU_WIDTH, top: position?.top ?? 0, left: position?.left ?? 0, visibility: position ? "visible" : "hidden" }}
        // Solid rather than glass, like the account menu: a backdrop blur
        // over a moving grid composites unreliably across browsers.
        className="fixed z-50 overflow-hidden rounded-lg border border-white/10 bg-surface-raised py-1 shadow-lg"
      >
        {items.map((action) => (
          <button
            key={action.label}
            type="button"
            role="menuitem"
            onClick={() => select(action)}
            className={cn(
              "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] transition-colors focus:outline-none focus-visible:bg-white/[0.07]",
              action.danger
                ? "text-error hover:bg-error/10 focus-visible:bg-error/10"
                : "text-muted hover:bg-white/[0.07] hover:text-cream focus-visible:text-cream"
            )}
          >
            <action.icon size={13} className="shrink-0" />
            {action.label}
          </button>
        ))}
      </div>
    ) : open === "sheet" ? (
      <div
        className="fixed inset-0 z-50 flex items-end bg-black/50"
        onClick={(event) => {
          event.stopPropagation();
          close();
        }}
      >
        <div
          ref={menuRef}
          role="menu"
          aria-label={`${title} — actions`}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={onMenuKeyDown}
          className="animate-drawer-up w-full rounded-t-2xl border-t border-white/10 bg-surface-raised px-2 pb-6 pt-3"
        >
          <p className="truncate px-3 pb-2 text-xs font-semibold text-cream">{title}</p>
          {items.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              onClick={() => select(action)}
              className={cn(
                "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm focus:outline-none focus-visible:bg-white/[0.07]",
                action.danger ? "text-error" : "text-cream"
              )}
            >
              <action.icon size={16} className="shrink-0" />
              {action.label}
            </button>
          ))}
        </div>
      </div>
    ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={busy}
        onClick={(event) => {
          // The tile is clickable; opening its menu must not also open it.
          event.stopPropagation();
          toggle();
        }}
        aria-haspopup="menu"
        aria-expanded={Boolean(open)}
        aria-label={busy ? "Working…" : `Actions for ${title}`}
        title={busy ? "Working…" : "More actions"}
        className={cn(
          // A finger-sized target on a phone, a small one where there is a
          // mouse and the tile is mostly picture.
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/20 bg-black/55 text-white/90 backdrop-blur-sm transition-colors hover:bg-black/75 disabled:opacity-70 md:h-5 md:w-5",
          open && "bg-black/75",
          className
        )}
      >
        {busy ? <Loader2 size={11} className="animate-spin" /> : <MoreVertical size={12} />}
      </button>
      {menu && typeof document !== "undefined" && createPortal(menu, document.body)}
    </>
  );
}

/** The first word of a name — "Divya Pajave" is "Divya" — for chips too small for the whole of it. */
export function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || name;
}
