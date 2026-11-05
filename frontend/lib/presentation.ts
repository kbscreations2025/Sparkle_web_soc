import {
  SLIDE_H,
  SLIDE_W,
  imageElement,
  shapeElement,
  textElement,
  type DeckDesign,
  type DesignElement,
  type DesignSlide,
} from "./deckDesign";
import type { AffinityPiece } from "./affinity";

/**
 * The Presentation tool's two halves: what the model writes, and how it is
 * drawn.
 *
 * The model never places anything. It writes an *outline* — a theme and, per
 * slide, a layout and the words, numbers and picture numbers that go in it —
 * and this file lays that out on the editor's 1280×720 page with fixed
 * margins, a type scale and text sized to its box. That split is what keeps
 * every deck clean: a model asked for coordinates produces overlapping text
 * boxes, and one asked for "a stats slide" produces a stats slide.
 *
 * After layout the slides are ordinary editor slides, freely editable. A chat
 * edit changes the outline; only the slides whose outline actually changed
 * are laid out again (see `rebuildDesign`), so hand edits elsewhere survive.
 */

// ── The outline ─────────────────────────────────────────────────────────────

export const SLIDE_LAYOUTS = [
  "title",
  "section",
  "bullets",
  "image-left",
  "image-right",
  "image-full",
  "gallery",
  "stats",
  "table",
  "quote",
  "columns",
  "timeline",
  "closing",
] as const;
export type SlideLayout = (typeof SLIDE_LAYOUTS)[number];

export type OutlineSlide = {
  id: string;
  layout: SlideLayout;
  title: string;
  subtitle?: string;
  body?: string;
  bullets?: string[];
  /** 1-based numbers into the uploaded pictures, as the model was shown them. */
  images?: number[];
  stats?: { value: string; label: string }[];
  table?: { headers: string[]; rows: string[][] };
  quote?: string;
  attribution?: string;
  columns?: { heading: string; bullets: string[] }[];
  steps?: { heading: string; text: string }[];
  notes?: string;
};

export const PALETTE_IDS = ["ivory", "midnight", "minimal", "navy", "emerald", "blush", "charcoal", "terracotta"] as const;
export type PaletteId = (typeof PALETTE_IDS)[number];

export type PresentationTheme = { palette: PaletteId; headingFont: string; bodyFont: string };

export type PresentationOutline = { title: string; theme: PresentationTheme; slides: OutlineSlide[] };

/** The style choices offered before a run — "auto" leaves it to the model. */
export const STYLE_OPTIONS = [
  { id: "auto", label: "Let AI decide" },
  { id: "luxury", label: "Luxury" },
  { id: "minimal", label: "Minimal" },
  { id: "corporate", label: "Corporate" },
  { id: "bold", label: "Bold" },
  { id: "editorial", label: "Editorial" },
] as const;

export const LENGTH_OPTIONS = [
  { id: "auto", label: "Auto" },
  { id: "short", label: "Short · 5–7" },
  { id: "medium", label: "Medium · 8–12" },
  { id: "long", label: "Long · 13–20" },
] as const;

// ── Theme ───────────────────────────────────────────────────────────────────

type Palette = {
  label: string;
  /** Content pages. */
  bg: string;
  ink: string;
  muted: string;
  accent: string;
  /** Card and table-row fills on content pages. */
  soft: string;
  /** Cover, section and closing pages — the deck's dark (or deep) colour. */
  feature: string;
  featureInk: string;
  featureMuted: string;
};

