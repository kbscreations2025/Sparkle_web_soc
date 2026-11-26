import {
  LOOKBOOK_VERSION,
  VARIANTS,
  type CardAnimation,
  type CardOf,
  type CardStyle,
  type CardType,
  type LookbookCard,
  type LookbookDesign,
  type LookbookTheme,
} from "./types";

/**
 * Defaults for every field of a lookbook, and the one function that opens a
 * saved page: `normalizeDesign`. Anything a page saved before a field
 * existed, or a value the backend dropped (a picture that isn't Sparkle's, a
 * colour that isn't a colour), comes back as a default here instead of
 * reaching the renderer as `undefined`.
 */

/** Short ids: unique within a page, which is all a card or row id needs to be. */
export function uid() {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "")
      : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return random.slice(0, 12);
}

export const DEFAULT_THEME: LookbookTheme = {
  templateId: "blank",
  bgColor: "#FFFFFF",
  surfaceColor: "#F5F4F1",
  textColor: "#2A2826",
  headingColor: "#111111",
  mutedColor: "#77726C",
  accentColor: "#111111",
  accentTextColor: "#FFFFFF",
  background: "solid",
  displayFont: "inter",
  headingFont: "inter",
  bodyFont: "inter",
  headingUppercase: false,
  headingTracking: -0.01,
  headingWeight: 500,
  baseSize: 16,
  radius: 12,
  gap: 24,
  maxWidth: 1120,
  logo: null,
  logoSize: 40,
  logoPlacement: "center",
  brandName: "",
};

export function defaultStyle(type: CardType): CardStyle {
  const base: CardStyle = {
    variant: VARIANTS[type][0].id,
    align: "center",
    width: "wide",
    paddingY: 48,
    paddingX: 24,
    spaceAbove: 0,
    radius: null,
    background: "none",
    bgColor: null,
    textColor: null,
    headingColor: null,
    textScale: 1,
    // Never cropped unless someone asks: the piece is the point.
    fit: "whole",
    aspect: "auto",
    overlay: 0,
    overlayColor: null,
  };
  switch (type) {
    case "hero":
      // The opening picture covers the whole screen on any device. "Whole" is one click away in Pictures → Fit.
      return { ...base, width: "full", paddingY: 64, overlay: 0.25, fit: "fill" };
    case "story":
      return { ...base, width: "narrow", paddingY: 56 };
    case "specs":
    case "contact":
      return { ...base, width: "narrow" };
    case "spacer":
      return { ...base, paddingY: 0 };
    default:
      return base;
  }
}

export function defaultAnimation(type: CardType): CardAnimation {
  return {
    type: type === "spacer" ? "none" : "slide",
    direction: "up",
    duration: 0.9,
    delay: 0,
    strength: 0.5,
  };
}

/** A new card as the builder adds it: placeholder words, no pictures yet. */
export function newCard<T extends CardType>(type: T): CardOf<T> {
  const shell = { id: uid(), type, style: defaultStyle(type), animation: defaultAnimation(type) };
  const content: { [K in CardType]: Omit<CardOf<K>, "id" | "type" | "style" | "animation"> } = {
    hero: {
      media: null,
      eyebrow: "New collection",
      title: "Collection name",
      subtitle: "A line about what makes these pieces yours.",
      height: "tall",
      buttonLabel: "Explore",
      buttonTarget: "next",
    },
    gallery: {
      eyebrow: "",
      title: "The pieces",
      caption: "",
      items: [],
      columns: 3,
      mobileColumns: 2,
      showCaptions: false,
    },
    spotlight: {
      media: null,
      eyebrow: "Spotlight",
      title: "Name of the piece",
      description: "Two or three lines on the design, the stones and how it's worn.",
      details: [
        { id: uid(), label: "Metal", value: "18k yellow gold" },
        { id: uid(), label: "Stones", value: "Diamonds, 0.85 ct" },
        { id: uid(), label: "Weight", value: "6.2 g" },
      ],
      price: "",
      showPrice: false,
    },
    before_after: {
      before: null,
      after: null,
      beforeLabel: "Before",
      afterLabel: "After",
      title: "",
      caption: "",
      start: 50,
    },
    video: { media: null, title: "", caption: "", autoplay: true, loop: true, showControls: false },
    story: {
      eyebrow: "",
      title: "The story",
      body: "Every collection begins with a feeling. Write a few lines about where these pieces came from, what inspired them and who they are for.",
      signature: "",
    },
    specs: {
      title: "The details",
      caption: "",
      nameLabel: "Piece",
      detailLabel: "Details",
      priceLabel: "Price",
      rows: [
        { id: uid(), name: "Ring", detail: "18k gold, diamonds", price: "" },
        { id: uid(), name: "Earrings", detail: "18k gold, pearls", price: "" },
        { id: uid(), name: "Pendant", detail: "18k gold, emerald", price: "" },
      ],
      showPrices: true,
      note: "",
    },
    contact: {
      eyebrow: "",
      title: "Enquire",
      body: "Like a piece? Message us and we'll share prices, sizes and availability.",
      buttons: [
        { id: uid(), kind: "whatsapp", label: "Chat on WhatsApp", value: "", message: "Hi! I'd love to know more about your collection." },
        { id: uid(), kind: "email", label: "Email us", value: "", message: "" },
      ],
      floating: false,
    },
    spacer: { height: 48 },
  };
  return { ...shell, ...content[type] } as unknown as CardOf<T>;
}

