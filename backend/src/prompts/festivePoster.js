const { ASPECT_TEXT } = require("./textToImage");
const { buildReferenceNote } = require("./shared");

/**
 * Festive Poster: the user's pieces together in one campaign image for a
 * calendar moment — Mother's Day, Christmas, Diwali.
 *
 * The event only ever sets the scene: palette, props, light and mood. The
 * jewellery is the customer's real product, so every piece must come back
 * exactly as photographed, and no text is drawn into the picture — image
 * models misspell it, and a poster with "Happy Mothr's Day" on it is unusable.
 * Copy is added by the brand afterwards.
 */

/**
 * Each event's look. `mood` is what reaches the model; `label` is the chip.
 * The id is what the client sends — keep it stable, the frontend lists the same
 * ids (lib/festiveEvents.ts).
 */
const FESTIVE_EVENTS = {
  valentines: {
    label: "Valentine's Day",
    mood: "romantic Valentine's Day — soft blush and deep rose tones, scattered rose petals, a few red roses, warm candlelit glow, intimate and luxurious",
  },
  mothers_day: {
    label: "Mother's Day",
    mood: "Mother's Day — soft pastel pinks and creams, fresh peonies and tulips, gentle morning light, tender, warm and graceful",
  },
  fathers_day: {
    label: "Father's Day",
    mood: "Father's Day — refined deep navy, charcoal and warm wood tones, leather and classic gentleman's accents, confident and understated",
  },
  christmas: {
    label: "Christmas",
    mood: "Christmas — rich emerald, deep red and gold, pine sprigs, warm fairy-light bokeh, a hint of ribbon and ornaments, cosy and celebratory",
  },
  new_year: {
    label: "New Year",
    mood: "New Year's Eve — midnight black and champagne gold, sparkling bokeh, a touch of confetti and champagne glow, glamorous and festive",
  },
  diwali: {
    label: "Diwali",
    mood: "Diwali — warm glowing diyas and soft candle light, marigold flowers, rich gold, maroon and saffron tones, delicate rangoli accents, auspicious and radiant",
  },
  dhanteras: {
    label: "Dhanteras",
    mood: "Dhanteras — auspicious gold-rich styling, small brass diyas, marigold, a few gold coins as props, warm opulent light, prosperous and traditional",
  },
  akshaya_tritiya: {
    label: "Akshaya Tritiya",
    mood: "Akshaya Tritiya — sacred and prosperous, soft ivory and gold, fresh flowers and rice grains as subtle props, bright auspicious morning light",
  },
  raksha_bandhan: {
    label: "Raksha Bandhan",
    mood: "Raksha Bandhan — joyful sibling celebration, bright festive colours, delicate rakhi threads and flowers as accents, warm and affectionate",
  },
  karva_chauth: {
    label: "Karva Chauth",
    mood: "Karva Chauth — moonlit evening, deep red and gold, a decorated karva and sieve as subtle props, soft diya glow, romantic and traditional",
  },
  eid: {
    label: "Eid",
    mood: "Eid — elegant crescent-moon evening, deep teal, ivory and gold, soft lantern light, subtle geometric patterns, serene and celebratory",
  },
  wedding_season: {
    label: "Wedding Season",
    mood: "Indian wedding season — opulent bridal styling, deep red, maroon and gold, fresh flowers, rich silk and brocade textures, grand and celebratory",
  },
};

const FESTIVE_EVENT_IDS = Object.keys(FESTIVE_EVENTS);

/** Real frame shapes for the image API, by the aspect ids the page sends. */
const FESTIVE_ASPECT_RATIOS = { square: "1:1", portrait: "4:5", landscape: "16:9", story: "9:16" };

/** Nudges parallel posters apart without changing the pieces or the event. */
const POSTER_DIRECTIONS = [
  "A flat-lay composition seen from above, the pieces arranged with breathing room between them.",
  "An elegant tabletop composition at a low three-quarter angle, the pieces grouped at different heights.",
  "A close, intimate composition with soft depth of field on the props, every piece still tack-sharp.",
  "A symmetrical, centred hero composition, the largest piece at the centre and the others around it.",
];

/** The event's look: a preset, or what the user typed for an event of their own. */
function eventMood({ eventId, customEvent }) {
  const custom = String(customEvent || "").trim().slice(0, 200);
  if (custom) return `${custom} — styled with the colours, props, light and mood people associate with that occasion`;
  return (FESTIVE_EVENTS[eventId] ?? FESTIVE_EVENTS.christmas).mood;
}

/** The display name stored on the kit. */
function eventLabel({ eventId, customEvent }) {
  const custom = String(customEvent || "").trim();
  return custom ? custom.slice(0, 120) : (FESTIVE_EVENTS[eventId] ?? FESTIVE_EVENTS.christmas).label;
}

function buildFestivePosterPrompt({ eventId, customEvent, description, aspect, pieceCount, index = 0, total = 1 }) {
  const pieces = pieceCount === 1 ? "the jewellery piece in the attached image" : `ALL ${pieceCount} jewellery pieces in the attached images`;
  const variation =
    total > 1
      ? `\n\nVARIATION ${index + 1} OF ${total}: ${POSTER_DIRECTIONS[index % POSTER_DIRECTIONS.length]} It must look clearly different from the other variations.`
      : `\n\nCOMPOSITION: ${POSTER_DIRECTIONS[index % POSTER_DIRECTIONS.length]}`;

  return `TASK — A FESTIVE CAMPAIGN POSTER FOR A JEWELLERY BRAND

Create one premium, photorealistic social-media campaign image featuring ${pieces}, styled for ${eventMood({ eventId, customEvent })}.

THE JEWELLERY IS THE CUSTOMER'S REAL PRODUCT
- Every attached piece appears exactly once, all together in the same image, each fully visible and uncropped.
- Reproduce each piece exactly as photographed: same design, shape, stone count and placement, settings, metal colour and proportions. Do not redesign, simplify, merge or recolour anything.
- Keep real-world scale between the pieces — a ring is smaller than a necklace.
- Each piece reads as real polished precious metal and real stones, tack-sharp.
- Show the jewellery on its own — no model, no hands, no mannequin.

THE EVENT SETS THE SCENE, NOT THE JEWELLERY
- Use the event's colours, props, surfaces and light around the pieces. Props stay in a supporting role: the jewellery is the hero and is never hidden behind them.
- A refined, high-end brand look — the calibre of a luxury jeweller's festive campaign — never cheap, cluttered or cartoonish.

NO TEXT
- Do not write any words, letters, numbers, logos or watermarks anywhere in the image. Leave a calm area of the background where the brand can add its own greeting later.

Image orientation: ${ASPECT_TEXT[aspect] || ASPECT_TEXT.square}.${description?.trim() ? `\n\nADDITIONAL NOTES FROM THE BRAND: ${description.trim()}` : ""}${variation}`;
}

function buildFestivePosterRefinePrompt({ instruction, referenceCount = 0 }) {
  return (
    `Apply this change to this festive jewellery campaign poster (the first image): ${instruction}.` +
    buildReferenceNote(referenceCount) +
    " Keep every jewellery piece exactly as it is — same design, stones, metal and proportions — and keep the image free of any text. Only apply the requested change."
  );
}

module.exports = {
  FESTIVE_EVENTS,
  FESTIVE_EVENT_IDS,
  FESTIVE_ASPECT_RATIOS,
  buildFestivePosterPrompt,
  buildFestivePosterRefinePrompt,
  eventLabel,
};
