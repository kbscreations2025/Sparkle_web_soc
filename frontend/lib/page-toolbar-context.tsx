"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * Split into two contexts rather than one `{ toolbar, setToolbar }` value:
 * a page calling `usePageToolbar` only ever needs the setter, and the setter
 * itself never changes identity. Bundled together, every render of a page
 * that writes here would also subscribe it to the *value* it just set —
 * turning every write into a re-render that writes again, forever.
 */
const PageToolbarValueContext = createContext<ReactNode | null>(null);
const PageToolbarSetterContext = createContext<(node: ReactNode | null) => void>(() => {});

/** Wraps the dashboard shell so `TopNav` and the page it's showing can share one value. */
export function PageToolbarProvider({ children }: { children: ReactNode }) {
  const [toolbar, setToolbar] = useState<ReactNode | null>(null);
  return (
    <PageToolbarSetterContext.Provider value={setToolbar}>
      <PageToolbarValueContext.Provider value={toolbar}>{children}</PageToolbarValueContext.Provider>
    </PageToolbarSetterContext.Provider>
  );
}

/** What `TopNav` renders in the breadcrumb's place when the current page has one. */
export function usePageToolbarValue() {
  return useContext(PageToolbarValueContext);
}

/**
 * A page calls this with its own controls (filters, actions) so they render
 * in the header instead of the breadcrumb. Synced on every render — not just
 * mount — so the controls stay live as the page's own state changes; only
 * unmounting clears it, so the next page doesn't inherit stale controls.
 */
export function usePageToolbar(node: ReactNode) {
  const setToolbar = useContext(PageToolbarSetterContext);

  useEffect(() => {
    setToolbar(node);
  });

  // Cleanup-only: clears the toolbar when the page unmounts.
  useEffect(() => () => setToolbar(null), [setToolbar]);
}
