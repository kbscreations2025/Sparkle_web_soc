/**
 * Who may build lookbooks: Live Lookbook's own grant, or Marketing Kit's.
 * The backend checks the same pair (backend/src/routes/lookbooks.js).
 */
export const LOOKBOOK_PERMISSION = ["tool.live_lookbook.run", "tool.marketing_kit.run"] as const;
