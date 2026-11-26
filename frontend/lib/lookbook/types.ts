/**
 * A Live Lookbook page, as the builder edits it and the public page renders
 * it. One JSON document: the page's theme, its cards in order, and the words
 * a link preview shows.
 *
 * The backend stores it as it is sent (backend/src/services/lookbookDesign.js
 * checks sizes, pictures, colours and links, not each field), so the shapes
 * here are the contract. A field added later must have a default in
 * `lib/lookbook/defaults.ts`, which is what opens an older page safely.
 *
 * Naming rules the backend relies on: a colour field ends in `Color` and is
 * a hex value; a picture's stored addresses are `url`, `thumbnailUrl` and
 * `posterUrl`.
 */

export const LOOKBOOK_VERSION = 1 as const;

/* ── Pictures and clips ──────────────────────────────────────────────── */

export type MediaKind = "image" | "video";

/** One stored picture or clip. Always one of Sparkle's own R2 urls. */
export type Media = {
  kind: MediaKind;
  /** The full original: what zoom shows, and what a large slot loads. */
  url: string;
  /** The 640px copy: what the builder and small slots show. Images only. */
  thumbnailUrl?: string | null;
  /** A still for a clip, shown until it plays. */
  posterUrl?: string | null;
  width?: number | null;
  height?: number | null;
  /**
   * The picture may be see-through (a cutout). Its thumbnail was flattened
   * onto white when it was made, so such a picture is always shown from its
   * original, or a dark page would get white boxes.
   */
  alpha?: boolean;
  alt?: string;
};

/* ── The page's look ─────────────────────────────────────────────────── */

export type FontId =
  | "playfair"
  | "cormorant"
  | "bodoni"
  | "dm-serif"
  | "cinzel"
  | "marcellus"
  | "italiana"
  | "great-vibes"
  | "pinyon"
  | "inter"
  | "montserrat"
  | "josefin"
  | "jost"
  | "bebas";

export type LogoPlacement = "left" | "center" | "right" | "hidden";
export type PageBackground = "solid" | "glow" | "gradient";

export type LookbookTheme = {
  /** Which starting design the page came from ("blank" for now). Kept for a future library of ready-made designs. */
  templateId: string;

  bgColor: string;
  surfaceColor: string;
  textColor: string;
  headingColor: string;
  mutedColor: string;
  accentColor: string;
  /** Words on an accent-coloured button. */
  accentTextColor: string;
  /** How the page background is drawn: flat, a soft glow at the top, or a gentle gradient. */
  background: PageBackground;

  /** The hero's big title. */
  displayFont: FontId;
  /** Every other card's title. */
  headingFont: FontId;
  bodyFont: FontId;
  headingUppercase: boolean;
  /** Letter spacing for titles, in em. */
  headingTracking: number;
  headingWeight: number;
  /** Body text size, in px, before a card's own text size. */
  baseSize: number;

  /** Default corner radius for cards and pictures, in px. A card can set its own. */
  radius: number;
  /** Space between cards, in px. */
  gap: number;
  /** How wide content gets on a large screen, in px. */
  maxWidth: number;

  logo: Media | null;
  /** Logo height, in px. */
  logoSize: number;
  logoPlacement: LogoPlacement;
  /** Shown in the header beside the logo, or alone when there is none. */
  brandName: string;
};

/* ── Cards ───────────────────────────────────────────────────────────── */

export type CardType =
  | "hero"
  | "gallery"
  | "spotlight"
  | "before_after"
  | "video"
  | "story"
  | "specs"
  | "contact"
  | "spacer";

export type Align = "left" | "center" | "right";
/** Edge to edge, the page's content width, or a narrow reading column. */
export type CardWidth = "full" | "wide" | "narrow";
/** "whole" shows every pixel of the picture; "fill" covers the frame and may trim edges. */
export type Fit = "whole" | "fill";
export type Aspect = "auto" | "1:1" | "4:5" | "3:4" | "2:3" | "3:2" | "16:9" | "9:16";
export type CardBackground = "none" | "surface" | "accent" | "custom";

export type CardStyle = {
  /** The card's layout — each card type has its own list (see VARIANTS). */
  variant: string;
  align: Align;
  width: CardWidth;
  /** Padding inside the card, in px. */
  paddingY: number;
  paddingX: number;
  /** Extra space above the card, on top of the page's gap. */
  spaceAbove: number;
  /** Corner radius in px; null follows the page's. */
  radius: number | null;
  background: CardBackground;
  bgColor: string | null;
  textColor: string | null;
  headingColor: string | null;
  /** Multiplies every text size on the card. */
  textScale: number;
  fit: Fit;
  aspect: Aspect;
  /** A tint laid over pictures under text, 0–0.9. */
  overlay: number;
  overlayColor: string | null;
};

export type AnimationType = "none" | "fade" | "slide" | "zoom" | "parallax";
export type SlideDirection = "up" | "down" | "left" | "right";

export type CardAnimation = {
  type: AnimationType;
  direction: SlideDirection;
  /** Seconds the entrance takes — the "speed". */
  duration: number;
  /** Seconds before it starts. */
  delay: number;
  /** Parallax only: how far the picture drifts, 0–1. */
  strength: number;
};

type CardBase<T extends CardType> = {
  id: string;
  type: T;
  /** Kept in the builder, left off the public page. */
  hidden?: boolean;
  style: CardStyle;
  animation: CardAnimation;
};

export type HeroHeight = "screen" | "tall" | "medium" | "auto";
export type HeroButtonTarget = "next" | "contact" | "none";

export type HeroCard = CardBase<"hero"> & {
  media: Media | null;
  eyebrow: string;
  title: string;
  subtitle: string;
  height: HeroHeight;
  buttonLabel: string;
  buttonTarget: HeroButtonTarget;
};