export const PALETTES: Record<PaletteId, Palette> = {
  ivory: {
    label: "Ivory & gold",
    bg: "#FAF7F2",
    ink: "#1F1A14",
    muted: "#6B6257",
    accent: "#A8834A",
    soft: "#F0E8DB",
    feature: "#1F1A14",
    featureInk: "#FAF7F2",
    featureMuted: "#C9B48F",
  },
  midnight: {
    label: "Midnight",
    bg: "#0E1525",
    ink: "#EEF2F8",
    muted: "#93A0B8",
    accent: "#D4B26A",
    soft: "#1A2438",
    feature: "#070B14",
    featureInk: "#F5F1E8",
    featureMuted: "#D4B26A",
  },
  minimal: {
    label: "Minimal",
    bg: "#FFFFFF",
    ink: "#111111",
    muted: "#6B7280",
    accent: "#111111",
    soft: "#F3F4F6",
    feature: "#111111",
    featureInk: "#FFFFFF",
    featureMuted: "#A3A3A3",
  },
  navy: {
    label: "Navy",
    bg: "#FFFFFF",
    ink: "#0B1F3A",
    muted: "#5B6B82",
    accent: "#2563A8",
    soft: "#EEF3FA",
    feature: "#0B1F3A",
    featureInk: "#FFFFFF",
    featureMuted: "#9DB6D8",
  },
  emerald: {
    label: "Emerald",
    bg: "#F7F9F7",
    ink: "#0F2A20",
    muted: "#55705F",
    accent: "#1F7A5A",
    soft: "#E2EEE7",
    feature: "#0F2A20",
    featureInk: "#F4F1E8",
    featureMuted: "#B9D3C4",
  },
  blush: {
    label: "Blush",
    bg: "#FFF8F6",
    ink: "#3A2A2A",
    muted: "#836B69",
    accent: "#B8676A",
    soft: "#F6E4E1",
    feature: "#3A2A2A",
    featureInk: "#FFF4F1",
    featureMuted: "#E4B9B5",
  },
  charcoal: {
    label: "Charcoal",
    bg: "#F5F5F4",
    ink: "#1C1917",
    muted: "#6B6560",
    accent: "#E0592A",
    soft: "#E7E5E4",
    feature: "#1C1917",
    featureInk: "#FAFAF9",
    featureMuted: "#F0A07E",
  },
  terracotta: {
    label: "Terracotta",
    bg: "#FBF6F1",
    ink: "#2B1D14",
    muted: "#7A6253",
    accent: "#B5562C",
    soft: "#F1E2D6",
    feature: "#2B1D14",
    featureInk: "#FBF6F1",
    featureMuted: "#E2A37F",
  },
};

/** Fonts the model may pick — all in the editor's own list, so the PPTX opens in the same faces. */
export const HEADING_FONTS = ["Georgia", "Didot", "Garamond", "Palatino Linotype", "Cambria", "Helvetica", "Century Gothic", "Gill Sans", "Segoe UI"];
export const BODY_FONTS = ["Helvetica", "Arial", "Segoe UI", "Gill Sans", "Century Gothic", "Verdana", "Georgia", "Cambria"];

const SERIF = ["Cambria", "Georgia", "Garamond", "Palatino Linotype", "Times New Roman", "Didot"];

// ── Text fitting ────────────────────────────────────────────────────────────

/**
 * Roughly how many lines `text` takes in a box `width` wide. An estimate, not
 * a measurement — average glyph width is about half the font size, a little
 * more for sans — but deliberately pessimistic, so a box sized from it holds
 * its text in the editor, the PDF and PowerPoint alike.
 */
function lineCount(text: string, width: number, size: number, font: string) {
  const glyph = size * (SERIF.includes(font) ? 0.5 : 0.54);
  const perLine = Math.max(1, Math.floor(width / glyph));
  return text
    .split("\n")
    .reduce((total, paragraph) => total + Math.max(1, Math.ceil(paragraph.length / perLine)), 0);
}

/** The largest size from `max` down to `min` at which `text` fits the box. */
function fitSize(text: string, width: number, height: number, max: number, min: number, font: string, lineHeight: number) {
  for (let size = max; size > min; size -= 1) {
    if (lineCount(text, width, size, font) * size * lineHeight <= height) return size;
  }
  return min;
}

/** How tall `text` actually is at `size` — for stacking boxes under each other. */
function heightAt(text: string, width: number, size: number, font: string, lineHeight: number) {
  return Math.ceil(lineCount(text, width, size, font) * size * lineHeight) + 4;
}

// ── Building blocks ─────────────────────────────────────────────────────────

const MARGIN_X = 88;
const TITLE_Y = 64;
const CONTENT_W = SLIDE_W - MARGIN_X * 2;

type Ctx = {
  p: Palette;
  heading: string;
  body: string;
  /** 1-based slide number, for the footer. */
  number: number;
  total: number;
  deckTitle: string;
  /** Picture numbers the deck actually has — out-of-range ones are dropped. */
  imageCount: number;
};

function pictures(slide: OutlineSlide, ctx: Ctx) {
  return (slide.images ?? []).filter((n) => Number.isInteger(n) && n >= 1 && n <= ctx.imageCount).map((n) => n - 1);
}

function photo(pieceIndex: number, x: number, y: number, w: number, h: number, radius = 0) {
  return imageElement({ x, y, w, h, pieceIndex, fit: "cover", radius, name: "Picture" });
}

