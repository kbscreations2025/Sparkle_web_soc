"use client";

import { SLIDE_H, SLIDE_W, imageElement, shapeElement, textElement, uid, type DeckDesign, type DesignElement, type DesignSlide } from "./deckDesign";
import { fitSize, heightAt, type OutlineSlide, type PresentationOutline } from "./presentation";
import { readPptxStructure, type Box, type Crop, type PptxMedia, type PptxParagraph, type PptxTable, type PptxText } from "./pptxStructure";

/**
 * "Redesign my slides": the deck someone uploaded, every word exactly as they
 * wrote it and every picture as it was, laid out again in the house proposal
 * style. Ivory pages, a gold side rule, framed pictures and white product
 * cards, each with its code in gold and its specs underneath.
 *
 * Nothing here writes words. A model told to keep the text still tidies it:
 * it capitalises a code, shortens a spec line, invents a tagline. The
 * reference redesign this style comes from did all three. Each text box is
 * read out of the file (pptxStructure.ts) and recognised by where it sits: a
 * short code under a picture is that picture's code, the lines under the code
 * are its specs, and the big text at the top is the title. Then each is placed
 * exactly once, as written.
 *
 * A description ("slides 1, 2, 6, 10 and 14 are concept slides; the pencil
 * sketches are background drama") is read by a model into a `RedesignPlan`:
 * which slides open a section, what each picture is for, the colours. The plan
 * has no field for words, so it can only change the arrangement. The deck is
 * read once into a `RedesignSource` and saved with it, so it can be laid out
 * again from a new plan at any time without the original file.
 */

// ── What a redesign is laid out from ────────────────────────────────────────

/** A picture as placed on a slide of the original. */
export type SourcePicture = {
  id: string;
  box: Box | null;
  /** Its `pieceIndex`: which of the deck's stored pictures it shows (the same ring twice is stored once). */
  piece: number;
  /** Width ÷ height of what shows, after the original's crop. */
  aspect: number;
  /** How much of it is see-through, 0–1. Pencil sketches on transparent backgrounds score high. */
  clear: number;
};

export type SourceSlide = { number: number; texts: PptxText[]; pictures: SourcePicture[]; tables: PptxTable[]; notes: string };

/**
 * Everything a redesign is laid out from, kept with the saved deck. Words are
 * stored exactly as read; pictures by the index of the stored copy.
 */
export type RedesignSource = { version: 1; fileName: string; width: number; height: number; slides: SourceSlide[] };

/** Whether a stored value is a deck as `readRedesignSource` read it. */
export function isRedesignSource(value: unknown): value is RedesignSource {
  const source = value as RedesignSource | null;
  return Boolean(source && typeof source === "object" && source.version === 1 && typeof source.fileName === "string" && Array.isArray(source.slides));
}

// ── What a description can change ───────────────────────────────────────────

/**
 * What a picture is for on its page:
 *  · product — a main design, on a card; a code's picture always is one.
 *  · inspiration — a reference image, kept small in the top right corner.
 *  · decoration — a sketch used as background drama: frameless, at the side.
 *  · feature — a main picture: framed in a concept page's collage, a card of
 *    its own on a product page, framed on a page of pictures.
 */
export const PICTURE_ROLES = ["product", "inspiration", "decoration", "feature"] as const;
export type PictureRole = (typeof PICTURE_ROLES)[number];

export const REDESIGN_PALETTES = ["ivory", "champagne", "blush", "pearl", "emerald"] as const;
export type RedesignPalette = (typeof REDESIGN_PALETTES)[number];

export type RedesignPlan = {
  /** Set by the server when the plan is stored; a design records the plan it was laid out from. */
  id: string;
  /** Slides (numbered as in the original) that open a section with a concept page. */
  conceptSlides: number[];
  /** Picture id → role. Pictures not listed keep the role their place on the slide suggests. */
  roles: Record<string, PictureRole>;
  palette: RedesignPalette;
  /** Concept pages in the palette's light page colour, or its deep shade with light words. */
  conceptStyle: "light" | "dark";
  /** Product cards on a page, at most (1–8). */
  cardsPerPage: number;
  /** Every original slide number once, in the order the pages go. */
  order: number[];
};

/** A plan as stored or as a model wrote it, checked against the deck it is for. What can't be used is dropped. */
export function readPlan(value: unknown, source: RedesignSource): RedesignPlan | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const numbers = new Set(source.slides.map((slide) => slide.number));
  const ids = new Set(source.slides.flatMap((slide) => slide.pictures.map((picture) => picture.id)));
  const ints = (list: unknown) => (Array.isArray(list) ? list.map(Number).filter((n) => Number.isInteger(n) && numbers.has(n)) : []);

  const roles: Record<string, PictureRole> = {};
  const rawRoles = raw.roles && typeof raw.roles === "object" ? (raw.roles as Record<string, unknown>) : {};
  for (const [id, role] of Object.entries(rawRoles)) {
    if (ids.has(id) && PICTURE_ROLES.includes(role as PictureRole)) roles[id] = role as PictureRole;
  }
  // Every slide exactly once: a slide the plan forgot goes at the end rather than missing.
  const order = [...new Set(ints(raw.order))];
  for (const slide of source.slides) if (!order.includes(slide.number)) order.push(slide.number);

  return {
    id: typeof raw.id === "string" ? raw.id : "",
    conceptSlides: [...new Set(ints(raw.conceptSlides))],
    roles,
    palette: REDESIGN_PALETTES.includes(raw.palette as RedesignPalette) ? (raw.palette as RedesignPalette) : "ivory",
    conceptStyle: raw.conceptStyle === "dark" ? "dark" : "light",
    cardsPerPage: Math.min(8, Math.max(1, Math.round(Number(raw.cardsPerPage) || 8))),
    order,
  };
}

// ── The house style ─────────────────────────────────────────────────────────

type Palette = { page: string; accent: string; ink: string; muted: string; rule: string; cardLine: string; deep: string; deepRule: string };

/** Ivory is the reference proposal's; the others are its alternatives, all light pages a pencil sketch shows on. */
const PALETTES: Record<RedesignPalette, Palette> = {
  ivory: { page: "#FBFAF8", accent: "#B59A72", ink: "#26211E", muted: "#756D66", rule: "#E6DED3", cardLine: "#EBE6DF", deep: "#1F1B17", deepRule: "#3A332C" },
  champagne: { page: "#F7F1E8", accent: "#A8834A", ink: "#2A2119", muted: "#7A6A58", rule: "#E8DCCB", cardLine: "#E9DFD0", deep: "#2A2119", deepRule: "#45392C" },
  blush: { page: "#FCF6F4", accent: "#B4776B", ink: "#2F2423", muted: "#7E6965", rule: "#EFDDD8", cardLine: "#F0E2DE", deep: "#33231F", deepRule: "#4C3731" },
  pearl: { page: "#F8F8F7", accent: "#7D8189", ink: "#1E2024", muted: "#6B6F77", rule: "#E3E4E6", cardLine: "#E6E7E9", deep: "#1C1E22", deepRule: "#363940" },
  emerald: { page: "#F6F8F6", accent: "#2F6E58", ink: "#14241D", muted: "#5A6B63", rule: "#DCE5DF", cardLine: "#DFE7E2", deep: "#10261D", deepRule: "#24402F" },
};

type Theme = {
  page: string;
  accent: string;
  ink: string;
  muted: string;
  rule: string;
  card: string;
  cardLine: string;
  concept: { page: string; ink: string; muted: string; rule: string; dark: boolean };
  heading: string;
  body: string;
};

