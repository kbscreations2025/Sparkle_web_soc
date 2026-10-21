import type { AffinityItem } from "./api";
import {
  DECK,
  PER_SLIDE,
  sourceCodeFallback,
  splitCategoryEntries,
  splitEntries,
  toSlides,
  type AffinityPiece,
  type DeckCategory,
  type DeckEntry,
} from "./affinity";

/**
 * The deck as a free-form design — what the editor edits and what exports.
 *
 * The model writes structured copy (items, categories); the first time a deck
 * is opened that copy is laid out once into slides of absolutely positioned
 * elements, and from then on the slides are the document. Every element can
 * be moved, resized, rotated, restyled, grouped or deleted, and anything can
 * be added — so the layout is the person's, not a template's.
 *
 * Coordinates are in a fixed 1280×720 slide space, whatever size it is shown
 * at, so the preview, the PDF and the PPTX all agree.
 */

export const SLIDE_W = 1280;
export const SLIDE_H = 720;

export type ShapeKind =
  | "rect"
  | "ellipse"
  | "line"
  | "diamond"
  | "sparkle"
  | "triangle"
  | "star"
  | "hexagon"
  | "octagon"
  | "heart"
  | "arrow"
  | "chevron"
  | "plus"
  | "parallelogram";

type ElementBase = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees, clockwise. */
  rotation: number;
  opacity: number;
  /** Elements sharing one move, select and resize together. */
  groupId?: string;
  locked?: boolean;
  /** A name for the layers list, where the content doesn't say enough. */
  name?: string;
};

export type TextElement = ElementBase & {
  type: "text";
  text: string;
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color: string;
  align: "left" | "center" | "right";
  letterSpacing: number;
  lineHeight: number;
  uppercase: boolean;
  /** Shown faintly while empty, in the editor only — never exported. */
  placeholder?: string;
};

export type ImageElement = ElementBase & {
  type: "image";
  /**
   * A piece's photo is referenced by position rather than copied in: a fresh
   * run's photos are multi-megabyte data URIs, and the saved kit already
   * holds them.
   */
  pieceIndex?: number;
  /** An image the person added themselves — a compressed data URI. */
  src?: string;
  fit: "cover" | "contain";
  radius: number;
};

export type ShapeElement = ElementBase & {
  type: "shape";
  shape: ShapeKind;
  fill: string;
  stroke: string;
  strokeWidth: number;
  radius: number;
  /** The outline's (or a line's) pattern. */
  dash?: "solid" | "dash" | "dot";
};

export type DesignElement = TextElement | ImageElement | ShapeElement;

/**
 * A picture behind everything on a page — a full-bleed backdrop, or a faint
 * watermark. Kept apart from the elements so it can't be picked up or moved
 * by accident while working on what sits over it.
 */
export type SlideBackgroundImage = {
  pieceIndex?: number;
  src?: string;
  /** 0–1. */
  opacity: number;
  /** "fill" covers the page; "watermark" sits centred at `size`, whole. */
  mode: "fill" | "watermark";
  /** Watermark size, as a percentage of the page. */
  size: number;
  /** Watermark nudge from the centre, as a percentage of the page — it may run off the edge. */
  offsetX?: number;
  offsetY?: number;
};

export type DesignSlide = {
  id: string;
  background: string;
  backgroundImage?: SlideBackgroundImage | null;
  /** Which category (chapter) the page belongs to — shared by its cover and its product pages. */
  chapter?: string;
  elements: DesignElement[];
};

/**
 * The house style a deck is dressed in: logos to place, colours offered
 * first in every picker, and the two fonts. Saved with the deck, and
 * remembered in the browser so the next deck starts with it.
 */
export type DeckBrand = {
  logos: string[];
  colors: string[];
  headingFont?: string;
  bodyFont?: string;
};

export type DeckDesign = { version: 1; slides: DesignSlide[]; brand?: DeckBrand };

/** Where the brand is remembered between decks, in this browser. */
export const BRAND_STORAGE_KEY = "sparkle.deckBrand";

/** The name a placed brand logo carries, so it can be found again to move or remove. */
export const BRAND_LOGO_NAME = "Brand logo";

export type LogoCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export const FONTS = [
  "Cambria",
  "Georgia",
  "Garamond",
  "Palatino Linotype",
  "Times New Roman",
  "Didot",
  "Arial",
  "Helvetica",
  "Verdana",
  "Tahoma",
  "Trebuchet MS",
  "Gill Sans",
  "Century Gothic",
  "Segoe UI",
  "Courier New",
];

