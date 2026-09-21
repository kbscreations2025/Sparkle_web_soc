import type { AffinityItem } from "./api";

/**
 * Affinity's shared vocabulary — the catalog's shape, and the palette it is
 * printed in.
 *
 * The colours are sampled from the customer's own deck and are deliberately
 * NOT theme tokens: the screen preview, the PDF and the PPTX all have to
 * match one fixed reference, and a palette that flipped with the app's
 * light/dark setting would make the preview a lie about the export.
 */
export const DECK = {
  cream: "#F7F2EC",
  borderGold: "#B4A794",
  titleGold: "#6B5D42",
  ink: "#46423C",
  labelGray: "#646464",
} as const;

/** 3 columns × 2 rows — matches how the PPTX lays a slide out. */
export const PER_SLIDE = 6;

/** One piece being assembled: its hero photo, and its own production sheet. */
export type AffinityPiece = {
  id: string;
  /** Data URI while being uploaded; an R2 url once the kit has been saved. */
  image: string;
  sheetImages: string[];
  sheetExcelText: string[];
  /**
   * The designer's initial, used as the prefix for a New Ideation code
   * ("R-1"). Only meaningful for a piece with no production sheet — one with
   * a sheet is an existing style and carries its own printed code.
   */
  designerInitial: string;
};

/**
 * Whether a piece has any production-sheet material at all.
 *
 * This single predicate is what splits the catalog in two, and it has to
 * agree exactly with the backend's `hasProductionSheet` — the model is told
 * not to describe a piece without a sheet, so a piece the two disagree about
 * would be filed under "New Ideation" while carrying an invented spec.
 */
export function hasProductionSheet(piece?: AffinityPiece) {
  return Boolean(piece && (piece.sheetImages.length > 0 || piece.sheetExcelText.length > 0));
}

export function newPiece(): AffinityPiece {
  return {
    id: crypto.randomUUID(),
    image: "",
    sheetImages: [],
    sheetExcelText: [],
    designerInitial: "",
  };
}

/** One catalog entry paired with the piece it describes. */
export type DeckEntry = { item: AffinityItem; index: number; piece?: AffinityPiece };

/**
 * Splits the catalog the way the deck presents it: manufactured pieces with
 * documented specs first, then the concepts.
 */
export function splitEntries(items: AffinityItem[], pieces: AffinityPiece[]) {
  const entries: DeckEntry[] = items.map((item, index) => ({
    item,
    index,
    piece: pieces[item.index] ?? pieces[index],
  }));

  return {
    existing: entries.filter((entry) => hasProductionSheet(entry.piece)),
    ideation: entries.filter((entry) => !hasProductionSheet(entry.piece)),
  };
}

/** Breaks a section into slide-sized chunks. */
export function toSlides(entries: DeckEntry[]) {
  const slides: DeckEntry[][] = [];
  for (let start = 0; start < entries.length; start += PER_SLIDE) {
    slides.push(entries.slice(start, start + PER_SLIDE));
  }
  return slides;
}

/** The code shown under a card when the model read none off its sheet. */
export function sourceCodeFallback(entry: DeckEntry, section: "existing" | "ideation") {
  if (section === "existing") return `Style ${entry.index + 1}`;
  return `${entry.piece?.designerInitial || "R"}-${entry.index + 1}`;
}

/**
 * Where a card starts before anyone drags it. After a drag the item's own
 * `width`/`height` take over, free of any step.
 */
export const DEFAULT_CARD_SIZE = {
  sm: { w: 170, h: 170 },
  md: { w: 190, h: 340 },
  lg: { w: 360, h: 340 },
} as const;

export const CARD_MIN = 90;
export const CARD_MAX = 620;

export function clampCard(width: number, height: number) {
  return {
    w: Math.min(CARD_MAX, Math.max(CARD_MIN, width)),
    h: Math.min(CARD_MAX, Math.max(CARD_MIN, height)),
  };
}
