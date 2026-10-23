"use client";

import type { AffinityPiece } from "./affinity";
import { imageElement, shapeElement, textElement, uid, type DeckDesign, type DesignElement, type DesignSlide } from "./deckDesign";

/**
 * Line Sheet: an Excel price list with a photo in each row, turned into a
 * PowerPoint of four products a slide — each a white card with its photo and
 * a two-row table of style number, stones and price.
 *
 * No AI anywhere: it is a straight copy from the workbook into a fixed
 * layout, done entirely in the browser. The layout is measured off the
 * team's own "HALO RINGS" deck, so the output reads as the same document.
 *
 * Each row's photo is used exactly as it sits in the workbook — the same
 * picture, only scaled to fit its card, never cropped, recoloured or edited.
 */

export type LineSheetRow = {
  /** The workbook row it came from, 1-based, for messages. */
  row: number;
  styleNo: string;
  category: string;
  diaCombination: string;
  centerShape: string;
  centerWt: string;
  totalDiaWt: string;
  price: string;
  /** The row's photo as a data URI, or null when the row has none. */
  image: string | null;
  /** The cells exactly as the workbook has them, for the page's preview table. */
  excel: { srNo: string; styleNo: string; diaWt: string; centerWt: string; price: string };
};

export type ParsedLineSheet = { rows: LineSheetRow[]; missingImages: string[] };

/**
 * What each table column is called in the workbook. Matched loosely —
 * case, spaces and dots ignored — so "Dia.Combination" and "Dia. Combination"
 * both land.
 */
const HEADERS = {
  styleNo: ["styleno", "style"],
  category: ["category"],
  diaCombination: ["diacombination"],
  centerShape: ["centershape"],
  centerWt: ["centerwt", "centerweight"],
  totalDiaWt: ["diawt", "totaldiawt", "totaldiaweight"],
  price: ["sellingprice", "price"],
} as const;

type Field = keyof typeof HEADERS;

const squash = (value: unknown) => String(value ?? "").toLowerCase().replace(/[^a-z]/g, "");

/** "RE-16300-IS-TT" → "RE-16300": the deck shows the base style only, upper-cased. */
export function baseStyleNo(raw: string) {
  const parts = raw.trim().toUpperCase().split("-").filter(Boolean);
  return parts.slice(0, 2).join("-");
}

function formatWeight(value: unknown) {
  if (value === "" || value === null || value === undefined) return "";
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : String(value).trim();
}

function formatPrice(value: unknown) {
  if (value === "" || value === null || value === undefined) return "";
  const number = Number(String(value).replace(/[$,\s]/g, ""));
  return Number.isFinite(number) ? `$${number.toFixed(2)}` : String(value).trim();
}

/** Cell text with Windows line breaks and doubled spaces tidied; line breaks kept. */
function cleanText(value: unknown) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** A cell as Excel shows it: 0.34400000000000003 is stored float noise for 0.344. */
function asShown(value: unknown) {
  return typeof value === "number" ? String(Number(value.toPrecision(10))) : cleanText(value);
}

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  webp: "image/webp",
};

/** Resolves "../media/image1.jpeg" against "xl/drawings/drawing1.xml". */
function resolvePath(base: string, target: string) {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const piece of target.split("/")) {
    if (piece === "..") parts.pop();
    else if (piece !== ".") parts.push(piece);
  }
  return parts.join("/");
}

function relsPathFor(path: string) {
  const parts = path.split("/");
  const file = parts.pop();
  return [...parts, "_rels", `${file}.rels`].join("/");
}

function parseRels(xml: string) {
  const map = new Map<string, string>();
  for (const match of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = match[0].match(/\bId="([^"]+)"/)?.[1];
    const target = match[0].match(/\bTarget="([^"]+)"/)?.[1];
    if (id && target) map.set(id, target);
  }
  return map;
}

/**
 * Every picture placed on the first sheet, keyed by the 0-based row its top
 * edge sits in. Excel keeps pictures in a drawing beside the sheet, not in
 * the cells, so this reads the package directly.
 */