/** The palette the deck is printed in, first in every colour picker. */
export const BRAND_COLORS = [DECK.titleGold, DECK.borderGold, DECK.ink, DECK.labelGray, DECK.cream, "#FFFFFF", "#000000"];

export const uid = () => crypto.randomUUID();

export function fontStack(family: string) {
  const serif = ["Cambria", "Georgia", "Garamond", "Palatino Linotype", "Times New Roman", "Didot"].includes(family);
  return `"${family}", ${serif ? "Georgia, serif" : "Helvetica, Arial, sans-serif"}`;
}

const base = (patch: Partial<ElementBase> & Pick<ElementBase, "x" | "y" | "w" | "h">): ElementBase => ({
  id: uid(),
  rotation: 0,
  opacity: 1,
  ...patch,
});

export function textElement(patch: Partial<TextElement> & Pick<TextElement, "x" | "y" | "w" | "h">): TextElement {
  return {
    ...base(patch),
    type: "text",
    text: "",
    fontFamily: "Cambria",
    fontSize: 24,
    bold: false,
    italic: false,
    underline: false,
    color: DECK.ink,
    align: "left",
    letterSpacing: 0,
    lineHeight: 1.25,
    uppercase: false,
    ...patch,
  } as TextElement;
}

export function imageElement(patch: Partial<ImageElement> & Pick<ImageElement, "x" | "y" | "w" | "h">): ImageElement {
  return { ...base(patch), type: "image", fit: "contain", radius: 0, ...patch } as ImageElement;
}

export function shapeElement(patch: Partial<ShapeElement> & Pick<ShapeElement, "x" | "y" | "w" | "h">): ShapeElement {
  return {
    ...base(patch),
    type: "shape",
    shape: "rect",
    fill: DECK.cream,
    stroke: "transparent",
    strokeWidth: 0,
    radius: 0,
    ...patch,
  } as ShapeElement;
}

export function blankSlide(background = "#FFFFFF"): DesignSlide {
  return { id: uid(), background, elements: [] };
}

/**
 * The gold rule framing every slide of the customer's deck. 3px rather than a
 * hairline: the editor and phones show the page at a quarter of its size or
 * less, where a 1.5px rule all but disappeared.
 */
export const FRAME_STROKE_WIDTH = 3;

function frame() {
  return shapeElement({
    x: 6,
    y: 6,
    w: SLIDE_W - 12,
    h: SLIDE_H - 12,
    fill: "transparent",
    stroke: DECK.borderGold,
    strokeWidth: FRAME_STROKE_WIDTH,
    name: "Frame",
  });
}

function coverSlide(name: string, tagline: string, pieceIndex: number | undefined, split: number): DesignSlide {
  const textW = Math.round((SLIDE_W * split) / 100);
  const ornament = uid();
  const elements: DesignElement[] = [];

  if (pieceIndex !== undefined) {
    elements.push(imageElement({ x: textW, y: 0, w: SLIDE_W - textW, h: SLIDE_H, pieceIndex, fit: "cover", name: "Cover photo" }));
  }
  elements.push(
    frame(),
    shapeElement({ x: SLIDE_W - 70, y: 40, w: 24, h: 24, shape: "sparkle", fill: DECK.borderGold, name: "Sparkle" }),
    shapeElement({ x: 50, y: SLIDE_H - 74, w: 18, h: 18, shape: "sparkle", fill: DECK.borderGold, opacity: 0.7, name: "Sparkle" }),
    textElement({
      x: 80,
      y: 230,
      w: textW - 140,
      h: 150,
      text: name,
      fontSize: 60,
      color: DECK.titleGold,
      lineHeight: 1.15,
      name: "Title",
    }),
    shapeElement({ x: 80, y: 404, w: 64, h: 2, shape: "line", stroke: DECK.borderGold, strokeWidth: 1.5, fill: "transparent", groupId: ornament }),
    shapeElement({ x: 152, y: 398, w: 12, h: 12, shape: "diamond", fill: DECK.borderGold, groupId: ornament }),
    shapeElement({ x: 172, y: 404, w: 64, h: 2, shape: "line", stroke: DECK.borderGold, strokeWidth: 1.5, fill: "transparent", groupId: ornament }),
    textElement({
      x: 80,
      y: 436,
      w: textW - 140,
      h: 60,
      text: tagline,
      fontFamily: "Helvetica",
      fontSize: 14,
      letterSpacing: 4,
      uppercase: true,
      lineHeight: 1.6,
      name: "Tagline",
    })
  );

  return { id: uid(), background: DECK.cream, elements };
}

