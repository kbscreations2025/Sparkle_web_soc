"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { THEME_COOKIE, DEFAULT_THEME, type Theme } from "@/lib/theme";

type ThemeContextValue = {
  theme: Theme;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeContextValue>({ theme: DEFAULT_THEME, toggle: () => {} });

export function ThemeProvider({ initialTheme, children }: { initialTheme: Theme; children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  function toggle() {
    setTheme((value) => {
      const next: Theme = value === "light" ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", next);
      // A year, site-wide, so every future SSR render already knows the choice.
      document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
      return next;
    });
  }

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