async function picturesByRow(file: ArrayBuffer): Promise<Map<number, string>> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(file);
  const read = (path: string) => zip.file(path)?.async("string") ?? Promise.resolve("");

  const workbookRels = parseRels(await read("xl/_rels/workbook.xml.rels"));
  const workbook = await read("xl/workbook.xml");
  const firstSheetRid = workbook.match(/<sheet\b[^>]*r:id="([^"]+)"/)?.[1];
  const sheetPath = firstSheetRid && workbookRels.get(firstSheetRid)
    ? resolvePath("xl/workbook.xml", workbookRels.get(firstSheetRid)!)
    : "xl/worksheets/sheet1.xml";

  const sheetRels = parseRels(await read(relsPathFor(sheetPath)));
  const sheet = await read(sheetPath);
  const drawingRid = sheet.match(/<drawing\b[^>]*r:id="([^"]+)"/)?.[1];
  const result = new Map<number, string>();
  if (!drawingRid || !sheetRels.get(drawingRid)) return result;

  const drawingPath = resolvePath(sheetPath, sheetRels.get(drawingRid)!);
  const drawingRels = parseRels(await read(relsPathFor(drawingPath)));
  const drawing = await read(drawingPath);

  const anchors = drawing.match(/<xdr:(twoCellAnchor|oneCellAnchor|absoluteAnchor)\b[\s\S]*?<\/xdr:\1>/g) ?? [];
  for (const anchor of anchors) {
    const row = anchor.match(/<xdr:from>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>/)?.[1];
    const embed = anchor.match(/<a:blip\b[^>]*r:embed="([^"]+)"/)?.[1];
    if (row === undefined || !embed || !drawingRels.get(embed)) continue;
    const rowIndex = Number(row);
    // A row with two pictures keeps the first, as it reads on screen.
    if (result.has(rowIndex)) continue;
    const mediaPath = resolvePath(drawingPath, drawingRels.get(embed)!);
    const mime = MIME_BY_EXT[mediaPath.split(".").pop()?.toLowerCase() ?? ""];
    const media = zip.file(mediaPath);
    if (!mime || !media) continue;
    result.set(rowIndex, `data:${mime};base64,${await media.async("base64")}`);
  }
  return result;
}

/**
 * The workbook's product rows: found under the header row (the first row
 * with a "Style No." heading), one per row that has a style number.
 */
export async function parseLineSheet(file: File): Promise<ParsedLineSheet> {
  const buffer = await file.arrayBuffer();
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("That workbook has no sheets.");

  // Row indexes here must match the drawing's, which count from A1.
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1");
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", blankrows: true, raw: true });
  const offset = range.s.r;

  const headerIndex = grid.findIndex((cells) => cells.some((cell) => HEADERS.styleNo.includes(squash(cell) as never)));
  if (headerIndex < 0) throw new Error("Couldn't find the header row — the sheet needs a “STYLE NO.” column.");

  const columns: Partial<Record<Field, number>> = {};
  grid[headerIndex].forEach((cell, index) => {
    const name = squash(cell);
    for (const field of Object.keys(HEADERS) as Field[]) {
      if (columns[field] === undefined && (HEADERS[field] as readonly string[]).includes(name)) columns[field] = index;
    }
  });
  const missing = (["styleNo", "diaCombination", "price"] as Field[]).filter((field) => columns[field] === undefined);
  if (missing.length) {
    const names = { styleNo: "STYLE NO.", diaCombination: "Dia. Combination", price: "SELLING PRICE" } as Record<string, string>;
    throw new Error(`The sheet is missing: ${missing.map((field) => names[field]).join(", ")}.`);
  }

  const pictures = await picturesByRow(buffer);
  const cell = (cells: unknown[], field: Field) => (columns[field] === undefined ? "" : cells[columns[field]!]);

  const rows: LineSheetRow[] = [];
  const missingImages: string[] = [];
  grid.slice(headerIndex + 1).forEach((cells, index) => {
    const rawStyle = cleanText(cell(cells, "styleNo"));
    if (!rawStyle) return;
    const sheetRow = headerIndex + 1 + index + offset;
    const image = pictures.get(sheetRow) ?? null;
    const styleNo = baseStyleNo(rawStyle);
    if (!image) missingImages.push(styleNo);
    rows.push({
      row: sheetRow + 1,
      styleNo,
      category: cleanText(cell(cells, "category")),
      diaCombination: cleanText(cell(cells, "diaCombination")),
      centerShape: cleanText(cell(cells, "centerShape")),
      centerWt: formatWeight(cell(cells, "centerWt")),
      totalDiaWt: formatWeight(cell(cells, "totalDiaWt")),
      price: formatPrice(cell(cells, "price")),
      image,
      excel: {
        srNo: cleanText(cells[0]),
        styleNo: rawStyle,
        diaWt: asShown(cell(cells, "totalDiaWt")),
        centerWt: asShown(cell(cells, "centerWt")),
        price: asShown(cell(cells, "price")),
      },
    });
  });
  if (rows.length === 0) throw new Error("No products found under the header row.");
  return { rows, missingImages };
}


// ── Layout, in the editor's 1280×720 slide px ──────────────────────────────
//
// The HALO RINGS deck's look (framed cards, photo over a two-row table), set
// on an even grid: the same GAP around the page and between the cards, and
// the same PAD inside every card on all four sides.