/** The grid every product page is laid out on: three cards across, two down. */
const CARD_COLS = 3;
const CARD_ROWS = 2;
const CARD_LEFT = 64;
const CARD_TOP = 104;
const CARD_GAP_X = 40;
const CARD_GAP_Y = 28;
export const CARD_W = (SLIDE_W - CARD_LEFT * 2 - CARD_GAP_X * (CARD_COLS - 1)) / CARD_COLS;
export const CARD_H = (SLIDE_H - CARD_TOP - 36 - CARD_GAP_Y) / CARD_ROWS;

/** Where the card at a grid position (0–5, left to right, top to bottom) sits. */
function cardSlot(position: number): Box {
  return {
    x: CARD_LEFT + (position % CARD_COLS) * (CARD_W + CARD_GAP_X),
    y: CARD_TOP + Math.floor(position / CARD_COLS) * (CARD_H + CARD_GAP_Y),
    w: CARD_W,
    h: CARD_H,
  };
}

/**
 * One product card: category, photo, code, name and spec line, grouped so it
 * moves as one. The deck's own cards and the editor's "Product card"
 * template are both made here, so an added card matches the rest exactly.
 * Empty fields show their placeholder in the editor and print nothing.
 */
export function productCard({
  x,
  y,
  groupId = uid(),
  label = "",
  pieceIndex,
  code = "",
  title = "",
  caption = "",
}: {
  x: number;
  y: number;
  groupId?: string;
  label?: string;
  pieceIndex?: number;
  code?: string;
  title?: string;
  caption?: string;
}): DesignElement[] {
  const imageH = CARD_H - 22 - 66;
  const line = (patch: Partial<TextElement> & Pick<TextElement, "y" | "h">) =>
    textElement({ x, w: CARD_W, groupId, fontFamily: "Helvetica", align: "center", color: DECK.labelGray, ...patch });

  return [
    line({ y, h: 20, text: label, fontSize: 14, placeholder: "Label", name: "Label" }),
    imageElement({ x, y: y + 22, w: CARD_W, h: imageH, pieceIndex, name: "Photo", groupId }),
    line({ y: y + 24 + imageH, h: 20, text: code, fontSize: 13, bold: true, color: DECK.ink, placeholder: "Add a code", name: "Code" }),
    line({ y: y + 44 + imageH, h: 18, text: title, fontSize: 12, placeholder: "Add a title", name: "Title" }),
    line({ y: y + 62 + imageH, h: 18, text: caption, fontSize: 11, placeholder: "Add a caption", name: "Caption" }),
  ];
}

/**
 * Where an added card goes: the first grid position nothing sits in yet, so a
 * fifth or sixth piece lands beside the others. A slot counts as taken when
 * something covers a sixth of it; page-sized things (the frame) don't count.
 * With every slot taken — or on a page that isn't a grid, like a cover — the
 * card goes to the middle of the page, stepped clear of one already there.
 */
export function freeCardSlot(elements: DesignElement[]): Box {
  const placed = elements.filter((element) => element.w * element.h < SLIDE_W * SLIDE_H * 0.8);
  const overlap = (a: Box, b: Box) =>
    Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

  for (let position = 0; position < CARD_COLS * CARD_ROWS; position++) {
    const slot = cardSlot(position);
    if (!placed.some((element) => overlap(boundsOf(element), slot) > (slot.w * slot.h) / 6)) return slot;
  }

  const centre = { x: (SLIDE_W - CARD_W) / 2, y: (SLIDE_H - CARD_H) / 2, w: CARD_W, h: CARD_H };
  for (let step = 0; step < 12; step++) {
    const box = { ...centre, x: centre.x + step * 24, y: centre.y + step * 24 };
    if (!placed.some((element) => Math.abs(element.x - box.x) < 4 && Math.abs(element.y - box.y) < 4)) return box;
  }
  return centre;
}