function themeFor(plan: RedesignPlan | null): Theme {
  const p = PALETTES[plan?.palette ?? "ivory"];
  const dark = plan?.conceptStyle === "dark";
  return {
    page: p.page,
    accent: p.accent,
    ink: p.ink,
    muted: p.muted,
    rule: p.rule,
    card: "#FFFFFF",
    cardLine: p.cardLine,
    concept: dark ? { page: p.deep, ink: "#F7F2EA", muted: "#CDC4B8", rule: p.deepRule, dark: true } : { page: p.page, ink: p.ink, muted: p.muted, rule: p.rule, dark: false },
    heading: "Georgia",
    body: "Arial",
  };
}

/** Points to the editor's pixels: its 1280×720 page is PowerPoint's 13.33×7.5in at 96px an inch. */
const pt = (points: number) => Math.round((points / 0.75) * 100) / 100;

/** The content area of a page under the header, in the editor's pixels. */
const LEFT = 62;
const RIGHT = 1218;
const CONTENT_BOTTOM = 662;
/** Where background sketches stop: clear of the footer. */
const DECORATION_BOTTOM = 676;
const GAP = 14;
/** Product cards on a page unless a plan says otherwise; more continue on the next. */
const CARDS_PER_PAGE = 8;

// ── Reading a slide ─────────────────────────────────────────────────────────

/** A product code: "R-1", "R-27", "SKU 1042", "E12A". */
const CODE = /^[A-Za-z]{1,5}\s?[-–—_./#]?\s?\d{1,6}[A-Za-z]{0,3}$/;
/** Things whose tops are this close (inches) read as one row, left to right. */
const ROW_TOLERANCE = 0.6;
/** A picture this see-through (0–1) is a drawing or cut-out on a transparent background. */
const SKETCH_CLEAR = 0.4;

type Card = { picture: SourcePicture | null; code: PptxText | null; lines: PptxText[] };

/** How a slide of the original reads: its title, its words, which picture each code labels. */
type Reading = {
  slide: SourceSlide;
  title: PptxText | null;
  /** Text that is neither the title nor on a card, in reading order. */
  body: PptxText[];
  /** Pictures labelled by a code (or, on a slide without codes, a caption), with their lines. */
  cards: Card[];
  /** Every other picture but the corner one, in reading order. */
  loose: SourcePicture[];
  /** The small picture tucked into the top right corner. */
  thumbnail: SourcePicture | null;
  tables: PptxTable[];
};

const textOf = (text: PptxText) => text.paragraphs.map((paragraph) => paragraph.text).join("\n");
const lineOf = (paragraph: PptxParagraph) => (paragraph.bullet ? `• ${paragraph.text}` : paragraph.text);
const bodyOf = (texts: PptxText[]) => texts.flatMap((text) => text.paragraphs.map(lineOf)).join("\n");
const sizeOf = (text: PptxText) => Math.max(0, ...text.paragraphs.map((paragraph) => paragraph.size ?? 0));
const middle = (box: Box) => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 });
const isTitlePlaceholder = (text: PptxText) => text.placeholder === "title" || text.placeholder === "ctrTitle";
const isCode = (text: PptxText) =>
  !isTitlePlaceholder(text) && text.paragraphs.length === 1 && text.paragraphs[0].text.trim().length <= 14 && CODE.test(text.paragraphs[0].text.trim());
/** Short, small text: a spec line or a caption, not a paragraph. */
const isLabel = (text: PptxText) =>
  !isTitlePlaceholder(text) && (sizeOf(text) === 0 || sizeOf(text) <= 16) && text.paragraphs.length <= 5 && textOf(text).length <= 200;
const pad2 = (n: number) => String(n).padStart(2, "0");

/** Top to bottom in rows, each row left to right: how a person reads a slide. */
function readingOrder<T>(items: T[], boxOf: (item: T) => Box | null): T[] {
  const placed = items.map((item, index) => ({ item, index, box: boxOf(item) }));
  placed.sort((a, b) => (a.box?.y ?? Infinity) - (b.box?.y ?? Infinity) || a.index - b.index);
  const rows: (typeof placed)[] = [];
  for (const entry of placed) {
    const row = rows[rows.length - 1];
    if (row && entry.box && row[0].box && Math.abs(entry.box.y - row[0].box.y) < ROW_TOLERANCE) row.push(entry);
    else rows.push([entry]);
  }
  return rows.flatMap((row) => row.sort((a, b) => (a.box?.x ?? 0) - (b.box?.x ?? 0) || a.index - b.index)).map((entry) => entry.item);
}

/** The slide's title: its title placeholder, or failing that the largest short text near the top. */
function findTitle(slide: SourceSlide, source: RedesignSource) {
  const placeholder = slide.texts.find(isTitlePlaceholder);
  if (placeholder) return placeholder;
  const candidates = slide.texts.filter(
    (text) => !isCode(text) && sizeOf(text) >= 24 && (!text.box || text.box.y < source.height * 0.4) && textOf(text).length <= 140
  );
  candidates.sort((a, b) => sizeOf(b) - sizeOf(a) || (a.box?.y ?? 0) - (b.box?.y ?? 0));
  return candidates[0] ?? null;
}

/** A small picture tucked into the top right corner: the slide's reference image. */
function findThumbnail(slide: SourceSlide, source: RedesignSource) {
  const corner = slide.pictures.filter(
    ({ box }) => box && Math.max(box.w, box.h) <= 1.8 && box.w * box.h <= 2.6 && box.x + box.w >= source.width - 0.8 && box.y <= 0.6
  );
  corner.sort((a, b) => b.box!.x + b.box!.w - (a.box!.x + a.box!.w) || a.box!.y - b.box!.y);
  return corner[0] ?? null;
}

/**
 * Each code with the picture it labels: the one it sits just under (or, less
 * often, just over), centred on it. Matched closest pair first, one picture
 * per code, so two rings side by side can't both claim the same code.
 */
function pairCodes(codes: PptxText[], pictures: SourcePicture[]) {
  const pairs: { code: PptxText; picture: SourcePicture; score: number }[] = [];
  for (const code of codes) {
    if (!code.box) continue;
    const centre = middle(code.box).x;
    for (const picture of pictures) {
      const box = picture.box;
      if (!box) continue;
      const dx = Math.abs(centre - (box.x + box.w / 2));
      if (dx > Math.max(box.w * 0.75, 0.9)) continue;
      const below = code.box.y - (box.y + box.h);
      const above = box.y - (code.box.y + code.box.h);
      if (below >= -0.5 && below <= 1.2) pairs.push({ code, picture, score: dx + Math.abs(below) * 1.5 });
      else if (above >= -0.3 && above <= 0.8) pairs.push({ code, picture, score: dx + Math.abs(above) * 1.5 + 0.3 });
    }
  }
  pairs.sort((a, b) => a.score - b.score);
  const matched = new Map<string, SourcePicture>();
  const taken = new Set<string>();
  for (const pair of pairs) {
    if (matched.has(pair.code.id) || taken.has(pair.picture.id)) continue;
    matched.set(pair.code.id, pair.picture);
    taken.add(pair.picture.id);
  }
  return matched;
}

/** Spec lines onto the card they sit under. Returns the texts that belong to no card. */
function attachLines(cards: Card[], texts: PptxText[]) {
  const left: PptxText[] = [];
  for (const text of texts) {
    if (!text.box || !isLabel(text)) {
      left.push(text);
      continue;
    }
    const box = text.box;
    const centre = middle(box).x;
    let best: { card: Card; score: number } | null = null;
    for (const card of cards) {
      const anchor = card.code?.box ?? card.picture?.box;
      if (!anchor) continue;
      // Under the card's lowest part, whichever of code and picture that is.
      const bottom = Math.max(anchor.y + anchor.h, card.picture?.box ? card.picture.box.y + card.picture.box.h : 0);
      const dx = Math.abs(centre - middle(anchor).x);
      const dy = box.y - bottom;
      if (dx > Math.max(box.w * 0.6, anchor.w, 1.2) || dy < -0.35 || dy > 1.2) continue;
      const score = dx + Math.abs(dy) * 2;
      if (!best || score < best.score) best = { card, score };
    }
    if (best) best.card.lines.push(text);
    else left.push(text);
  }
  return left;
}