const SLIDE_W = 1280;
const SLIDE_H = 720;
const GAP = 24;
const PAD = 12;
const CARD = { w: (SLIDE_W - 3 * GAP) / 2, h: (SLIDE_H - 3 * GAP) / 2 };
const CARDS = [
  { x: GAP, y: GAP },
  { x: 2 * GAP + CARD.w, y: GAP },
  { x: GAP, y: 2 * GAP + CARD.h },
  { x: 2 * GAP + CARD.w, y: 2 * GAP + CARD.h },
];
const ROW_H = 58;
/** The table hugs the card's bottom padding; the photo fills the rest, PAD from the table. */
const TABLE = { dx: PAD, dy: CARD.h - PAD - 2 * ROW_H, w: CARD.w - 2 * PAD, rowH: ROW_H };
const PHOTO = { dx: PAD, dy: PAD, w: CARD.w - 2 * PAD, h: TABLE.dy - 2 * PAD };
/** The sample deck's column proportions, scaled to the table's width. */
const COLUMN_RATIOS = [1.0, 1.23, 0.94, 1.05, 0.86, 0.91];
const COLUMN_WIDTHS = COLUMN_RATIOS.map((ratio) => (ratio / COLUMN_RATIOS.reduce((a, b) => a + b)) * TABLE.w);
const TABLE_HEADINGS = ["STYLE NO.", "Dia. Combination", "Center Shape", "Center Wt.", "Total dia wt", "SELLING PRICE"];

const px = (value: number) => Math.round(value * 100) / 100;
/** 10pt, in the editor's px (the PPTX export turns px back into points at ×0.75). */
const FONT_SIZE = 13.33;
const LINE_HEIGHT = 1.15;

/** The rows as the editor's pieces: each row's photo, referenced by index rather than copied into the design. */
export function lineSheetPieces(rows: LineSheetRow[]): AffinityPiece[] {
  return rows.map((row) => ({ id: `row-${row.row}`, image: row.image ?? "", sheetImages: [], sheetExcelText: [], designerInitial: "" }));
}

/**
 * The line sheet as a free-form design for Collection Story's editor: four
 * cards a slide, each a framed box with its photo and a two-row table — the
 * table built from cell boxes and text so every piece can be moved, restyled
 * or deleted. A card's parts share a group, so a card moves as one.
 *
 * Each photo is the workbook's own picture, untouched — only fitted to its box.
 */
export function buildLineSheetDesign(rows: LineSheetRow[]): DeckDesign {
  const pages = Math.ceil(rows.length / CARDS.length);
  const slides: DesignSlide[] = [];

  for (let page = 0; page < pages; page++) {
    const elements: DesignElement[] = [];
    rows.slice(page * CARDS.length, (page + 1) * CARDS.length).forEach((row, index) => {
      const card = CARDS[index];
      const pieceIndex = page * CARDS.length + index;
      const groupId = uid();
      const name = row.styleNo;

      elements.push(
        shapeElement({
          x: px(card.x),
          y: px(card.y),
          w: px(CARD.w),
          h: px(CARD.h),
          fill: "#FFFFFF",
          stroke: "#9BA5AF",
          strokeWidth: 1,
          groupId,
          name: `${name} card`,
        })
      );
      if (row.image) {
        elements.push(
          imageElement({
            x: px(card.x + PHOTO.dx),
            y: px(card.y + PHOTO.dy),
            w: px(PHOTO.w),
            h: px(PHOTO.h),
            pieceIndex,
            fit: "contain",
            groupId,
            name: `${name} photo`,
          })
        );
      }

      const values = [row.styleNo, row.diaCombination, row.centerShape, row.centerWt, row.totalDiaWt, row.price];
      [TABLE_HEADINGS, values].forEach((cells, rowIndex) => {
        let x = card.x + TABLE.dx;
        const y = card.y + TABLE.dy + rowIndex * TABLE.rowH;
        cells.forEach((value, column) => {
          const width = COLUMN_WIDTHS[column];
          const text = value || "–";
          elements.push(
            shapeElement({
              x: px(x),
              y: px(y),
              w: px(width),
              h: px(TABLE.rowH),
              fill: rowIndex === 0 ? "#DDE7EF" : "#F9FAFB",
              stroke: "#FFFFFF",
              strokeWidth: 1.5,
              groupId,
              name: `${name} cell`,
            })
          );
          // Text boxes are top-aligned, so each sits centred by its line count.
          const textH = text.split("\n").length * FONT_SIZE * LINE_HEIGHT;
          elements.push(
            textElement({
              x: px(x) + 2,
              y: px(y) + (px(TABLE.rowH) - textH) / 2,
              w: px(width) - 4,
              h: textH,
              text,
              fontFamily: "Calibri",
              fontSize: FONT_SIZE,
              bold: rowIndex === 0,
              color: "#000000",
              align: "center",
              lineHeight: LINE_HEIGHT,
              groupId,
            })
          );
          x += width;
        });
      });
    });

    slides.push({ id: uid(), background: "#FFFFFF", elements });
  }

  return { version: 1, slides };
}
