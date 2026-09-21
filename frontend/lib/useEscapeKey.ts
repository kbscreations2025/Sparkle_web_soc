"use client";

import { useEffect, type RefObject } from "react";

/**
 * Closes something on Escape.
 *
 * Every overlay in the app had its own copy of this effect, and they had
 * drifted: some listened while closed, some re-bound on every render because
 * the handler wasn't in the dependency list. One hook, bound only while
 * `active`, keeps them identical — and keeps a closed overlay from holding a
 * listener at all.
 */
export function useEscapeKey(onEscape: () => void, active = true) {
  useEffect(() => {
    if (!active) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onEscape();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onEscape, active]);
}

/**
 * Closes a menu, popover or rail on Escape or a click outside it.
 *
 * The two go together — a dropdown that closes on one but not the other
 * feels broken — and every menu in the app had written the pair by hand.
 * Nothing is bound while `open` is false, so a page full of closed menus
 * costs no listeners at all.
 */
export function useDismissable(ref: RefObject<HTMLElement | null>, open: boolean, onDismiss: () => void) {
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) onDismiss();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onDismiss();
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [ref, open, onDismiss]);
}