/** For a slide with no codes: short captions directly under pictures make those pictures cards. */
function captionCards(pictures: SourcePicture[], texts: PptxText[]) {
  const cards = new Map<string, Card>();
  for (const text of texts) {
    if (!text.box || !isLabel(text)) continue;
    const box = text.box;
    const centre = middle(box).x;
    let best: { picture: SourcePicture; score: number } | null = null;
    for (const picture of pictures) {
      const p = picture.box;
      if (!p) continue;
      const dy = box.y - (p.y + p.h);
      if (dy < -0.3 || dy > 0.8 || centre < p.x - 0.2 || centre > p.x + p.w + 0.2) continue;
      const score = Math.abs(dy) + Math.abs(centre - middle(p).x) / 2;
      if (!best || score < best.score) best = { picture, score };
    }
    if (!best) continue;
    const card = cards.get(best.picture.id) ?? { picture: best.picture, code: null, lines: [] };
    card.lines.push(text);
    cards.set(best.picture.id, card);
  }
  return [...cards.values()];
}

function classify(slide: SourceSlide, source: RedesignSource): Reading {
  const title = findTitle(slide, source);
  const thumbnail = findThumbnail(slide, source);
  const pictures = slide.pictures.filter((picture) => picture !== thumbnail);
  const texts = slide.texts.filter((text) => text !== title);

  let cards: Card[] = [];
  const codes = texts.filter(isCode);
  const codePictures = pairCodes(codes, pictures);
  for (const code of codes) {
    const picture = codePictures.get(code.id);
    if (picture) cards.push({ picture, code, lines: [] });
  }

  const onCards = new Set(cards.map((card) => card.code!.id));
  let free = texts.filter((text) => !onCards.has(text.id));
  if (cards.length) {
    free = attachLines(cards, free);
  } else {
    const captioned = captionCards(pictures, free);
    // One captioned picture is a picture with a caption, not a product grid.
    if (captioned.length >= 2) {
      cards = captioned;
      const used = new Set(cards.flatMap((card) => card.lines.map((line) => line.id)));
      free = free.filter((text) => !used.has(text.id));
    }
  }

  const carded = new Set(cards.map((card) => card.picture?.id));
  return {
    slide,
    title,
    body: readingOrder(free, (text) => text.box),
    cards: readingOrder(cards, (card) => card.picture?.box ?? card.code?.box ?? null).map((card) => ({
      ...card,
      lines: readingOrder(card.lines, (line) => line.box),
    })),
    loose: readingOrder(
      pictures.filter((picture) => !carded.has(picture.id)),
      (picture) => picture.box
    ),
    thumbnail,
    tables: slide.tables,
  };
}

type RoleOf = (picture: SourcePicture) => PictureRole;

/**
 * Every picture's part on its page: what the plan says, or else what its place
 * on the original suggests. A picture labelled by a code or caption stays that
 * label's card whatever the plan says: its words belong with it.
 */
function rolesFor(readings: Reading[], plan: RedesignPlan | null): RoleOf {
  const roles = new Map<string, PictureRole>();
  for (const reading of readings) {
    const carded = new Set(reading.cards.map((card) => card.picture?.id));
    const hasCodes = reading.cards.some((card) => card.code);
    for (const picture of reading.slide.pictures) {
      if (carded.has(picture.id)) roles.set(picture.id, "product");
      else if (plan?.roles[picture.id]) roles.set(picture.id, plan.roles[picture.id]);
      else if (reading.thumbnail?.id === picture.id) roles.set(picture.id, "inspiration");
      // A drawing on a transparent background beside coded designs: the original's background sketches.
      else if (hasCodes && picture.clear >= SKETCH_CLEAR) roles.set(picture.id, "decoration");
      else roles.set(picture.id, "feature");
    }
  }
  return (picture) => roles.get(picture.id) ?? "feature";
}

type Kind = "products" | "concept" | "gallery" | "tables" | "empty";

function kindOf(reading: Reading, roleOf: RoleOf, conceptSlides: Set<number> | null): Kind {
  if (reading.cards.length) return "products";
  const pictures = reading.thumbnail ? [...reading.loose, reading.thumbnail] : reading.loose;
  if (conceptSlides?.has(reading.slide.number) && (reading.title || reading.body.length || pictures.length)) return "concept";
  if (reading.body.length) return "concept";
  if (reading.title) {
    if (!pictures.length && reading.tables.length) return "tables";
    // A title over a wall of pictures reads better as a gallery than squeezed beside them.
    return pictures.length > 6 ? "gallery" : "concept";
  }
  if (pictures.some((picture) => roleOf(picture) === "product")) return "products";
  if (pictures.length) return "gallery";
  return reading.tables.length ? "tables" : "empty";
}

/** A page's pictures that aren't on a card, sorted by what they're for. */
function sortPictures(reading: Reading, roleOf: RoleOf) {
  const all = reading.thumbnail ? [...reading.loose, reading.thumbnail] : reading.loose;
  const of = (...roles: PictureRole[]) => all.filter((picture) => roles.includes(roleOf(picture)));
  const inspiration = of("inspiration");
  return {
    // At most six fit the corner; any more are shown with the main pictures.
    corner: inspiration.slice(0, 6),
    main: [...of("product", "feature"), ...inspiration.slice(6)],
    decorations: of("decoration"),
  };
}

// ── Pictures ────────────────────────────────────────────────────────────────

/** A crop that leaves something to show, or none at all. */
function usableCrop(crop: Crop | null): Crop {
  if (!crop || crop.l + crop.r >= 0.98 || crop.t + crop.b >= 0.98) return { l: 0, t: 0, r: 0, b: 0 };
  return crop;
}

const isCropped = (crop: Crop) => crop.l > 0 || crop.t > 0 || crop.r > 0 || crop.b > 0;

function readAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * One stored picture of the deck, and how see-through it is. A picture used
 * whole is the file's own bytes, untouched. A cropped one is cut out at full
 * resolution: losslessly as PNG, or as a near-lossless JPEG if it was a JPEG
 * photo, where a PNG of the same photo would be several times the size.
 */
async function renderPiece(media: PptxMedia, crop: Crop) {
  const blob = new Blob([media.bytes as BlobPart], { type: media.mimeType });
  const bitmap = await createImageBitmap(blob);
  const sx = Math.round(bitmap.width * crop.l);
  const sy = Math.round(bitmap.height * crop.t);
  const sw = Math.max(1, Math.round(bitmap.width * (1 - crop.l - crop.r)));
  const sh = Math.max(1, Math.round(bitmap.height * (1 - crop.t - crop.b)));

  let clear = 0;
  if (media.mimeType !== "image/jpeg") {
    const probe = document.createElement("canvas");
    probe.width = 48;
    probe.height = 48;
    const context = probe.getContext("2d", { willReadFrequently: true })!;
    context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, 48, 48);
    const pixels = context.getImageData(0, 0, 48, 48).data;
    let see = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] < 24) see += 1;
    clear = see / (48 * 48);
  }

  let src: string;
  // BMP is redrawn as PNG (lossless); browsers show it, but not every viewer does.
  if (!isCropped(crop) && media.mimeType !== "image/bmp") {
    src = await readAsDataUrl(blob);
  } else {
    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    canvas.getContext("2d")!.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
    const jpeg = media.mimeType === "image/jpeg";
    const cut = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, jpeg ? "image/jpeg" : "image/png", jpeg ? 0.95 : undefined));
    src = cut ? await readAsDataUrl(cut) : canvas.toDataURL("image/png");
  }
  bitmap.close();
  return { src, clear };
}

