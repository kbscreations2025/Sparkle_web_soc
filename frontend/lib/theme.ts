export type Theme = "light" | "dark";

/** Read by the root layout on the server, written by the sidebar toggle on the client. */
export const THEME_COOKIE = "sp-theme";
export const DEFAULT_THEME: Theme = "light";

/** Narrows an untrusted cookie value to a Theme, falling back to the default. */
export function readTheme(value: string | undefined): Theme {
  return value === "dark" || value === "light" ? value : DEFAULT_THEME;
}
