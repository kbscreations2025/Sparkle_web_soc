"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

type SidebarContextValue = {
  open: boolean;
  toggle: () => void;
};

const SidebarContext = createContext<SidebarContextValue>({ open: true, toggle: () => {} });

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    // localStorage isn't available during SSR, so the real value can only be
    // read after mount — correcting it here (rather than in the initializer)
    // is what keeps the server-rendered and first client render identical.
    const saved = localStorage.getItem("sb-open");
    if (saved !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(saved === "1");
    } else if (window.matchMedia("(max-width: 767px)").matches) {
      setOpen(false);
    }
  }, []);

  function toggle() {
    setOpen((value) => {
      const next = !value;
      localStorage.setItem("sb-open", next ? "1" : "0");
      return next;
    });
  }

  return <SidebarContext.Provider value={{ open, toggle }}>{children}</SidebarContext.Provider>;
}

export function useSidebar() {
  return useContext(SidebarContext);
}