/**
 * Reads a PowerPoint into what a redesign is laid out from, and the pictures
 * to store with it: each distinct picture once (the same picture with the
 * same crop is one), in the order the deck first shows them.
 */
export async function readRedesignSource(file: File) {
  const deck = await readPptxStructure(file);
  const pieces = new Map<string, number>();
  const toRender: { media: PptxMedia; crop: Crop; slide: number }[] = [];

  const slides: SourceSlide[] = deck.slides.map((slide) => ({
    number: slide.number,
    texts: slide.texts,
    tables: slide.tables,
    notes: slide.notes,
    pictures: slide.pictures.map((picture) => {
      const media = deck.media.get(picture.media)!;
      const crop = usableCrop(picture.crop);
      const key = `${picture.media}|${crop.l},${crop.t},${crop.r},${crop.b}`;
      let piece = pieces.get(key);
      if (piece === undefined) {
        piece = toRender.length;
        pieces.set(key, piece);
        toRender.push({ media, crop, slide: slide.number });
      }
      const w = media.width * (1 - crop.l - crop.r);
      const h = media.height * (1 - crop.t - crop.b);
      return { id: picture.id, box: picture.box, piece, aspect: w > 0 && h > 0 ? w / h : 1, clear: 0 };
    }),
  }));

  const images: { src: string; label: string }[] = [];
  const clearness: number[] = [];
  for (const { media, crop, slide } of toRender) {
    const { src, clear } = await renderPiece(media, crop);
    images.push({ src, label: `${deck.fileName} · slide ${slide}` });
    clearness.push(clear);
  }
  for (const slide of slides) for (const picture of slide.pictures) picture.clear = Math.round(clearness[picture.piece] * 100) / 100;

  const source: RedesignSource = { version: 1, fileName: deck.fileName, width: deck.width, height: deck.height, slides };
  return { source, images, skipped: deck.skipped };
}

// ── Building blocks ─────────────────────────────────────────────────────────

type Section = { number: number; title: string; id: string };
type Ctx = { theme: Theme; section: Section; name: string; roleOf: RoleOf; cardsPerPage: number; source: RedesignSource };

/** One page of the result, before the running header, footer and page number are added. */
type Built = {
  elements: DesignElement[];
  /** Drawn under everything, the running header included: background sketches. */
  under?: DesignElement[];
  section: Section;
  /** A dark concept page. */
  dark?: boolean;
  layout: OutlineSlide["layout"];
  title: string;
  body?: string;
  table?: string[][];
  notes?: string;
};

const round = (box: Box): Box => ({ x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h) });

/** A picture on a white mount with a hairline border, whole (never cropped to fit). */
function framed(picture: SourcePicture, box: Box, pad: number, theme: Theme): DesignElement[] {
  const groupId = uid();
  return [
    shapeElement({ ...round(box), fill: theme.card, stroke: theme.cardLine, strokeWidth: 1, groupId, name: "Frame" }),
    imageElement({
      ...round({ x: box.x + pad, y: box.y + pad, w: box.w - pad * 2, h: box.h - pad * 2 }),
      pieceIndex: picture.piece,
      fit: "contain",
      groupId,
      name: "Picture",
    }),
  ];
}

/**
 * Pictures as justified rows filling `box`: every way of breaking the
 * sequence into rows is tried (a slide has a handful of pictures, so that is
 * cheap), and the one showing the most picture, without leaving any of them
 * tiny, wins. Order is kept. Each tile has its picture's own proportions.
 */
function justify(aspects: number[], box: Box, gap: number): Box[] {
  const n = aspects.length;
  if (n === 0) return [];
  if (n > 12) return uniformGrid(n, box, gap);

  let best: { score: number; rows: number[][]; s: number; sums: number[] } | null = null;
  for (let mask = 0; mask < 1 << (n - 1); mask++) {
    const rows: number[][] = [[0]];
    for (let i = 1; i < n; i++) {
      if (mask & (1 << (i - 1))) rows.push([i]);
      else rows[rows.length - 1].push(i);
    }
    if (rows.length > 4) continue;
    const sums = rows.map((row) => row.reduce((sum, i) => sum + aspects[i], 0));
    // `s` is every row's picture width without its gaps; each row is s / sum tall.
    const widest = Math.min(...rows.map((row) => box.w - gap * (row.length - 1)));
    const tallest = (box.h - gap * (rows.length - 1)) / sums.reduce((total, sum) => total + 1 / sum, 0);
    const s = Math.min(widest, tallest);
    if (s <= 0) continue;
    const areas = rows.flatMap((row, r) => row.map((i) => (s / sums[r]) ** 2 * aspects[i]));
    const total = areas.reduce((sum, area) => sum + area, 0);
    const score = total * Math.pow(Math.min(...areas) / Math.max(...areas), 0.25);
    if (!best || score > best.score) best = { score, rows, s, sums };
  }
  if (!best) return uniformGrid(n, box, gap);

  const heights = best.rows.map((_, r) => best!.s / best!.sums[r]);
  const blockH = heights.reduce((sum, h) => sum + h, 0) + gap * (best.rows.length - 1);
  const tiles: Box[] = new Array(n);
  let y = box.y + (box.h - blockH) / 2;
  best.rows.forEach((row, r) => {
    const h = heights[r];
    const rowW = row.reduce((sum, i) => sum + aspects[i] * h, 0) + gap * (row.length - 1);
    let x = box.x + (box.w - rowW) / 2;
    for (const i of row) {
      tiles[i] = { x, y, w: aspects[i] * h, h };
      x += aspects[i] * h + gap;
    }
    y += h + gap;
  });
  return tiles;
}

/** Equal cells, for more pictures than are worth arranging one by one. */
function uniformGrid(n: number, box: Box, gap: number): Box[] {
  const cols = Math.ceil(Math.sqrt((n * box.w) / box.h));
  const rows = Math.ceil(n / cols);
  const w = (box.w - gap * (cols - 1)) / cols;
  const h = (box.h - gap * (rows - 1)) / rows;
  return Array.from({ length: n }, (_, i) => ({ x: box.x + (i % cols) * (w + gap), y: box.y + Math.floor(i / cols) * (h + gap), w, h }));
}

/** Pictures framed and justified into `box`. */
function pictureWall(pictures: SourcePicture[], box: Box, gap: number, pad: number, theme: Theme) {
  const tiles = justify(
    pictures.map((picture) => picture.aspect),
    box,
    gap
  );
  return pictures.flatMap((picture, i) => framed(picture, tiles[i], pad, theme));
}

/**
 * Background sketches: frameless and large in a band down the side of the
 * page they sat on in the original, bleeding a little off its edge, the way
 * they filled the blank corners there. Returned apart from the rest so they
 * are drawn under everything, with how wide each side's band is, so the
 * content moves in to clear them.
 */
function sideDecorations(pictures: SourcePicture[], source: RedesignSource, top: number) {
  if (!pictures.length) return { elements: [] as DesignElement[], left: 0, right: 0 };
  const onLeft = (picture: SourcePicture) => Boolean(picture.box && picture.box.x + picture.box.w / 2 < source.width / 2);
  const left = pictures.filter(onLeft);
  const right = pictures.filter((picture) => !onLeft(picture));
  // Past two on one side they'd be too small to read as anything: some cross to the other side.
  while (left.length > 2 && left.length - right.length >= 2) right.push(left.pop()!);
  while (right.length > 2 && right.length - left.length >= 2) left.push(right.shift()!);

  const both = left.length > 0 && right.length > 0;
  const band = both ? 250 : 300;
  const elements: DesignElement[] = [];
  const place = (group: SourcePicture[], side: "left" | "right") => {
    const share = (DECORATION_BOTTOM - top) / group.length;
    group.forEach((picture, i) => {
      let h = share - (group.length > 1 ? 8 : 0);
      let w = h * picture.aspect;
      if (w > band + 16) {
        w = band + 16;
        h = w / picture.aspect;
      }
      const bleed = w * 0.08;
      const y = top + i * share + (share - h);
      elements.push(
        imageElement({
          ...round({ x: side === "right" ? SLIDE_W - w + bleed : -bleed, y, w, h }),
          pieceIndex: picture.piece,
          fit: "contain",
          name: "Background sketch",
        })
      );
    });
  };
  place(left, "left");
  place(right, "right");
  return { elements, left: left.length ? band : 0, right: right.length ? band : 0 };
}