/** A text box sized to its words: `max` shrinks toward `min` until it fits `h`. */
function words(
  text: string,
  box: { x: number; y: number; w: number; h: number },
  style: { font: string; color: string; max: number; min?: number; bold?: boolean; italic?: boolean; align?: "left" | "center" | "right"; lineHeight?: number; uppercase?: boolean; letterSpacing?: number; name?: string }
) {
  const lineHeight = style.lineHeight ?? 1.25;
  const fontSize = fitSize(style.uppercase ? text.toUpperCase() : text, box.w, box.h, style.max, style.min ?? Math.round(style.max * 0.6), style.font, lineHeight);
  return textElement({
    ...box,
    text,
    fontFamily: style.font,
    fontSize,
    bold: style.bold ?? false,
    italic: style.italic ?? false,
    color: style.color,
    align: style.align ?? "left",
    lineHeight,
    uppercase: style.uppercase ?? false,
    letterSpacing: style.letterSpacing ?? 0,
    name: style.name,
  });
}

/** Title and the short accent rule under it, shared by every content page. Returns where content may start. */
function header(slide: OutlineSlide, ctx: Ctx, width = CONTENT_W, x = MARGIN_X): { elements: DesignElement[]; bottom: number } {
  const elements: DesignElement[] = [];
  const titleH = slide.title.length > 48 ? 104 : 60;
  elements.push(words(slide.title, { x, y: TITLE_Y, w: width, h: titleH }, { font: ctx.heading, color: ctx.p.ink, max: 40, min: 26, lineHeight: 1.15, name: "Title" }));
  let bottom = TITLE_Y + heightAt(slide.title, width, elements[0].type === "text" ? elements[0].fontSize : 40, ctx.heading, 1.15);
  elements.push(shapeElement({ x, y: bottom + 10, w: 48, h: 3, fill: ctx.p.accent, name: "Accent" }));
  bottom += 28;
  if (slide.subtitle) {
    elements.push(words(slide.subtitle, { x, y: bottom, w: width, h: 52 }, { font: ctx.body, color: ctx.p.muted, max: 18, min: 14, lineHeight: 1.4, name: "Subtitle" }));
    bottom += heightAt(slide.subtitle, width, 18, ctx.body, 1.4) + 8;
  }
  return { elements, bottom: bottom + 16 };
}

/** Slide number and deck name along the bottom of a content page. */
function footer(ctx: Ctx, dark = false): DesignElement[] {
  const color = dark ? ctx.p.featureMuted : ctx.p.muted;
  return [
    textElement({ x: MARGIN_X, y: SLIDE_H - 44, w: 600, h: 20, text: ctx.deckTitle, fontFamily: ctx.body, fontSize: 11, color, letterSpacing: 1.5, uppercase: true, opacity: 0.8, name: "Footer" }),
    textElement({ x: SLIDE_W - MARGIN_X - 80, y: SLIDE_H - 44, w: 80, h: 20, text: String(ctx.number).padStart(2, "0"), fontFamily: ctx.body, fontSize: 11, color, align: "right", opacity: 0.8, name: "Page number" }),
  ];
}

/** A bullet list as one marker + one text box per point, spread over the space it is given. */
function bulletList(items: string[], box: { x: number; y: number; w: number; h: number }, ctx: Ctx, color = ctx.p.ink): DesignElement[] {
  const list = items.filter(Boolean).slice(0, 8);
  if (list.length === 0) return [];
  const textW = box.w - 30;
  // One size for the whole list, so the points read as a set; the gap grows
  // with it, so a short list breathes instead of huddling at the top.
  let size = 26;
  const gapFor = (s: number) => Math.round(s * 0.9);
  const totalAt = (s: number) => list.reduce((sum, item) => sum + heightAt(item, textW, s, ctx.body, 1.35), 0) + gapFor(s) * (list.length - 1);
  for (; size > 13; size -= 1) {
    if (totalAt(size) <= box.h) break;
  }
  const gap = gapFor(size);
  const elements: DesignElement[] = [];
  // A short list sits a little lower, nearer the optical middle of the space.
  let y = box.y + Math.min(48, Math.max(0, (box.h - totalAt(size)) / 4));
  for (const item of list) {
    const h = heightAt(item, textW, size, ctx.body, 1.35);
    elements.push(shapeElement({ x: box.x, y: y + size * 0.5, w: 9, h: 9, shape: "diamond", fill: ctx.p.accent, name: "Bullet" }));
    elements.push(textElement({ x: box.x + 30, y, w: textW, h, text: item, fontFamily: ctx.body, fontSize: size, color, lineHeight: 1.35, name: "Point" }));
    y += h + gap;
  }
  return elements;
}

