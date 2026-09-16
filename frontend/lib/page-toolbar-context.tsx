"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * Two places a page can put its own controls in the header: `toolbar`, which
 * takes the breadcrumb's place (History's filters), and `actions`, which sits
 * beside the credits pill on the right (a tool's "Start over").
 *
 * Both are the same machinery, so it is built once here and instantiated
 * twice rather than written out per slot.
 */
function createPageSlot() {
  /**
   * Split into two contexts rather than one `{ node, setNode }` value: a page
   * calling the setter hook only ever needs the setter, and the setter itself
   * never changes identity. Bundled together, every render of a page that
   * writes here would also subscribe it to the *value* it just set — turning
   * every write into a re-render that writes again, forever.
   */
  const ValueContext = createContext<ReactNode | null>(null);
  const SetterContext = createContext<(node: ReactNode | null) => void>(() => {});

  function Provider({ children }: { children: ReactNode }) {
    const [node, setNode] = useState<ReactNode | null>(null);
    return (
      <SetterContext.Provider value={setNode}>
        <ValueContext.Provider value={node}>{children}</ValueContext.Provider>
      </SetterContext.Provider>
    );
  }

  /** What `TopNav` renders for this slot, when the current page has filled it. */
  const useValue = () => useContext(ValueContext);

  /**
   * A page calls this with its own controls so they render in the header.
   * Synced on every render — not just mount — so the controls stay live as the
   * page's own state changes; only unmounting clears it, so the next page
   * doesn't inherit stale controls.
   *
   * Writing here re-renders the shell but not the page: `children` reaching the
   * layout is the same element across that re-render, so React skips the
   * subtree and this effect doesn't immediately run again.
   */
  function useSlot(node: ReactNode) {
    const setNode = useContext(SetterContext);

    useEffect(() => {
      setNode(node);
    });

    // Cleanup-only: clears the slot when the page unmounts.
    useEffect(() => () => setNode(null), [setNode]);
  }

  return { Provider, useValue, useSlot };
}

const toolbarSlot = createPageSlot();
const actionsSlot = createPageSlot();

/** Wraps the dashboard shell so `TopNav` and the page it's showing can share both slots. */
export function PageToolbarProvider({ children }: { children: ReactNode }) {
  return (
    <toolbarSlot.Provider>
      <actionsSlot.Provider>{children}</actionsSlot.Provider>
    </toolbarSlot.Provider>
  );
}

export const usePageToolbarValue = toolbarSlot.useValue;
export const usePageToolbar = toolbarSlot.useSlot;

export const usePageActionsValue = actionsSlot.useValue;
export const usePageActions = actionsSlot.useSlot;