/**
 * Where the cards go: one row up to three, then two rows, the second centred
 * under the first, the way the reference lays out five rings as three and two.
 */
function gridBoxes(count: number, region: Box): Box[] {
  const perRow = count <= 3 ? [count] : count === 4 ? [2, 2] : count <= 6 ? [3, count - 3] : [4, count - 4];
  const cols = Math.max(...perRow);
  const w = count === 1 ? Math.min(600, region.w) : (region.w - GAP * (cols - 1)) / cols;
  const h = (region.h - GAP * (perRow.length - 1)) / perRow.length;
  const boxes: Box[] = [];
  perRow.forEach((k, r) => {
    const rowW = k * w + GAP * (k - 1);
    const x0 = region.x + (region.w - rowW) / 2;
    for (let i = 0; i < k; i++) boxes.push(round({ x: x0 + i * (w + GAP), y: region.y + r * (h + GAP), w, h }));
  });
  return boxes;
}

/** Card text sizes, largest first; a grid steps down together when its longest spec won't fit. */
const CARD_TYPE = [
  { code: pt(15), first: pt(10), rest: pt(9) },
  { code: pt(13), first: pt(9), rest: pt(8.5) },
  { code: pt(12), first: pt(8), rest: pt(7.5) },
];
const CARD_LINE = 1.3;

type CardPart = { text: string; x: number; y: number; w: number; h: number; size: number; bold: boolean; color: string; name: string };

/**
 * A card's words, laid out under its picture: the code in the accent colour
 * at the left, the first spec line bold beside it, the rest of the lines
 * muted beneath. On a narrow card the code goes above instead of beside.
 * Positions are relative to the card's text area.
 */
function cardText(card: Card, cardW: number, step: number, theme: Theme) {
  const type = CARD_TYPE[step];
  const code = card.code ? textOf(card.code) : "";
  const paragraphs = card.lines.flatMap((line) => line.paragraphs);
  const first = paragraphs.length ? lineOf(paragraphs[0]) : "";
  const rest = paragraphs.slice(1).map(lineOf).join("\n");
  const inner = cardW - 42;
  const codeW = code ? Math.min(Math.round(inner * 0.4), Math.max(48, Math.ceil(code.length * type.code * 0.62) + 8)) : 0;
  const beside = Boolean(code) && inner - codeW - 12 >= 140;
  const textX = beside ? codeW + 12 : 0;
  const textW = beside ? inner - codeW - 12 : inner;
  const codeH = Math.ceil(type.code * 1.2) + 2;

  const parts: CardPart[] = [];
  if (code) parts.push({ text: code, x: 0, y: 0, w: beside ? codeW : inner, h: codeH, size: type.code, bold: true, color: theme.accent, name: "Code" });
  let y = code && !beside ? codeH + 4 : 0;
  if (first) {
    const h = heightAt(first, textW, type.first, theme.body, CARD_LINE);
    parts.push({ text: first, x: textX, y, w: textW, h, size: type.first, bold: true, color: theme.ink, name: "Spec" });
    y += h + 1;
  }
  if (rest) {
    const h = heightAt(rest, textW, type.rest, theme.body, CARD_LINE);
    parts.push({ text: rest, x: textX, y, w: textW, h, size: type.rest, bold: false, color: theme.muted, name: "Spec details" });
    y += h;
  }
  return { parts, height: Math.max(code ? codeH : 0, y) };
}

function cardElements(card: Card, box: Box, band: number, parts: CardPart[], theme: Theme): DesignElement[] {
  const groupId = uid();
  const elements: DesignElement[] = [
    shapeElement({ ...box, fill: theme.card, stroke: theme.cardLine, strokeWidth: 1, groupId, name: "Card" }),
    shapeElement({ x: box.x, y: box.y, w: 5, h: box.h, fill: theme.accent, groupId, name: "Card accent" }),
  ];
  const divider = box.y + box.h - band;
  if (card.picture) {
    const top = box.y + 14;
    const bottom = parts.length ? divider - 10 : box.y + box.h - 14;
    elements.push(
      imageElement({
        x: box.x + 19,
        y: top,
        w: box.w - 33,
        h: Math.max(20, bottom - top),
        pieceIndex: card.picture.piece,
        fit: "contain",
        groupId,
        name: card.code ? `Picture ${textOf(card.code).trim()}` : "Picture",
      })
    );
  }
  if (parts.length) {
    elements.push(shapeElement({ x: box.x + 21, y: divider, w: box.w - 42, h: 1, fill: theme.rule, groupId, name: "Card rule" }));
    for (const part of parts) {
      elements.push(
        textElement({
          x: box.x + 21 + part.x,
          y: divider + 9 + part.y,
          w: part.w,
          h: part.h,
          text: part.text,
          fontFamily: theme.body,
          fontSize: part.size,
          bold: part.bold,
          color: part.color,
          lineHeight: CARD_LINE,
          groupId,
          name: part.name,
        })
      );
    }
  }
  return elements;
}

/**
 * Cards in their grid. Every card's text band is the same height, so the
 * hairlines under the pictures line up across the page.
 */
function cardGrid(cards: Card[], region: Box, theme: Theme): DesignElement[] {
  const boxes = gridBoxes(cards.length, region);
  let layouts = cards.map((card, i) => cardText(card, boxes[i].w, 0, theme));
  let band = 0;
  for (let step = 0; step < CARD_TYPE.length; step++) {
    layouts = cards.map((card, i) => cardText(card, boxes[i].w, step, theme));
    band = Math.max(64, ...layouts.map((layout) => (layout.parts.length ? layout.height + 19 : 0)));
    if (band <= boxes[0].h * 0.45) break;
  }
  return cards.flatMap((card, i) => cardElements(card, boxes[i], band, layouts[i].parts, theme));
}

/** Small framed reference pictures in a row, ending at the page's top right corner. */
function cornerPictures(pictures: SourcePicture[], y: number, theme: Theme) {
  const size = pictures.length > 4 ? 72 : 89;
  const width = pictures.length ? pictures.length * size + (pictures.length - 1) * 8 : 0;
  const elements = pictures.flatMap((picture, i) =>
    framed(picture, { x: 1234 - (i + 1) * size - i * 8, y, w: size, h: size }, size > 80 ? 7 : 6, theme)
  );
  return { elements, width, bottom: pictures.length ? y + size : y };
}

/** A product or gallery page's top: a small line in the accent colour, the title, a hairline, the reference pictures. */
function pageHeader(eyebrow: string, title: string, corner: SourcePicture[], theme: Theme) {
  const elements: DesignElement[] = [];
  const pictures = cornerPictures(corner, 62, theme);
  const width = (corner.length ? 1234 - pictures.width - 24 : 1210) - 60;
  if (eyebrow) {
    elements.push(
      textElement({
        x: 60,
        y: 62,
        w: width,
        h: 20,
        text: eyebrow,
        fontFamily: theme.body,
        fontSize: pt(10),
        bold: true,
        color: theme.accent,
        letterSpacing: pt(2),
        uppercase: true,
        lineHeight: 1.2,
        name: "Eyebrow",
      })
    );
  }
  const size = fitSize(title, width, 52, pt(27), 20, theme.heading, 1.15);
  const titleH = heightAt(title, width, size, theme.heading, 1.15);
  const titleY = eyebrow ? 90 : 76;
  elements.push(
    textElement({
      x: 59,
      y: titleY,
      w: width,
      h: titleH,
      text: title,
      fontFamily: theme.heading,
      fontSize: size,
      color: theme.ink,
      lineHeight: 1.15,
      name: "Title",
    })
  );
  const ruleY = Math.max(161, titleY + titleH + 8, pictures.bottom + 10);
  elements.push(shapeElement({ x: LEFT, y: ruleY, w: 1146, h: 2, fill: theme.rule, name: "Rule" }));
  elements.push(...pictures.elements);
  return { elements, bottom: ruleY + 2 };
}