/** Body paragraph then bullets, stacked inside one box. */
function bodyAndBullets(slide: OutlineSlide, box: { x: number; y: number; w: number; h: number }, ctx: Ctx, color = ctx.p.ink): DesignElement[] {
  const elements: DesignElement[] = [];
  let y = box.y;
  if (slide.body) {
    const bodyH = slide.bullets?.length ? Math.min(box.h * 0.4, heightAt(slide.body, box.w, 20, ctx.body, 1.5)) : box.h;
    const element = words(slide.body, { x: box.x, y, w: box.w, h: bodyH }, { font: ctx.body, color: slide.bullets?.length ? ctx.p.muted : color, max: 22, min: 14, lineHeight: 1.5, name: "Body" });
    elements.push(element);
    y += heightAt(slide.body, box.w, element.type === "text" ? element.fontSize : 20, ctx.body, 1.5) + 18;
  }
  if (slide.bullets?.length) elements.push(...bulletList(slide.bullets, { x: box.x, y, w: box.w, h: box.y + box.h - y }, ctx, color));
  return elements;
}

// ── Layouts ─────────────────────────────────────────────────────────────────

type Built = { background: string; elements: DesignElement[] };

function titleSlide(slide: OutlineSlide, ctx: Ctx): Built {
  const [cover] = pictures(slide, ctx);
  const { p } = ctx;
  const elements: DesignElement[] = [];
  const textW = (cover !== undefined ? 600 : 960) - MARGIN_X;
  if (cover !== undefined) elements.push(photo(cover, 640, 0, 640, SLIDE_H));

  // Title and subtitle stacked by their real heights, the block centred a
  // little above the middle — a fixed slot left a gap under a short title.
  const title = words(slide.title, { x: MARGIN_X, y: 0, w: textW, h: 200 }, { font: ctx.heading, color: p.featureInk, max: 66, min: 36, lineHeight: 1.08, name: "Title" });
  const titleH = heightAt(slide.title, textW, title.type === "text" ? title.fontSize : 66, ctx.heading, 1.08);
  const subtitleH = slide.subtitle ? heightAt(slide.subtitle, textW, 20, ctx.body, 1.45) : 0;
  const blockH = 30 + titleH + (subtitleH ? 22 + subtitleH : 0);
  const top = Math.max(120, Math.round((SLIDE_H - blockH) / 2) - 30);
  elements.push(shapeElement({ x: MARGIN_X, y: top, w: 56, h: 3, fill: p.featureMuted, name: "Accent" }));
  elements.push({ ...title, y: top + 30, h: titleH });
  if (slide.subtitle) {
    elements.push(words(slide.subtitle, { x: MARGIN_X, y: top + 30 + titleH + 22, w: textW, h: subtitleH + 6 }, { font: ctx.body, color: p.featureMuted, max: 20, min: 14, lineHeight: 1.45, name: "Subtitle" }));
  }
  if (slide.body) {
    elements.push(words(slide.body, { x: MARGIN_X, y: SLIDE_H - 96, w: textW - MARGIN_X, h: 30 }, { font: ctx.body, color: p.featureMuted, max: 13, min: 11, uppercase: true, letterSpacing: 2, name: "Eyebrow" }));
  }
  return { background: p.feature, elements };
}

function sectionSlide(slide: OutlineSlide, ctx: Ctx, sectionNumber: number): Built {
  const { p } = ctx;
  const [cover] = pictures(slide, ctx);
  const elements: DesignElement[] = [];
  // A photo sits beside the words, whole — laid under a shade it only muddied.
  const textW = (cover !== undefined ? 640 : 1000) - MARGIN_X;
  if (cover !== undefined) elements.push(photo(cover, 700, 0, SLIDE_W - 700, SLIDE_H));
  const title = words(slide.title, { x: MARGIN_X, y: 0, w: textW, h: 170 }, { font: ctx.heading, color: p.featureInk, max: 56, min: 34, lineHeight: 1.1, name: "Title" });
  const titleH = heightAt(slide.title, textW, title.type === "text" ? title.fontSize : 56, ctx.heading, 1.1);
  const subtitleH = slide.subtitle ? heightAt(slide.subtitle, textW, 20, ctx.body, 1.45) : 0;
  const top = Math.max(110, Math.round((SLIDE_H - (100 + titleH + (subtitleH ? 20 + subtitleH : 0))) / 2));
  elements.push(textElement({ x: MARGIN_X, y: top, w: 200, h: 60, text: String(sectionNumber).padStart(2, "0"), fontFamily: ctx.heading, fontSize: 44, color: p.featureMuted, name: "Section number" }));
  elements.push(shapeElement({ x: MARGIN_X, y: top + 74, w: 56, h: 3, fill: p.featureMuted, name: "Accent" }));
  elements.push({ ...title, y: top + 100, h: titleH });
  if (slide.subtitle) {
    elements.push(words(slide.subtitle, { x: MARGIN_X, y: top + 100 + titleH + 20, w: textW, h: subtitleH + 6 }, { font: ctx.body, color: p.featureMuted, max: 20, min: 14, lineHeight: 1.45, name: "Subtitle" }));
  }
  return { background: p.feature, elements };
}