/** One section's slides — six cards a slide, three across, each card its own group. */
function gridSlides(label: string, chapter: string, entries: DeckEntry[], section: "existing" | "ideation"): DesignSlide[] {
  const chunks = toSlides(entries);

  return chunks.map((chunk, slideIndex) => {
    const elements: DesignElement[] = [frame()];
    if (chapter) {
      elements.push(
        textElement({
          x: 64,
          y: 40,
          w: 600,
          h: 24,
          text: chapter,
          fontFamily: "Helvetica",
          fontSize: 13,
          letterSpacing: 3,
          uppercase: true,
          color: DECK.titleGold,
          name: "Chapter",
        })
      );
    }
    elements.push(
      textElement({
        x: SLIDE_W - 64 - 420,
        y: 32,
        w: 420,
        h: 34,
        text: `${label}${chunks.length > 1 ? ` (${slideIndex + 1}/${chunks.length})` : ""}`,
        fontSize: 24,
        italic: true,
        align: "right",
        name: "Section",
      })
    );

    chunk.forEach((entry, position) => {
      const { x, y } = cardSlot(position);
      const group = uid();
      const { item } = entry;

      elements.push(
        ...productCard({
          x,
          y,
          groupId: group,
          label: item.category,
          pieceIndex: item.index ?? entry.index,
          code: item.sourceCode || sourceCodeFallback(entry, section),
          title: item.title,
          caption: item.caption,
        })
      );

      // Text boxes dropped on a card in the old deck, carried over where they sat.
      for (const note of item.notes ?? []) {
        if (!note.text) continue;
        elements.push(
          textElement({
            x: x + (CARD_W * note.x) / 100 - 60,
            y: y + (CARD_H * note.y) / 100 - 10,
            w: 120,
            h: 20,
            text: note.text,
            fontFamily: "Helvetica",
            fontSize: 11,
            align: "center",
            groupId: group,
          })
        );
      }
    });

    return { id: uid(), background: "#FFFFFF", elements };
  });
}

/**
 * Lays the generated copy out as slides — once, the first time a deck is
 * opened in the editor. Mirrors the deck's established look: a cream cover
 * per chapter, then its Existing style and New Ideation slides.
 */
export function buildDesign({
  collectionName,
  tagline,
  items,
  pieces,
  categories,
  coverSplit,
}: {
  collectionName: string;
  tagline: string;
  items: AffinityItem[];
  pieces: AffinityPiece[];
  categories: DeckCategory[];
  coverSplit: number;
}): DeckDesign {
  const split = Math.min(75, Math.max(30, coverSplit || 50));
  const firstPhoto = pieces.findIndex((piece) => piece.image);

  const chapters =
    categories.length > 0
      ? categories.map((category) => ({
          name: category.name,
          tagline: category.tagline,
          chapter: category.name,
          cover: category.coverIndex ?? category.pieceIndexes[0],
          ...splitCategoryEntries(items, pieces, category),
        }))
      : [
          {
            name: collectionName,
            tagline,
            chapter: "",
            cover: firstPhoto >= 0 ? firstPhoto : undefined,
            ...splitEntries(items, pieces),
          },
        ];

  const slides = chapters.flatMap((chapter) => {
    const id = uid();
    return [
      coverSlide(chapter.name, chapter.tagline, chapter.cover, split),
      ...gridSlides("Existing style", chapter.chapter, chapter.existing, "existing"),
      ...gridSlides("New Ideation", chapter.chapter, chapter.ideation, "ideation"),
    ].map((slide) => ({ ...slide, chapter: id }));
  });

  return { version: 1, slides };
}

/** Whether a stored value is a design this editor can open. */
export function isDesign(value: unknown): value is DeckDesign {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as DeckDesign).version === 1 &&
      Array.isArray((value as DeckDesign).slides) &&
      (value as DeckDesign).slides.length > 0
  );
}

/** Where a page's background picture comes from. */
export function backgroundSource(image: SlideBackgroundImage, pieces: AffinityPiece[]) {
  if (image.src) return image.src;
  if (image.pieceIndex !== undefined) return pieces[image.pieceIndex]?.image || "";
  return "";
}

/** The box a background picture is drawn in: the whole page, or centred at its watermark size. */
export function backgroundBox(image: SlideBackgroundImage): Box {
  if (image.mode === "fill") return { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H };
  const w = (SLIDE_W * image.size) / 100;
  const h = (SLIDE_H * image.size) / 100;
  return {
    x: (SLIDE_W - w) / 2 + (SLIDE_W * (image.offsetX ?? 0)) / 100,
    y: (SLIDE_H - h) / 2 + (SLIDE_H * (image.offsetY ?? 0)) / 100,
    w,
    h,
  };
}

