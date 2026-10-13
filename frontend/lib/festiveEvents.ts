/**
 * The calendar moments a Festive Poster can be styled for. The ids must match
 * the backend's FESTIVE_EVENTS (prompts/festivePoster.js), which holds the
 * look each one is given; "custom" is the page's own — it sends the typed
 * event instead of an id.
 */
export const FESTIVE_EVENT_OPTIONS = [
  { id: "valentines", label: "Valentine's Day" },
  { id: "mothers_day", label: "Mother's Day" },
  { id: "fathers_day", label: "Father's Day" },
  { id: "christmas", label: "Christmas" },
  { id: "new_year", label: "New Year" },
  { id: "diwali", label: "Diwali" },
  { id: "dhanteras", label: "Dhanteras" },
  { id: "akshaya_tritiya", label: "Akshaya Tritiya" },
  { id: "raksha_bandhan", label: "Raksha Bandhan" },
  { id: "karva_chauth", label: "Karva Chauth" },
  { id: "eid", label: "Eid" },
  { id: "wedding_season", label: "Wedding Season" },
  { id: "custom", label: "Custom event" },
];

/** Pieces in one poster — the backend's MAX_FESTIVE_PIECES. */
export const MAX_FESTIVE_PIECES = 6;

/** Posters per run — each a differently composed take, each charged. */
export const FESTIVE_COUNT_OPTIONS = [1, 2, 3, 4];