function bulletsSlide(slide: OutlineSlide, ctx: Ctx): Built {
  const head = header(slide, ctx);
  const box = { x: MARGIN_X, y: head.bottom, w: CONTENT_W * 0.86, h: SLIDE_H - 80 - head.bottom };
  return { background: ctx.p.bg, elements: [...head.elements, ...bodyAndBullets(slide, box, ctx), ...footer(ctx)] };
}

function imageSideSlide(slide: OutlineSlide, ctx: Ctx, side: "left" | "right"): Built {
  const [cover] = pictures(slide, ctx);
  if (cover === undefined) return bulletsSlide(slide, ctx);
  const imageW = 560;
  const imageX = side === "left" ? 0 : SLIDE_W - imageW;
  const textX = side === "left" ? imageW + 72 : MARGIN_X;
  const textW = SLIDE_W - imageW - 72 - MARGIN_X;
  const head = header(slide, ctx, textW, textX);
  const elements: DesignElement[] = [photo(cover, imageX, 0, imageW, SLIDE_H), ...head.elements];
  elements.push(...bodyAndBullets(slide, { x: textX, y: head.bottom, w: textW, h: SLIDE_H - 80 - head.bottom }, ctx));
  elements.push(
    textElement({ x: side === "left" ? SLIDE_W - MARGIN_X - 80 : imageX - 120, y: SLIDE_H - 44, w: 80, h: 20, text: String(ctx.number).padStart(2, "0"), fontFamily: ctx.body, fontSize: 11, color: ctx.p.muted, align: "right", opacity: 0.8, name: "Page number" })
  );
  return { background: ctx.p.bg, elements };
}

function imageFullSlide(slide: OutlineSlide, ctx: Ctx): Built {
  const [cover] = pictures(slide, ctx);
  if (cover === undefined) return sectionSlide(slide, ctx, ctx.number);
  const elements: DesignElement[] = [
    photo(cover, 0, 0, SLIDE_W, SLIDE_H),
    shapeElement({ x: 0, y: SLIDE_H - 260, w: SLIDE_W, h: 260, fill: "#000000", opacity: 0.45, name: "Shade" }),
    words(slide.title, { x: MARGIN_X, y: SLIDE_H - 220, w: 900, h: 110 }, { font: ctx.heading, color: "#FFFFFF", max: 48, min: 30, lineHeight: 1.1, name: "Title" }),
  ];
  if (slide.subtitle || slide.body) {
    elements.push(words(slide.subtitle || slide.body || "", { x: MARGIN_X, y: SLIDE_H - 102, w: 900, h: 56 }, { font: ctx.body, color: "#F2F2F2", max: 18, min: 13, lineHeight: 1.4, name: "Caption" }));
  }
  return { background: "#000000", elements };
}

function gallerySlide(slide: OutlineSlide, ctx: Ctx): Built {
  const shots = pictures(slide, ctx).slice(0, 6);
  if (shots.length === 0) return bulletsSlide(slide, ctx);
  const head = header(slide, ctx);
  const top = head.bottom;
  const bottom = SLIDE_H - 76;
  const cols = shots.length <= 3 ? shots.length : shots.length === 4 ? 2 : 3;
  const rows = Math.ceil(shots.length / cols);
  const gap = 20;
  const w = (CONTENT_W - gap * (cols - 1)) / cols;
  const h = (bottom - top - gap * (rows - 1)) / rows;
  const elements = [...head.elements];
  shots.forEach((index, n) => {
    const col = n % cols;
    const row = Math.floor(n / cols);
    // The last row centred when it is short.
    const inRow = row === rows - 1 ? shots.length - row * cols : cols;
    const offset = ((cols - inRow) * (w + gap)) / 2;
    elements.push(photo(index, MARGIN_X + offset + col * (w + gap), top + row * (h + gap), w, h, 8));
  });
  return { background: ctx.p.bg, elements: [...elements, ...footer(ctx)] };
}