/** The small line over a product or gallery page's title. */
function headingFor(reading: Reading, ctx: Ctx) {
  const own = reading.title ? textOf(reading.title) : "";
  const number = ctx.section.number ? pad2(ctx.section.number) : "";
  if (!own) return { eyebrow: number, title: ctx.section.title || ctx.name };
  return { eyebrow: ctx.section.title && ctx.section.title !== own ? ctx.section.title : number, title: own };
}

// ── Pages ───────────────────────────────────────────────────────────────────

/**
 * A concept page: number, title and words on the left between an accent rule
 * and an underline, the slide's pictures framed on the right. The text block
 * sits centred on the pictures' height.
 */
function conceptPage(reading: Reading, ctx: Ctx, startsSection: boolean): Built {
  const { theme } = ctx;
  const look = theme.concept;
  const sorted = sortPictures(reading, ctx.roleOf);
  // Graphite on a dark page would vanish: there, sketches join the framed pictures.
  const decorations = look.dark ? [] : sorted.decorations;
  const pictures = look.dark ? [...sorted.main, ...sorted.decorations] : sorted.main;
  const corner = cornerPictures(sorted.corner, 40, theme);

  const elements: DesignElement[] = [];
  const wide = pictures.length === 0;
  const x = 88;
  const textW = wide ? 1040 : 556;
  const titleW = textW + 40;
  const title = reading.title ? textOf(reading.title) : "";
  const body = bodyOf(reading.body);
  const number = startsSection && ctx.section.number ? pad2(ctx.section.number) : "";

  const titleSize = title ? fitSize(title, titleW, 170, pt(38), 26, theme.heading, 1.12) : 0;
  const titleH = title ? heightAt(title, titleW, titleSize, theme.heading, 1.12) : 0;
  const bodyRoom = 470 - (titleH ? titleH + 24 : 0) - (number ? 44 : 0);
  const bodySize = body ? fitSize(body, textW, bodyRoom, pt(17), 11, theme.body, 1.45) : 0;
  const bodyH = body ? heightAt(body, textW, bodySize, theme.body, 1.45) : 0;

  const blockH = (number ? 44 : 0) + titleH + (title && body ? 24 : 0) + bodyH + 30 + 2;
  let y = Math.round(Math.max(100, 96 + (518 - blockH) / 2));
  const top = y;

  if (number) {
    elements.push(
      textElement({
        x,
        y,
        w: 400,
        h: 22,
        text: number,
        fontFamily: theme.body,
        fontSize: pt(11),
        bold: true,
        color: theme.accent,
        letterSpacing: pt(2.5),
        lineHeight: 1.2,
        name: "Number",
      })
    );
    y += 44;
  }
  if (title) {
    elements.push(
      textElement({ x: x - 1, y, w: titleW, h: titleH, text: title, fontFamily: theme.heading, fontSize: titleSize, color: look.ink, lineHeight: 1.12, name: "Title" })
    );
    y += titleH + (body ? 24 : 0);
  }
  if (body) {
    elements.push(
      textElement({ x: x + 2, y, w: textW, h: bodyH, text: body, fontFamily: theme.body, fontSize: bodySize, color: look.muted, lineHeight: 1.45, name: "Body" })
    );
    y += bodyH;
  }
  y += 30;
  elements.push(shapeElement({ x: x + 2, y, w: Math.min(466, textW), h: 2, fill: theme.accent, name: "Underline" }));
  elements.push(shapeElement({ x: 61, y: top - 7, w: 5, h: y + 8 - (top - 7), fill: theme.accent, name: "Accent" }));
  elements.push(...corner.elements);

  const collageTop = corner.elements.length ? corner.bottom + 16 : 96;
  if (!wide) elements.push(...pictureWall(pictures, { x: 676, y: collageTop, w: 540, h: 614 - collageTop }, 16, 8, theme));

  // Sketches under the text if there's room there, else tucked under the pictures' bottom right corner.
  const under: DesignElement[] = [];
  if (decorations.length) {
    const room = DECORATION_BOTTOM - (y + 22);
    const area = room >= 110 ? { x: -20, y: y + 22, w: 640, h: room } : { x: SLIDE_W - 340, y: DECORATION_BOTTOM - 240, w: 360, h: 240 };
    const each = area.w / decorations.length;
    decorations.forEach((picture, i) => {
      let h = area.h;
      let w = h * picture.aspect;
      if (w > each) {
        w = each;
        h = w / picture.aspect;
      }
      under.push(
        imageElement({ ...round({ x: area.x + i * each, y: area.y + area.h - h, w, h }), pieceIndex: picture.piece, fit: "contain", name: "Background sketch" })
      );
    });
  }

  return { elements, under, section: ctx.section, dark: look.dark, layout: "section", title, body };
}

/** Product pages: the header, any loose notes, then the cards, with background sketches down the sides. */
function productPages(reading: Reading, ctx: Ctx): Built[] {
  const { theme } = ctx;
  const { eyebrow, title } = headingFor(reading, ctx);
  const sorted = sortPictures(reading, ctx.roleOf);
  // Main pictures on no code (studies, sets) follow the products as picture-only cards.
  const cards: Card[] = [...reading.cards, ...sorted.main.map((picture) => ({ picture, code: null, lines: [] }))];
  const pages = Math.max(1, Math.ceil(cards.length / ctx.cardsPerPage));
  const perPage = Math.ceil(cards.length / pages);
  const notes = bodyOf(reading.body);
  const built: Built[] = [];

  for (let page = 0; page < pages; page++) {
    const header = pageHeader(eyebrow, title, sorted.corner, theme);
    const elements = [...header.elements];
    let top = header.bottom + 19;
    // The sketches go on the first page, beside the cards they sat with.
    const sides = sideDecorations(page === 0 ? sorted.decorations : [], ctx.source, header.bottom + 14);
    const left = sides.left ? sides.left + 12 : LEFT;
    const right = sides.right ? SLIDE_W - sides.right - 12 : RIGHT;

    const notesW = right - left;
    const notesH = page === 0 && notes ? heightAt(notes, notesW, pt(10), theme.body, 1.4) : 0;
    const notesInline = notes && notesH <= 90;
    if (page === 0 && notesInline) {
      elements.push(
        textElement({ x: left, y: top - 4, w: notesW, h: notesH, text: notes, fontFamily: theme.body, fontSize: pt(10), color: theme.muted, lineHeight: 1.4, name: "Notes" })
      );
      top += notesH + 8;
    }
    const group = cards.slice(page * perPage, (page + 1) * perPage);
    if (group.length) elements.push(...cardGrid(group, { x: left, y: top, w: right - left, h: CONTENT_BOTTOM - top }, theme));
    built.push({ elements, under: sides.elements, section: ctx.section, layout: "gallery", title, body: page === 0 && notesInline ? notes : undefined });
    // Notes too long to sit over the grid get a page of their own after it.
    if (page === 0 && notes && !notesInline) built.push(textPage(eyebrow, title, notes, ctx));
  }
  return built;
}