/** A chapter's cover is the page carrying its tagline — how a deck saved before chapters were recorded is read. */
const isCover = (slide: DesignSlide) => slide.elements.some((element) => element.name === "Tagline");

/**
 * The pages in the same category as page `index`: its cover and the product
 * pages after it, up to the next cover. Uses the recorded chapter where there
 * is one, and the covers where there isn't.
 */
export function chapterPages(slides: DesignSlide[], index: number): number[] {
  const chapter = slides[index]?.chapter;
  if (chapter) return slides.flatMap((slide, i) => (slide.chapter === chapter ? [i] : []));
  let start = index;
  while (start > 0 && !isCover(slides[start])) start -= 1;
  let end = index + 1;
  while (end < slides.length && !isCover(slides[end])) end += 1;
  return Array.from({ length: end - start }, (_, i) => start + i);
}

/** The category's name, from its cover's title. */
export function chapterName(slides: DesignSlide[], index: number) {
  const first = slides[chapterPages(slides, index)[0]];
  const title = first?.elements.find((element): element is TextElement => element.type === "text" && element.name === "Title");
  return title?.text.trim() || "this category";
}

/** Which pages a change applies to. */
export type PageScope = "page" | "chapter" | "all";

/** Where an element's picture comes from. */
export function imageSource(element: ImageElement, pieces: AffinityPiece[]) {
  if (element.src) return element.src;
  if (element.pieceIndex !== undefined) return pieces[element.pieceIndex]?.image || "";
  return "";
}

export type Box = { x: number; y: number; w: number; h: number };

/** The axis-aligned box around a rotated element. */
export function boundsOf(element: Box & { rotation?: number }): Box {
  const angle = ((element.rotation ?? 0) * Math.PI) / 180;
  if (!angle) return { x: element.x, y: element.y, w: element.w, h: element.h };
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  const w = element.w * cos + element.h * sin;
  const h = element.w * sin + element.h * cos;
  return { x: element.x + element.w / 2 - w / 2, y: element.y + element.h / 2 - h / 2, w, h };
}

export function unionBox(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null;
  const x1 = Math.min(...boxes.map((box) => box.x));
  const y1 = Math.min(...boxes.map((box) => box.y));
  const x2 = Math.max(...boxes.map((box) => box.x + box.w));
  const y2 = Math.max(...boxes.map((box) => box.y + box.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** A short description of an element, for the layers list and page summaries. */
export function describe(element: DesignElement) {
  if (element.name && element.type !== "text") return element.name;
  if (element.type === "text") return element.text.trim().slice(0, 40) || element.placeholder || element.name || "Empty text";
  if (element.type === "image") return element.name || "Image";
  return element.shape[0].toUpperCase() + element.shape.slice(1);
}

/** "2 photos · 5 texts" — what a page holds, at a glance. */
export function summarize(slide: DesignSlide) {
  const count = (type: DesignElement["type"]) => slide.elements.filter((element) => element.type === type).length;
  const parts: string[] = [];
  const images = count("image");
  const texts = slide.elements.filter((element) => element.type === "text" && element.text.trim()).length;
  const shapes = count("shape");
  if (images) parts.push(`${images} image${images === 1 ? "" : "s"}`);
  if (texts) parts.push(`${texts} text${texts === 1 ? "" : "s"}`);
  if (shapes) parts.push(`${shapes} shape${shapes === 1 ? "" : "s"}`);
  return parts.join(" · ") || "Empty";
}

/** A page's title for the pages list — its biggest piece of text. */
export function slideTitle(slide: DesignSlide) {
  const texts = slide.elements.filter((element): element is TextElement => element.type === "text" && Boolean(element.text.trim()));
  texts.sort((a, b) => b.fontSize - a.fontSize);
  return texts[0]?.text.trim().slice(0, 48) || "Untitled page";
}

/** A copy with fresh ids, groups kept together but distinct from the originals'. */
export function cloneElements(elements: DesignElement[], offset = 0): DesignElement[] {
  const groups = new Map<string, string>();
  return elements.map((element) => {
    let groupId = element.groupId;
    if (groupId) {
      if (!groups.has(groupId)) groups.set(groupId, uid());
      groupId = groups.get(groupId);
    }
    return { ...element, id: uid(), groupId, x: element.x + offset, y: element.y + offset };
  });
}

export function cloneSlide(slide: DesignSlide): DesignSlide {
  return { ...slide, id: uid(), elements: cloneElements(slide.elements) };
}

export { PER_SLIDE };