function statsSlide(slide: OutlineSlide, ctx: Ctx): Built {
  const stats = (slide.stats ?? []).filter((stat) => stat.value || stat.label).slice(0, 4);
  if (stats.length === 0) return bulletsSlide(slide, ctx);
  const head = header(slide, ctx);
  const gap = 24;
  const w = (CONTENT_W - gap * (stats.length - 1)) / stats.length;
  const top = Math.max(head.bottom + 10, 250);
  const h = 250;
  const elements = [...head.elements];
  stats.forEach((stat, n) => {
    const x = MARGIN_X + n * (w + gap);
    elements.push(shapeElement({ x, y: top, w, h, fill: ctx.p.soft, radius: 12, name: "Card" }));
    elements.push(words(stat.value, { x: x + 28, y: top + 36, w: w - 56, h: 84 }, { font: ctx.heading, color: ctx.p.accent, max: 60, min: 30, lineHeight: 1.05, name: "Figure" }));
    elements.push(words(stat.label, { x: x + 28, y: top + 136, w: w - 56, h: 90 }, { font: ctx.body, color: ctx.p.ink, max: 18, min: 13, lineHeight: 1.4, name: "Label" }));
  });
  if (slide.body) elements.push(words(slide.body, { x: MARGIN_X, y: top + h + 28, w: CONTENT_W, h: SLIDE_H - 90 - (top + h + 28) }, { font: ctx.body, color: ctx.p.muted, max: 17, min: 13, lineHeight: 1.45, name: "Body" }));
  return { background: ctx.p.bg, elements: [...elements, ...footer(ctx)] };
}

function tableSlide(slide: OutlineSlide, ctx: Ctx): Built {
  const headers = (slide.table?.headers ?? []).slice(0, 7);
  const rows = (slide.table?.rows ?? []).slice(0, 12).map((row) => headers.map((_, i) => String(row[i] ?? "")));
  if (headers.length === 0 || rows.length === 0) return bulletsSlide(slide, ctx);
  const head = header(slide, ctx);
  const top = head.bottom;
  const available = SLIDE_H - 76 - top;
  const rowH = Math.max(30, Math.min(52, available / (rows.length + 1)));
  const size = Math.max(11, Math.min(17, Math.round(rowH * 0.36)));

  // Columns share the width by how much they hold, within limits, so a
  // description column is wide and a price column narrow.
  const weight = headers.map((heading, i) => Math.min(40, Math.max(6, Math.max(heading.length, ...rows.map((row) => row[i].length)))));
  const total = weight.reduce((a, b) => a + b, 0);
  const widths = weight.map((n) => (n / total) * CONTENT_W);
  const lefts = widths.map((_, i) => MARGIN_X + widths.slice(0, i).reduce((a, b) => a + b, 0));
  const pad = 14;

  const elements = [...head.elements];
  elements.push(shapeElement({ x: MARGIN_X, y: top, w: CONTENT_W, h: rowH, fill: ctx.p.feature, radius: 6, name: "Header row" }));
  headers.forEach((heading, i) =>
    elements.push(textElement({ x: lefts[i] + pad, y: top + (rowH - size * 1.3) / 2, w: widths[i] - pad * 2, h: size * 1.4, text: heading, fontFamily: ctx.body, fontSize: size - 1, bold: true, color: ctx.p.featureInk, uppercase: true, letterSpacing: 0.8, name: "Heading" }))
  );
  rows.forEach((row, r) => {
    const y = top + rowH * (r + 1);
    if (r % 2 === 0) elements.push(shapeElement({ x: MARGIN_X, y, w: CONTENT_W, h: rowH, fill: ctx.p.soft, name: "Row" }));
    row.forEach((cell, i) =>
      elements.push(
        words(cell, { x: lefts[i] + pad, y: y + 4, w: widths[i] - pad * 2, h: rowH - 8 }, { font: ctx.body, color: ctx.p.ink, max: size, min: 10, lineHeight: 1.2, name: "Cell" })
      )
    );
  });
  return { background: ctx.p.bg, elements: [...elements, ...footer(ctx)] };
}

function quoteSlide(slide: OutlineSlide, ctx: Ctx): Built {
  const text = slide.quote || slide.body || slide.title;
  const elements: DesignElement[] = [
    textElement({ x: MARGIN_X + 40, y: 120, w: 160, h: 140, text: "“", fontFamily: "Georgia", fontSize: 160, color: ctx.p.accent, lineHeight: 1, name: "Quote mark" }),
    words(text, { x: MARGIN_X + 60, y: 250, w: CONTENT_W - 120, h: 230 }, { font: ctx.heading, color: ctx.p.ink, max: 40, min: 22, italic: true, lineHeight: 1.3, name: "Quote" }),
  ];
  if (slide.attribution) {
    elements.push(shapeElement({ x: MARGIN_X + 60, y: 512, w: 40, h: 2, fill: ctx.p.accent, name: "Accent" }));
    elements.push(words(slide.attribution, { x: MARGIN_X + 116, y: 500, w: 700, h: 30 }, { font: ctx.body, color: ctx.p.muted, max: 16, min: 12, uppercase: true, letterSpacing: 2, name: "Attribution" }));
  }
  return { background: ctx.p.soft, elements: [...elements, ...footer(ctx)] };
}