/** Pictures only (sketches, studies), framed and arranged across the page under the header. */
function galleryPage(reading: Reading, ctx: Ctx): Built {
  const { theme } = ctx;
  const { eyebrow, title } = headingFor(reading, ctx);
  const sorted = sortPictures(reading, ctx.roleOf);
  // A page with nothing but sketches shows them as its pictures, not as background to nothing.
  const main = sorted.main.length ? sorted.main : sorted.decorations;
  const decorations = sorted.main.length ? sorted.decorations : [];
  const header = pageHeader(eyebrow, title, main.length || decorations.length ? sorted.corner : [], theme);
  const shown = main.length ? main : sorted.corner;
  const top = header.bottom + 22;
  const sides = sideDecorations(decorations, ctx.source, header.bottom + 14);
  const left = sides.left ? sides.left + 12 : LEFT;
  const right = sides.right ? SLIDE_W - sides.right - 12 : RIGHT;
  return {
    elements: [...header.elements, ...pictureWall(shown, { x: left, y: top, w: right - left, h: CONTENT_BOTTOM - top }, 18, 10, theme)],
    under: sides.elements,
    section: ctx.section,
    layout: "gallery",
    title,
  };
}

/** Words that need a page to themselves. */
function textPage(eyebrow: string, title: string, body: string, ctx: Ctx): Built {
  const { theme } = ctx;
  const header = pageHeader(eyebrow, title, [], theme);
  const top = header.bottom + 26;
  const room = CONTENT_BOTTOM - top;
  const size = fitSize(body, 1100, room, pt(14), 10, theme.body, 1.45);
  const h = heightAt(body, 1100, size, theme.body, 1.45);
  return {
    elements: [
      ...header.elements,
      textElement({ x: LEFT, y: top, w: 1100, h: Math.max(h, 40), text: body, fontFamily: theme.body, fontSize: size, color: theme.muted, lineHeight: 1.45, name: "Body" }),
    ],
    section: ctx.section,
    layout: "bullets",
    title,
    body,
  };
}

/**
 * A table, cell for cell: the first row bold as its header, hairlines between
 * rows. Its text shrinks to fit; past the smallest size, the rows that don't
 * fit continue on another page.
 */
function tablePages(table: PptxTable, eyebrow: string, title: string, ctx: Ctx): Built[] {
  const { theme } = ctx;
  const built: Built[] = [];
  let remaining = table.rows;
  const width = RIGHT - LEFT;
  while (remaining.length) {
    const header = pageHeader(eyebrow, title, [], theme);
    const top = header.bottom + 22;
    const room = CONTENT_BOTTOM - top;
    const cols = Math.max(...remaining.map((row) => row.length), 1);
    const colW = width / cols;
    const rowHeights = (size: number, rows: string[][]) =>
      rows.map((row) => Math.max(...row.map((cell) => heightAt(cell || " ", colW - 14, size, theme.body, 1.3)), 20) + 10);

    let size = pt(11);
    while (size > 10 && rowHeights(size, remaining).reduce((sum, h) => sum + h, 0) > room) size -= 0.5;
    const heights = rowHeights(size, remaining);
    let fit = 0;
    for (let used = 0; fit < remaining.length && used + heights[fit] <= room; fit++) used += heights[fit];
    fit = Math.max(1, fit);

    const elements = [...header.elements];
    let y = top;
    remaining.slice(0, fit).forEach((row, r) => {
      row.forEach((cell, c) => {
        if (!cell.trim()) return;
        elements.push(
          textElement({
            x: LEFT + c * colW + 7,
            y: y + 5,
            w: colW - 14,
            h: heights[r] - 10,
            text: cell,
            fontFamily: theme.body,
            fontSize: size,
            bold: r === 0 && remaining === table.rows,
            color: theme.ink,
            lineHeight: 1.3,
            name: "Table cell",
          })
        );
      });
      y += heights[r];
      elements.push(shapeElement({ x: LEFT, y: y - 1, w: width, h: 1, fill: theme.rule, name: "Table rule" }));
    });
    built.push({ elements, section: ctx.section, layout: "table", title, table: remaining.slice(0, fit) });
    remaining = remaining.slice(fit);
  }
  return built;
}

/** The running header and footer every page carries. */
function chrome(name: string, label: string, page: number, theme: Theme, dark: boolean): DesignElement[] {
  const muted = dark ? theme.concept.muted : theme.muted;
  return [
    shapeElement({ x: 0, y: 0, w: 10, h: SLIDE_H, fill: theme.accent, name: "Side rule" }),
    textElement({
      x: 53,
      y: 20,
      w: 760,
      h: 18,
      text: name,
      fontFamily: theme.body,
      fontSize: pt(9),
      bold: true,
      color: theme.accent,
      letterSpacing: pt(2),
      uppercase: true,
      lineHeight: 1.2,
      name: "Deck name",
    }),
    shapeElement({ x: 43, y: 679, w: 1191, h: 1, fill: dark ? theme.concept.rule : theme.rule, name: "Footer rule" }),
    textElement({
      x: 52,
      y: 686,
      w: 900,
      h: 16,
      text: label,
      fontFamily: theme.body,
      fontSize: pt(8),
      color: muted,
      letterSpacing: pt(1.5),
      uppercase: true,
      lineHeight: 1.2,
      name: "Section label",
    }),
    textElement({
      x: 1154,
      y: 685,
      w: 80,
      h: 18,
      text: pad2(page),
      fontFamily: theme.body,
      fontSize: pt(9),
      color: muted,
      align: "right",
      lineHeight: 1.2,
      name: "Page number",
    }),
  ];
}

// ── The deck ────────────────────────────────────────────────────────────────

/** "8X_White Space.pptx" → "8X White Space". */
export function deckName(fileName: string) {
  const name = fileName.replace(/\.[^.]+$/, "").replace(/_+/g, " ").replace(/\s+/g, " ").trim();
  return name || "Presentation";
}

/** Every line of the original, checked against every line of text in the result. */
function missingLines(source: RedesignSource, design: DeckDesign) {
  const placed = new Set<string>();
  for (const slide of design.slides) {
    for (const element of slide.elements) {
      if (element.type !== "text") continue;
      for (const line of element.text.split("\n")) {
        placed.add(line);
        if (line.startsWith("• ")) placed.add(line.slice(2));
      }
    }
  }
  const missing: string[] = [];
  const check = (text: string) => {
    for (const line of text.split("\n")) if (line.trim() && !placed.has(line)) missing.push(line);
  };
  for (const slide of source.slides) {
    for (const text of slide.texts) for (const paragraph of text.paragraphs) check(paragraph.text);
    for (const table of slide.tables) for (const row of table.rows) for (const cell of row) check(cell);
  }
  return missing;
}

