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

/**
 * Title fonts for a poster's text. The ids match POSTER_FONTS in the backend's
 * prompts/festivePoster.js, which describes each to the model; `preview` is the
 * Google font the picker draws its sample in (loaded on the festive page).
 */
export const POSTER_FONTS = [
  { id: "classic_serif", label: "Classic serif" },
  { id: "script", label: "Elegant script" },
  { id: "engraved", label: "Engraved caps" },
  { id: "modern_sans", label: "Modern sans" },
  { id: "art_deco", label: "Art Deco" },
  { id: "handwritten", label: "Handwritten" },
] as const;

/** A ready headline and tagline per event, so the text is one click away. */
export const EVENT_COPY: Record<string, { headline: string; tagline: string }> = {
  valentines: { headline: "Valentine's Day Edition", tagline: "Love, beautifully reimagined." },
  mothers_day: { headline: "Mother's Day Collection", tagline: "A celebration of love, warmth and timeless beauty" },
  fathers_day: { headline: "Father's Day Collection", tagline: "Crafted for the man who means the world" },
  christmas: { headline: "The Christmas Edit", tagline: "Gifts that sparkle forever" },
  new_year: { headline: "Hello New Year", tagline: "Begin the year in brilliance" },
  diwali: { headline: "Diwali Collection", tagline: "Light up every celebration" },
  dhanteras: { headline: "Dhanteras Special", tagline: "Welcome prosperity in gold" },
  akshaya_tritiya: { headline: "Akshaya Tritiya", tagline: "Auspicious beginnings, timeless gold" },
  raksha_bandhan: { headline: "Raksha Bandhan", tagline: "A bond, beautifully adorned" },
  karva_chauth: { headline: "Karva Chauth Collection", tagline: "For love that lasts a lifetime" },
  eid: { headline: "Eid Collection", tagline: "Celebrate in timeless elegance" },
  wedding_season: { headline: "The Bridal Edit", tagline: "For the most beautiful day" },
};