function columnsSlide(slide: OutlineSlide, ctx: Ctx): Built {
  const columns = (slide.columns ?? []).filter((column) => column.heading || column.bullets?.length).slice(0, 3);
  if (columns.length === 0) return bulletsSlide(slide, ctx);
  const head = header(slide, ctx);
  const gap = 48;
  const w = (CONTENT_W - gap * (columns.length - 1)) / columns.length;
  const top = head.bottom + 4;
  const elements = [...head.elements];
  columns.forEach((column, n) => {
    const x = MARGIN_X + n * (w + gap);
    if (n > 0) elements.push(shapeElement({ x: x - gap / 2, y: top, w: 1.5, h: SLIDE_H - 100 - top, fill: ctx.p.muted, opacity: 0.25, name: "Divider" }));
    elements.push(words(column.heading, { x, y: top, w, h: 64 }, { font: ctx.heading, color: ctx.p.accent, max: 24, min: 17, bold: false, lineHeight: 1.2, name: "Column heading" }));
    elements.push(...bulletList(column.bullets ?? [], { x, y: top + 76, w, h: SLIDE_H - 100 - top - 76 }, ctx));
  });
  return { background: ctx.p.bg, elements: [...elements, ...footer(ctx)] };
}

function timelineSlide(slide: OutlineSlide, ctx: Ctx): Built {
  const steps = (slide.steps ?? []).filter((step) => step.heading || step.text).slice(0, 6);
  if (steps.length === 0) return bulletsSlide(slide, ctx);
  const head = header(slide, ctx);
  const lineY = Math.max(head.bottom + 50, 290);
  const w = CONTENT_W / steps.length;
  const elements = [...head.elements];
  elements.push(shapeElement({ x: MARGIN_X, y: lineY, w: CONTENT_W, h: 2, shape: "line", stroke: ctx.p.accent, strokeWidth: 2, fill: "transparent", opacity: 0.5, name: "Timeline" }));
  steps.forEach((step, n) => {
    const x = MARGIN_X + n * w;
    elements.push(shapeElement({ x: x, y: lineY - 11, w: 22, h: 22, shape: "ellipse", fill: ctx.p.accent, name: "Marker" }));
    elements.push(textElement({ x, y: lineY - 52, w: w - 20, h: 26, text: String(n + 1).padStart(2, "0"), fontFamily: ctx.heading, fontSize: 18, color: ctx.p.accent, name: "Step number" }));
    elements.push(words(step.heading, { x, y: lineY + 32, w: w - 24, h: 60 }, { font: ctx.heading, color: ctx.p.ink, max: 21, min: 15, lineHeight: 1.2, name: "Step" }));
    elements.push(words(step.text, { x, y: lineY + 100, w: w - 24, h: SLIDE_H - 90 - (lineY + 100) }, { font: ctx.body, color: ctx.p.muted, max: 16, min: 11, lineHeight: 1.45, name: "Step text" }));
  });
  return { background: ctx.p.bg, elements: [...elements, ...footer(ctx)] };
}

function closingSlide(slide: OutlineSlide, ctx: Ctx): Built {
  const { p } = ctx;
  const [cover] = pictures(slide, ctx);
  const elements: DesignElement[] = [];
  if (cover !== undefined) {
    elements.push(photo(cover, 0, 0, SLIDE_W, SLIDE_H));
    elements.push(shapeElement({ x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, fill: p.feature, opacity: 0.7, name: "Shade" }));
  }
  elements.push(words(slide.title || "Thank you", { x: 140, y: 250, w: SLIDE_W - 280, h: 130 }, { font: ctx.heading, color: p.featureInk, max: 60, min: 34, align: "center", lineHeight: 1.1, name: "Title" }));
  elements.push(shapeElement({ x: SLIDE_W / 2 - 28, y: 396, w: 56, h: 3, fill: p.featureMuted, name: "Accent" }));
  const line = [slide.subtitle, slide.body].filter(Boolean).join("\n");
  if (line) elements.push(words(line, { x: 200, y: 424, w: SLIDE_W - 400, h: 110 }, { font: ctx.body, color: p.featureMuted, max: 18, min: 13, align: "center", lineHeight: 1.5, name: "Details" }));
  return { background: p.feature, elements };
}

// ── The deck ────────────────────────────────────────────────────────────────