export type GalleryItem = { id: string; media: Media | null; caption: string };

export type GalleryCard = CardBase<"gallery"> & {
  eyebrow: string;
  title: string;
  caption: string;
  items: GalleryItem[];
  /** Columns on a large screen. */
  columns: number;
  /** Columns on a phone. */
  mobileColumns: number;
  showCaptions: boolean;
};

export type SpotlightDetail = { id: string; label: string; value: string };

export type SpotlightCard = CardBase<"spotlight"> & {
  media: Media | null;
  eyebrow: string;
  title: string;
  description: string;
  details: SpotlightDetail[];
  price: string;
  showPrice: boolean;
};

export type BeforeAfterCard = CardBase<"before_after"> & {
  before: Media | null;
  after: Media | null;
  beforeLabel: string;
  afterLabel: string;
  title: string;
  caption: string;
  /** Where the divider starts, 0–100. */
  start: number;
};

export type VideoCard = CardBase<"video"> & {
  media: Media | null;
  title: string;
  caption: string;
  autoplay: boolean;
  loop: boolean;
  showControls: boolean;
};

export type StoryCard = CardBase<"story"> & {
  eyebrow: string;
  title: string;
  body: string;
  signature: string;
};

export type SpecRow = { id: string; name: string; detail: string; price: string };

export type SpecsCard = CardBase<"specs"> & {
  title: string;
  caption: string;
  nameLabel: string;
  detailLabel: string;
  priceLabel: string;
  rows: SpecRow[];
  showPrices: boolean;
  note: string;
};

export type ContactKind = "whatsapp" | "email" | "phone" | "link";

export type ContactButton = {
  id: string;
  kind: ContactKind;
  label: string;
  /** A phone number, an email address or a web address, by kind. */
  value: string;
  /** WhatsApp and email: the message the client's app opens with. */
  message: string;
};

export type ContactCard = CardBase<"contact"> & {
  eyebrow: string;
  title: string;
  body: string;
  buttons: ContactButton[];
  /** Also keep the first button floating at the bottom of the screen. */
  floating: boolean;
};

export type SpacerCard = CardBase<"spacer"> & {
  /** Height of the space, in px. */
  height: number;
};

export type LookbookCard =
  | HeroCard
  | GalleryCard
  | SpotlightCard
  | BeforeAfterCard
  | VideoCard
  | StoryCard
  | SpecsCard
  | ContactCard
  | SpacerCard;

export type CardOf<T extends CardType> = Extract<LookbookCard, { type: T }>;

/** What a link preview (WhatsApp, iMessage) and the browser tab say. Empty falls back to the lookbook's name. */
export type LookbookMeta = { title: string; description: string };

export type LookbookDesign = {
  version: typeof LOOKBOOK_VERSION;
  theme: LookbookTheme;
  cards: LookbookCard[];
  meta: LookbookMeta;
};

/* ── What each card type offers ──────────────────────────────────────── */

export const CARD_LABELS: Record<CardType, string> = {
  hero: "Hero",
  gallery: "Gallery",
  spotlight: "Spotlight",
  before_after: "Before / after",
  video: "Turntable / video",
  story: "Story",
  specs: "Specs & prices",
  contact: "Contact",
  spacer: "Spacer / divider",
};

export const CARD_HINTS: Record<CardType, string> = {
  hero: "A big picture or clip with the collection's name",
  gallery: "A grid or carousel; tap any photo to zoom",
  spotlight: "One piece, large, with its details",
  before_after: "Drag to compare two photos",
  video: "An Image to Video turntable, or any clip",
  story: "A paragraph, a quote or two columns of text",
  specs: "A table of pieces, with prices shown or hidden",
  contact: "WhatsApp, email and phone buttons",
  spacer: "Breathing room, a line or an ornament",
};

/** Layout variants per card type, in the order the inspector offers them. */
export const VARIANTS: { [T in CardType]: { id: string; label: string }[] } = {
  hero: [
    { id: "overlay", label: "Overlay" },
    { id: "split", label: "Split" },
    { id: "stacked", label: "Stacked" },
    { id: "framed", label: "Framed" },
  ],
  gallery: [
    { id: "grid", label: "Grid" },
    { id: "masonry", label: "Masonry" },
    { id: "carousel", label: "Carousel" },
    { id: "editorial", label: "Editorial" },
  ],
  spotlight: [
    { id: "image-left", label: "Photo left" },
    { id: "image-right", label: "Photo right" },
    { id: "image-top", label: "Photo on top" },
    { id: "centered", label: "Centred" },
  ],
  before_after: [
    { id: "slider", label: "Slider" },
    { id: "side-by-side", label: "Side by side" },
  ],
  video: [
    { id: "full", label: "Full width" },
    { id: "framed", label: "Framed" },
    { id: "phone", label: "Phone" },
  ],
  story: [
    { id: "classic", label: "Classic" },
    { id: "quote", label: "Quote" },
    { id: "columns", label: "Two columns" },
    { id: "dropcap", label: "Drop cap" },
  ],
  specs: [
    { id: "table", label: "Table" },
    { id: "list", label: "List" },
    { id: "cards", label: "Cards" },
  ],
  contact: [
    { id: "stacked", label: "Stacked" },
    { id: "inline", label: "In a row" },
    { id: "panel", label: "Panel" },
  ],
  spacer: [
    { id: "space", label: "Space" },
    { id: "line", label: "Line" },
    { id: "ornament", label: "Ornament" },
    { id: "dots", label: "Dots" },
  ],
};

/** The card types that hold pictures, and so have fit, aspect and overlay settings. */
export const MEDIA_CARDS: CardType[] = ["hero", "gallery", "spotlight", "before_after", "video"];