/** All the words of the original, slide by slide: kept with the saved deck as what it was made from. */
export function sourceText(source: RedesignSource) {
  return source.slides
    .map((slide) => {
      const lines = [
        ...slide.texts.flatMap((text) => text.paragraphs.map(lineOf)),
        ...slide.tables.flatMap((table) => table.rows.map((row) => row.join(" | "))),
      ];
      return lines.length ? `Slide ${slide.number}\n${lines.join("\n")}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

/** Lays the deck out, from a plan or (with none) from what each slide's arrangement suggests. */
export function layoutRedesign(source: RedesignSource, plan: RedesignPlan | null) {
  const name = deckName(source.fileName);
  const theme = themeFor(plan);
  const readings = new Map(source.slides.map((slide) => [slide.number, classify(slide, source)]));
  const roleOf = rolesFor([...readings.values()], plan);
  // A plan that names no concept slides leaves them to the arrangement, rather than making none.
  const conceptSlides = plan?.conceptSlides.length ? new Set(plan.conceptSlides) : null;
  const order = plan?.order.length ? plan.order : source.slides.map((slide) => slide.number);
  const pages: Built[] = [];
  let section: Section = { number: 0, title: "", id: "" };

  for (const number of order) {
    const reading = readings.get(number);
    if (!reading) continue;
    const kind = kindOf(reading, roleOf, conceptSlides);
    if (kind === "empty") continue;
    const startsSection = conceptSlides ? conceptSlides.has(number) : kind === "concept" && Boolean(reading.title);
    if (startsSection) section = { number: section.number + 1, title: reading.title ? textOf(reading.title) : "", id: uid() };
    const ctx: Ctx = { theme, section, name, roleOf, cardsPerPage: plan?.cardsPerPage ?? CARDS_PER_PAGE, source };
    const before = pages.length;

    if (kind === "concept") pages.push(conceptPage(reading, ctx, startsSection));
    else if (kind === "products") pages.push(...productPages(reading, ctx));
    else if (kind === "gallery") pages.push(galleryPage(reading, ctx));

    // Tables follow the slide they were on, on pages of their own.
    if (reading.tables.length) {
      const { eyebrow, title } = headingFor(reading, ctx);
      for (const table of reading.tables) pages.push(...tablePages(table, eyebrow, title, ctx));
    }
    // The slide's speaker notes travel with its first page.
    if (reading.slide.notes && pages.length > before) pages[before].notes = reading.slide.notes;
  }

  const slides: DesignSlide[] = pages.map((page, index) => ({
    id: uid(),
    background: page.dark ? theme.concept.page : theme.page,
    ...(page.section.id ? { chapter: page.section.id } : {}),
    ...(page.notes ? { notes: page.notes } : {}),
    elements: [...(page.under ?? []), ...chrome(name, page.section.title || name, index + 1, theme, Boolean(page.dark)), ...page.elements],
  }));

  const design: DeckDesign = {
    version: 1,
    slides,
    brand: {
      logos: [],
      colors: [theme.accent, theme.ink, theme.muted, theme.rule, theme.page, theme.concept.page, "#FFFFFF"],
      headingFont: theme.heading,
      bodyFont: theme.body,
    },
    ...(plan?.id ? { planId: plan.id } : {}),
  };

  // Which pictures each page shows, for the outline: 1-based, as an outline numbers them.
  const piecesOn = (slide: DesignSlide) => [
    ...new Set(slide.elements.flatMap((element) => (element.type === "image" && element.pieceIndex !== undefined ? [element.pieceIndex + 1] : []))),
  ];
  const outline: PresentationOutline = {
    title: name,
    theme: { palette: "ivory", headingFont: theme.heading, bodyFont: theme.body },
    slides: pages.map((page, index) => ({
      id: slides[index].id,
      layout: page.layout,
      title: page.title,
      ...(page.body ? { body: page.body } : {}),
      ...(page.table ? { table: { headers: page.table[0] ?? [], rows: page.table.slice(1) } } : {}),
      ...(page.notes ? { notes: page.notes } : {}),
      images: piecesOn(slides[index]),
    })),
  };

  return { name, design, outline, missing: missingLines(source, design) };
}

/** Reads a PowerPoint and lays it out as the arrangement of its slides suggests: what saving a redesign starts from. */
export async function redesignPptx(file: File) {
  const { source, images, skipped } = await readRedesignSource(file);
  const laid = layoutRedesign(source, null);
  return { ...laid, source, images, skipped, text: sourceText(source), slideCount: { before: source.slides.length, after: laid.design.slides.length } };
}

export type RedesignedDeck = Awaited<ReturnType<typeof redesignPptx>>;

// ── Telling a model about the deck ──────────────────────────────────────────

const ROLE_WORDS: Record<PictureRole, string> = {
  product: "product (a main design, on a card)",
  inspiration: "inspiration (small, top right corner)",
  decoration: "decoration (background sketch at the side)",
  feature: "feature (a main picture, framed)",
};

function whereOn(box: Box | null, source: RedesignSource) {
  if (!box) return "position unknown";
  const centre = middle(box);
  const across = centre.x < source.width / 3 ? "left" : centre.x > (source.width * 2) / 3 ? "right" : "centre";
  const down = centre.y < source.height / 3 ? "top" : centre.y > (source.height * 2) / 3 ? "bottom" : "middle";
  const size = Math.max(box.w, box.h) <= 1.8 ? "small" : box.w * box.h >= 7 ? "large" : "medium";
  const edge = box.x <= 0.3 || box.y <= 0.3 || box.x + box.w >= source.width - 0.3 || box.y + box.h >= source.height - 0.3;
  const place = down === "middle" && across === "centre" ? "centre" : `${down} ${across}`;
  return `${size}, ${place}${edge ? ", at the slide's edge" : ""}`;
}

const quote = (text: string, max = 160) => JSON.stringify(text.length > max ? `${text.slice(0, max)}…` : text);

/**
 * The deck as a model planning its arrangement sees it: slide by slide, how
 * each reads now, every picture's id and current role, and the plan in force.
 * Words are quoted only so slides can be told apart; there is nowhere in a
 * plan to change them.
 */
export function planningBrief(source: RedesignSource, plan: RedesignPlan | null) {
  const readings = source.slides.map((slide) => classify(slide, source));
  const roleOf = rolesFor(readings, plan);
  const conceptSlides = plan?.conceptSlides.length ? new Set(plan.conceptSlides) : null;
  const current = {
    conceptSlides: readings
      .filter((reading) => {
        const kind = kindOf(reading, roleOf, conceptSlides);
        return conceptSlides ? conceptSlides.has(reading.slide.number) : kind === "concept" && Boolean(reading.title);
      })
      .map((reading) => reading.slide.number),
    palette: plan?.palette ?? "ivory",
    conceptStyle: plan?.conceptStyle ?? "light",
    cardsPerPage: plan?.cardsPerPage ?? CARDS_PER_PAGE,
    order: plan?.order.length ? plan.order : source.slides.map((slide) => slide.number),
  };

  const lines: string[] = [`DECK: "${source.fileName}", ${source.slides.length} slides.`];
  for (const reading of readings) {
    const kind = kindOf(reading, roleOf, conceptSlides);
    const what = { products: "product page", concept: "concept page", gallery: "pictures-only page", tables: "table page", empty: "empty slide" }[kind];
    lines.push("", `SLIDE ${reading.slide.number}: ${what}${current.conceptSlides.includes(reading.slide.number) ? ", opens a section" : ""}`);
    if (reading.title) lines.push(`  title: ${quote(textOf(reading.title))}`);
    if (reading.body.length) lines.push(`  words: ${quote(bodyOf(reading.body), 220)}`);
    for (const card of reading.cards) {
      const lines_ = card.lines.flatMap((line) => line.paragraphs.map((paragraph) => paragraph.text)).join(" / ");
      lines.push(`  ${card.code ? `product ${quote(textOf(card.code))}` : "captioned picture"} on picture ${card.picture?.id}${lines_ ? `, with ${quote(lines_, 120)}` : ""}`);
    }
    const others = reading.thumbnail ? [...reading.loose, reading.thumbnail] : reading.loose;
    for (const picture of others) {
      const kindOfPicture = picture.clear >= SKETCH_CLEAR ? "drawing or cut-out on a transparent background" : "picture";
      lines.push(`  picture ${picture.id}: ${ROLE_WORDS[roleOf(picture)]}; a ${kindOfPicture}, ${whereOn(picture.box, source)}`);
    }
    if (reading.tables.length) lines.push(`  ${reading.tables.length} table${reading.tables.length === 1 ? "" : "s"}`);
  }

  return {
    summary: lines.join("\n"),
    current,
    pictures: source.slides.flatMap((slide) => slide.pictures.map((picture) => ({ id: picture.id, piece: picture.piece }))),
  };
}