function buildSlide(slide: OutlineSlide, ctx: Ctx, sectionNumber: number): DesignSlide {
  const built =
    slide.layout === "title"
      ? titleSlide(slide, ctx)
      : slide.layout === "section"
        ? sectionSlide(slide, ctx, sectionNumber)
        : slide.layout === "image-left"
          ? imageSideSlide(slide, ctx, "left")
          : slide.layout === "image-right"
            ? imageSideSlide(slide, ctx, "right")
            : slide.layout === "image-full"
              ? imageFullSlide(slide, ctx)
              : slide.layout === "gallery"
                ? gallerySlide(slide, ctx)
                : slide.layout === "stats"
                  ? statsSlide(slide, ctx)
                  : slide.layout === "table"
                    ? tableSlide(slide, ctx)
                    : slide.layout === "quote"
                      ? quoteSlide(slide, ctx)
                      : slide.layout === "columns"
                        ? columnsSlide(slide, ctx)
                        : slide.layout === "timeline"
                          ? timelineSlide(slide, ctx)
                          : slide.layout === "closing"
                            ? closingSlide(slide, ctx)
                            : bulletsSlide(slide, ctx);
  // The outline's id, so a rebuild can tell which page is which.
  return { id: slide.id, background: built.background, elements: built.elements };
}

function themeOf(outline: PresentationOutline) {
  const p = PALETTES[outline.theme?.palette] ?? PALETTES.ivory;
  const heading = HEADING_FONTS.includes(outline.theme?.headingFont) ? outline.theme.headingFont : "Georgia";
  const body = BODY_FONTS.includes(outline.theme?.bodyFont) ? outline.theme.bodyFont : "Helvetica";
  return { p, heading, body };
}

/** Every slide laid out fresh. */
export function buildPresentationDesign(outline: PresentationOutline, imageCount: number): DeckDesign {
  return rebuildDesign(outline, imageCount, null, null);
}

/**
 * Lays out an edited outline, keeping every page the edit didn't touch.
 *
 * A page is reused — with whatever the person moved, retyped or restyled on
 * it — when its outline is word-for-word what it was and the theme hasn't
 * changed. Anything else (a changed page, a new one, a new theme) is laid out
 * again. Page numbers are refreshed everywhere, since inserting a page moves
 * every one after it.
 */
export function rebuildDesign(
  outline: PresentationOutline,
  imageCount: number,
  previousOutline: PresentationOutline | null,
  previousDesign: DeckDesign | null
): DeckDesign {
  const theme = themeOf(outline);
  const sameTheme = previousOutline && JSON.stringify(previousOutline.theme) === JSON.stringify(outline.theme);
  const before = new Map((previousOutline?.slides ?? []).map((slide) => [slide.id, JSON.stringify(slide)]));
  const drawn = new Map((previousDesign?.slides ?? []).map((slide) => [slide.id, slide]));

  let section = 0;
  const slides = outline.slides.map((slide, index) => {
    if (slide.layout === "section") section += 1;
    const ctx: Ctx = { ...theme, number: index + 1, total: outline.slides.length, deckTitle: outline.title, imageCount };
    const kept = drawn.get(slide.id);
    if (sameTheme && kept && before.get(slide.id) === JSON.stringify(slide)) {
      return {
        ...kept,
        elements: kept.elements.map((element) =>
          element.type === "text" && element.name === "Page number" ? { ...element, text: String(index + 1).padStart(2, "0") } : element
        ),
      };
    }
    return buildSlide(slide, ctx, section);
  });

  /*
   * Pages the person added in the editor have no outline behind them, so the
   * model never saw them and its outline can't mention them. They are kept,
   * each re-inserted after the page it followed — dropping them on every
   * chat edit would throw away their work.
   */
  if (previousDesign && previousOutline) {
    const outlined = new Set(previousOutline.slides.map((slide) => slide.id));
    previousDesign.slides.forEach((page, index) => {
      if (outlined.has(page.id)) return;
      const before = previousDesign.slides[index - 1]?.id;
      const at = before ? slides.findIndex((slide) => slide.id === before) : -1;
      slides.splice(at + 1, 0, page);
    });
  }

  return {
    version: 1,
    slides,
    brand: { logos: [], colors: [theme.p.accent, theme.p.ink, theme.p.feature, theme.p.soft, theme.p.bg, "#FFFFFF"], headingFont: theme.heading, bodyFont: theme.body },
  };
}

/** The editor resolves `pieceIndex` through pieces; the deck's pictures become pieces with no sheets. */
export function imagesAsPieces(images: string[]): AffinityPiece[] {
  return images.map((src, index) => ({ id: `image-${index}`, image: src, sheetImages: [], sheetExcelText: [], designerInitial: "" }));
}

/**
 * Whether a value is a usable outline — the shape check a saved kit or a job
 * result passes before anything is drawn from it.
 */
export function isOutline(value: unknown): value is PresentationOutline {
  const outline = value as PresentationOutline | null;
  return Boolean(outline && typeof outline === "object" && Array.isArray(outline.slides) && outline.slides.length > 0);
}