/** A copy of a card with fresh ids all the way down, so the copy edits on its own. */
export function cloneCard(card: LookbookCard): LookbookCard {
  const copy = structuredClone(card) as LookbookCard & Record<string, unknown>;
  copy.id = uid();
  for (const key of ["items", "details", "rows", "buttons"]) {
    const list = copy[key];
    if (Array.isArray(list)) copy[key] = list.map((entry) => ({ ...entry, id: uid() }));
  }
  return copy;
}

/* ── Opening a saved page ───────────────────────────────────────────── */

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Fields a saved card has that match the default's type; anything else is the default. */
function mergeTyped<T extends object>(defaults: T, saved: unknown): T {
  if (!isObject(saved)) return defaults;
  const out: Record<string, unknown> = { ...(defaults as Record<string, unknown>) };
  for (const [key, fallback] of Object.entries(defaults)) {
    const value = saved[key];
    if (value === undefined) continue;
    if (fallback === null) out[key] = value;
    else if (typeof value === typeof fallback && Array.isArray(value) === Array.isArray(fallback)) out[key] = value;
    else if (value === null && (key === "media" || key === "before" || key === "after" || key === "logo")) out[key] = null;
  }
  return out as T;
}

const withIds = <T extends { id?: unknown }>(list: unknown): T[] =>
  (Array.isArray(list) ? list : [])
    .filter(isObject)
    .map((entry) => ({ ...entry, id: typeof entry.id === "string" && entry.id ? entry.id : uid() }) as unknown as T);

function normalizeCard(saved: unknown): LookbookCard | null {
  if (!isObject(saved) || typeof saved.type !== "string" || !(saved.type in VARIANTS)) return null;
  const type = saved.type as CardType;
  const fresh = newCard(type) as LookbookCard & Record<string, unknown>;
  const card = mergeTyped(fresh, saved) as LookbookCard & Record<string, unknown>;
  card.id = typeof saved.id === "string" && saved.id ? saved.id : fresh.id;
  card.hidden = saved.hidden === true;
  card.style = mergeTyped(defaultStyle(type), saved.style);
  if (!VARIANTS[type].some((variant) => variant.id === card.style.variant)) card.style.variant = VARIANTS[type][0].id;
  card.animation = mergeTyped(defaultAnimation(type), saved.animation);
  for (const key of ["items", "details", "rows", "buttons"]) {
    if (key in fresh) card[key] = withIds(saved[key]);
  }
  for (const key of ["media", "before", "after"]) {
    if (key in fresh) card[key] = isObject(saved[key]) && typeof saved[key].url === "string" ? saved[key] : null;
  }
  return card;
}

/** A page from the server, made whole: every field present, every list a list. */
export function normalizeDesign(raw: unknown): LookbookDesign {
  const saved = isObject(raw) ? raw : {};
  const theme = mergeTyped(DEFAULT_THEME, saved.theme);
  const logo = isObject(saved.theme) && isObject(saved.theme.logo) ? saved.theme.logo : null;
  theme.logo = logo && typeof logo.url === "string" ? (logo as unknown as LookbookTheme["logo"]) : null;
  const meta = isObject(saved.meta) ? saved.meta : {};
  return {
    version: LOOKBOOK_VERSION,
    theme,
    cards: (Array.isArray(saved.cards) ? saved.cards : []).map(normalizeCard).filter((card): card is LookbookCard => card !== null),
    meta: {
      title: typeof meta.title === "string" ? meta.title : "",
      description: typeof meta.description === "string" ? meta.description : "",
    },
  };
}
