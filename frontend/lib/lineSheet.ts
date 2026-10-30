"use client";

import type { AffinityPiece } from "./affinity";
import { imageElement, shapeElement, textElement, uid, type DeckDesign, type DesignElement, type DesignSlide } from "./deckDesign";

/**
 * Line Sheet: an Excel price list with photos in its rows, turned into a
 * PowerPoint of product cards — each a white card with its photo(s) and a
 * table of the row's details.
 *
 * No AI anywhere: it is a straight copy from the workbook into a layout, done
 * entirely in the browser. The look is measured off the team's own "HALO
 * RINGS" deck, so the output reads as the same document.
 *
 * The workbook's layout is not fixed. Whatever the sheet calls its columns
 * and in whatever order, the reader works out for itself:
 *  - which row is the heading row (a title or logo above it is skipped),
 *  - which column the photos sit in, and how many photos each product has,
 *  - which column is the style / design number,
 *  - which columns are a serial number, or empty, and so are left out,
 * and keeps every other column, in the sheet's order, under the sheet's own
 * heading. The card layout then adapts to how many columns that leaves.
 *
 * Each photo is used exactly as it sits in the workbook — the same picture,
 * only scaled to fit its card, never cropped, recoloured or edited.
 */

export type LineSheetRow = {
  /** The workbook row it came from, 1-based, for messages. */
  row: number;
  /** The style or design number as the deck shows it. */
  id: string;
  /** The other columns as the deck shows them, in `ParsedLineSheet.fields` order. */
  values: string[];
  /** The row's photos as data URIs, left to right — none, one or a few. */
  images: string[];
  /** The cells as the workbook shows them, for the page's preview table. */
  excel: { serial: string; id: string; values: string[] };
};

export type ParsedLineSheet = {
  rows: LineSheetRow[];
  /** The style / design number column's own heading — "STYLE NO.", "Design Code"… */
  idHeading: string;
  /** Every other column kept, by its own heading, in the sheet's order. */
  fields: string[];
  /** Whether the sheet had a serial-number column, which the preview shows and the deck leaves out. */
  hasSerial: boolean;
  /** Which tab the products were read from, where the workbook has more than one. */
  sheetName: string | null;
  missingImages: string[];
};

/** The most photos one card shows side by side. More in a row are left out. */
export const MAX_PHOTOS = 3;

// ── Reading cells ──────────────────────────────────────────────────────────

/** Letters only, lower-case — "Style No." and "STYLE NO" are both "styleno". */
const squash = (value: unknown) => String(value ?? "").toLowerCase().replace(/[^a-z]/g, "");

/** Cell text with Windows line breaks and doubled spaces tidied; line breaks kept. */
function cleanText(value: unknown) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * Headings that name the style / design number, best first: where a sheet
 * has both a "Style No." and an "Item Code", the style number is the one the
 * deck leads with. Compared squashed.
 */
const ID_HEADINGS = [
  "styleno",
  "stylenumber",
  "stylecode",
  "styleid",
  "style",
  "designno",
  "designnumber",
  "designcode",
  "designid",
  "design",
  "itemcode",
  "itemno",
  "itemnumber",
  "sku",
  "skuno",
  "skucode",
  "articleno",
  "articlecode",
  "article",
  "modelno",
  "modelnumber",
  "productcode",
  "productno",
  "productid",
  "refno",
  "referenceno",
  "code",
  "item",
];

const SERIAL_HEADINGS = ["srno", "sno", "sr", "slno", "serialno", "serial", "sn", "no", "num", "number", "index"];
const IMAGE_HEADING = /image|photo|picture|^pics?$|^img$|thumbnail/i;
/** Words a heading row tends to contain — what tells it from a title or a note above the table. */
const HEADING_WORDS =
  /style|design|item|sku|code|model|article|image|photo|picture|category|type|price|cost|mrp|amount|weight|\bwt\b|qty|quantity|pcs|shape|size|colou?r|metal|karat|\bkt\b|gold|dia|diamond|stone|description|remark|sr\.?|no\.?|setting|cut|clarity/i;
const TOTAL_ROW = /^(grand\s*|sub\s*)?total\b/i;

/** "RE-16300-IS-TT" → "RE-16300": the team's style numbers show their base only, upper-cased. */
function displayId(raw: string) {
  const value = cleanText(raw);
  if (/^[A-Z]{1,4}-\d{3,}(?:-[A-Z0-9]+)+$/i.test(value)) return value.toUpperCase().split("-").slice(0, 2).join("-");
  return value;
}

const isPriceHeading = (heading: string) => /price|mrp|cost|amount/i.test(heading);
const isWeightHeading = (heading: string) => /(^|[^a-z])(wt|weight|carat|cts?)([^a-z]|$)/i.test(heading.replace(/\./g, " "));

/**
 * How a value reads on the deck. Prices and weights keep the team deck's
 * format ("$54.00", "0.33") when the cell holds a plain number; anything the
 * sheet already formats itself, and every other column, is shown as Excel
 * shows it.
 */
function deckValue(heading: string, raw: unknown, shown: string) {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const hasUnit = /[^\d.,\s-]/.test(shown);
    if (isPriceHeading(heading) && !hasUnit) return `$${raw.toFixed(2)}`;
    if (isWeightHeading(heading) && !hasUnit) return raw.toFixed(2);
  }
  return cleanText(shown);
}

// ── Reading pictures ───────────────────────────────────────────────────────

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

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];

/** "AB12" → { row: 11, col: 27 }, both 0-based. */
function decodeRef(ref: string) {
  const match = ref.match(/^([A-Z]+)(\d+)$/);
  if (!match) return null;
  const col = [...match[1]].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0) - 1;
  return { row: Number(match[2]) - 1, col };
}

/**
 * One picture on a sheet: which row its middle sits in (0-based, from A1),
 * how far across it starts (for left-to-right order), and the column it is
 * anchored in.
 */
type Picture = { row: number; col: number; across: number; src: string };

type Zip = import("jszip");
const EMU_PER_PT = 12700;

/** Every sheet's package path by its tab name. */
async function sheetPaths(zip: Zip) {
  const read = (path: string) => zip.file(path)?.async("string") ?? Promise.resolve("");
  const rels = parseRels(await read("xl/_rels/workbook.xml.rels"));
  const workbook = await read("xl/workbook.xml");
  const paths = new Map<string, string>();
  for (const match of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(match[0], "name");
    const target = rels.get(attr(match[0], "r:id") ?? "");
    if (name && target) paths.set(decodeXml(name), resolvePath("xl/workbook.xml", target));
  }
  return paths;
}

const decodeXml = (text: string) =>
  text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

async function mediaUri(zip: Zip, path: string) {
  const mime = MIME_BY_EXT[path.split(".").pop()?.toLowerCase() ?? ""];
  const media = zip.file(path);
  // EMF, WMF and TIFF can't be shown in a browser or a slide reliably — skipped.
  if (!mime || !media) return null;
  return `data:${mime};base64,${await media.async("base64")}`;
}

/**
 * Every picture on one sheet — both kinds Excel makes:
 *  - floating pictures, kept in a drawing beside the sheet and placed by
 *    anchor; their row is the one their middle sits in, worked out from the
 *    sheet's own row heights, so a photo that pokes a little into the row
 *    above still belongs to the row it is in;
 *  - pictures placed in a cell ("Place in Cell"), kept as rich values of
 *    that cell.
 */
async function readPictures(zip: Zip, sheetPath: string): Promise<Picture[]> {
  const read = (path: string) => zip.file(path)?.async("string") ?? Promise.resolve("");
  const sheet = await read(sheetPath);
  const pictures: Picture[] = [];

  // Row heights in points, for placing floating pictures.
  const defaultHeight = Number(attr(sheet.match(/<sheetFormatPr\b[^>]*>/)?.[0] ?? "", "defaultRowHeight")) || 15;
  const heights = new Map<number, number>();
  for (const match of sheet.matchAll(/<row\b[^>]*>/g)) {
    const r = Number(attr(match[0], "r"));
    const ht = attr(match[0], "ht");
    if (r && ht) heights.set(r - 1, attr(match[0], "hidden") === "1" ? 0 : Number(ht));
  }
  const tops: number[] = [0];
  const topOf = (row: number) => {
    for (let r = tops.length; r <= row; r++) tops[r] = tops[r - 1] + (heights.get(r - 1) ?? defaultHeight);
    return tops[row];
  };
  const rowAt = (y: number) => {
    let row = 0;
    while (topOf(row + 1) <= y) row++;
    return row;
  };

  // Floating pictures.
  const sheetRels = parseRels(await read(relsPathFor(sheetPath)));
  const drawingTarget = sheetRels.get(sheet.match(/<drawing\b[^>]*r:id="([^"]+)"/)?.[1] ?? "");
  if (drawingTarget) {
    const drawingPath = resolvePath(sheetPath, drawingTarget);
    const drawingRels = parseRels(await read(relsPathFor(drawingPath)));
    const drawing = await read(drawingPath);
    const anchors = drawing.match(/<xdr:(twoCellAnchor|oneCellAnchor|absoluteAnchor)\b[\s\S]*?<\/xdr:\1>/g) ?? [];

    for (const anchor of anchors) {
      const point = (tag: "from" | "to") => {
        const block = anchor.match(new RegExp(`<xdr:${tag}>([\\s\\S]*?)</xdr:${tag}>`))?.[1];
        if (!block) return null;
        const num = (name: string) => Number(block.match(new RegExp(`<xdr:${name}>(-?\\d+)</xdr:${name}>`))?.[1] ?? 0);
        return { col: num("col"), colOff: num("colOff"), row: num("row"), rowOff: num("rowOff") };
      };
      const from = point("from");
      const to = point("to");
      const ext = anchor.match(/<xdr:ext\b[^>]*>/)?.[0];
      const pos = anchor.match(/<xdr:pos\b[^>]*>/)?.[0];

      let top: number;
      let bottom: number;
      let col: number;
      let across: number;
      if (from) {
        top = topOf(from.row) + from.rowOff / EMU_PER_PT;
        bottom = to ? topOf(to.row) + to.rowOff / EMU_PER_PT : top + Number(attr(ext ?? "", "cy") ?? 0) / EMU_PER_PT;
        col = from.col;
        across = from.col * 1e8 + from.colOff;
      } else if (pos) {
        top = Number(attr(pos, "y") ?? 0) / EMU_PER_PT;
        bottom = top + Number(attr(ext ?? "", "cy") ?? 0) / EMU_PER_PT;
        col = -1;
        across = Number(attr(pos, "x") ?? 0);
      } else continue;

      // A group of pictures shares its anchor; each is still its own photo.
      for (const blip of anchor.matchAll(/<a:blip\b[^>]*r:embed="([^"]+)"/g)) {
        const target = drawingRels.get(blip[1]);
        const src = target ? await mediaUri(zip, resolvePath(drawingPath, target)) : null;
        if (src) pictures.push({ row: rowAt((top + Math.max(top, bottom)) / 2), col, across, src });
      }
    }
  }

  // Pictures placed in cells: the cell's value-metadata index leads, through
  // the rich-value tables, to the picture's relationship.
  const inCell = [...sheet.matchAll(/<c\b[^>]*\bvm="(\d+)"[^>]*>/g)];
  if (inCell.length) {
    const metadata = await read("xl/metadata.xml");
    const futureBlocks = metadata.match(/<futureMetadata\b[^>]*name="XLRICHVALUE"[^>]*>([\s\S]*?)<\/futureMetadata>/)?.[1] ?? "";
    const richIndexes = [...futureBlocks.matchAll(/<bk>[\s\S]*?<\/bk>/g)].map((bk) => Number(bk[0].match(/rvb\b[^>]*\bi="(\d+)"/)?.[1] ?? -1));
    const valueBlocks = metadata.match(/<valueMetadata\b[^>]*>([\s\S]*?)<\/valueMetadata>/)?.[1] ?? "";
    const valueToFuture = [...valueBlocks.matchAll(/<bk>[\s\S]*?<\/bk>/g)].map((bk) => Number(bk[0].match(/<rc\b[^>]*\bv="(\d+)"/)?.[1] ?? -1));

    const structures = [...(await read("xl/richData/rdrichvaluestructure.xml")).matchAll(/<s\b[^>]*>([\s\S]*?)<\/s>/g)].map((s) =>
      [...s[1].matchAll(/<k\b[^>]*\bn="([^"]+)"/g)].map((k) => k[1])
    );
    const richValues = [...(await read("xl/richData/rdrichvalue.xml")).matchAll(/<rv\b([^>]*)>([\s\S]*?)<\/rv>/g)].map((rv) => {
      const keys = structures[Number(attr(rv[1], "s") ?? 0)] ?? [];
      const values = [...rv[2].matchAll(/<v\b[^>]*>([^<]*)<\/v>/g)].map((v) => v[1]);
      const at = keys.indexOf("_rvRel:LocalImageIdentifier");
      return Number(values[at >= 0 ? at : 0]);
    });
    const relIds = [...(await read("xl/richData/richValueRel.xml")).matchAll(/<rel\b[^>]*r:id="([^"]+)"/g)].map((rel) => rel[1]);
    const relTargets = parseRels(await read("xl/richData/_rels/richValueRel.xml.rels"));

    for (const cell of inCell) {
      const ref = decodeRef(attr(cell[0], "r") ?? "");
      const future = valueToFuture[Number(cell[1]) - 1];
      const rich = richIndexes[future];
      const target = relTargets.get(relIds[richValues[rich]] ?? "");
      if (!ref || !target) continue;
      const src = await mediaUri(zip, resolvePath("xl/richData/richValueRel.xml", target));
      if (src) pictures.push({ row: ref.row, col: ref.col, across: ref.col * 1e8, src });
    }
  }

  return pictures;
}

// ── Finding the table ──────────────────────────────────────────────────────

type Grid = { shown: string[][]; raw: unknown[][]; rowOffset: number; colOffset: number };

function readGrid(XLSX: typeof import("xlsx"), sheet: import("xlsx").WorkSheet): Grid {
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1");
  const options = { header: 1 as const, defval: "", blankrows: true };
  const shown = XLSX.utils.sheet_to_json<unknown[]>(sheet, { ...options, raw: false }).map((row) => row.map((cell) => String(cell ?? "")));
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { ...options, raw: true });

  // A merged cell's value belongs to every cell it covers: a heading merged
  // across two columns names both, a category merged down five rows is each
  // of those products' category.
  for (const merge of sheet["!merges"] ?? []) {
    const r0 = merge.s.r - range.s.r;
    const c0 = merge.s.c - range.s.c;
    for (let r = r0; r <= merge.e.r - range.s.r; r++) {
      for (let c = c0; c <= merge.e.c - range.s.c; c++) {
        if (r === r0 && c === c0) continue;
        (shown[r] ??= [])[c] = shown[r0]?.[c0] ?? "";
        (raw[r] ??= [])[c] = raw[r0]?.[c0] ?? "";
      }
    }
  }
  return { shown, raw, rowOffset: range.s.r, colOffset: range.s.c };
}

const isLabel = (shown: string, raw: unknown) =>
  typeof raw === "string" && shown.trim().length > 0 && shown.trim().length <= 40 && !/^[\d.,\s$%-]+$/.test(shown);

/**
 * The heading row: of the first forty rows, the one that looks most like a
 * row of column names — several short text cells, words a jewellery sheet's
 * headings use, no numbers — with something under it. A title ("HALO RINGS")
 * is one cell, and a product row is mostly numbers, so neither wins.
 */
function findHeadingRow(grid: Grid) {
  let best = -1;
  let bestScore = 0;
  const limit = Math.min(grid.shown.length, 40);
  for (let r = 0; r < limit; r++) {
    const row = grid.shown[r] ?? [];
    const filled = row.filter((cell) => cell.trim());
    const labels = row.filter((cell, c) => isLabel(cell, grid.raw[r]?.[c]));
    if (labels.length < 2) continue;
    const known = labels.filter((label) => HEADING_WORDS.test(label)).length;
    const score = labels.length + 2 * known - 2 * (filled.length - labels.length);
    const hasBelow = grid.shown.slice(r + 1, r + 6).some((below) => below.some((cell) => cell.trim()));
    if (hasBelow && score > bestScore) {
      best = r;
      bestScore = score;
    }
  }
  return best;
}

/** "B", "AA" — a 0-based column as Excel names it. */
function columnName(index: number) {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

type Table = {
  rows: LineSheetRow[];
  idHeading: string;
  fields: string[];
  hasSerial: boolean;
  pictures: number;
};

/** One sheet's product table, or why there isn't one. */
function readTable(grid: Grid, sheet: import("xlsx").WorkSheet, merges: import("xlsx").Range[], pictures: Picture[]): Table | string {
  const headingRow = findHeadingRow(grid);
  if (headingRow < 0) return "Couldn't find the row of column headings.";

  const width = Math.max(...grid.shown.slice(headingRow).map((row) => row.length), 0);
  let headings = Array.from({ length: width }, (_, c) => cleanText(grid.shown[headingRow]?.[c]));
  let dataStart = headingRow + 1;

  // A heading over two columns ("Diamond" merged over "Wt" and "Pcs") with
  // the names of its parts in the row below: the two read as one heading each.
  const sub = grid.shown[headingRow + 1] ?? [];
  const spanned = merges.filter(
    (merge) => merge.s.r - grid.rowOffset === headingRow && merge.e.r === merge.s.r && merge.e.c > merge.s.c
  );
  const inSpan = (c: number) => spanned.some((merge) => c >= merge.s.c - grid.colOffset && c <= merge.e.c - grid.colOffset);
  const subLabels = sub.map((cell, c) => isLabel(cell, grid.raw[headingRow + 1]?.[c]));
  const subIsHeading =
    subLabels.filter(Boolean).length >= 2 &&
    subLabels.some((label, c) => label && inSpan(c)) &&
    !sub.some((cell, c) => typeof grid.raw[headingRow + 1]?.[c] === "number");
  if (subIsHeading) {
    headings = headings.map((top, c) => {
      const under = cleanText(sub[c]);
      return inSpan(c) && under && under !== top ? `${top} ${under}` : top || under;
    });
    dataStart = headingRow + 2;
  }

  const hiddenRows = sheet["!rows"] ?? [];
  const hiddenCols = sheet["!cols"] ?? [];

  // Rows under the heading that hold anything, short of a totals line.
  const candidates: number[] = [];
  for (let r = dataStart; r < grid.shown.length; r++) {
    const row = grid.shown[r] ?? [];
    if (hiddenRows[r + grid.rowOffset]?.hidden) continue;
    if (!row.some((cell) => cell.trim())) continue;
    if (row.some((cell) => TOTAL_ROW.test(cell.trim()))) continue;
    candidates.push(r);
  }
  if (!candidates.length) return "No products found under the column headings.";

  const cellsOf = (c: number) => candidates.map((r) => cleanText(grid.shown[r]?.[c]));
  const emptyShare = (c: number) => cellsOf(c).filter((value) => !value).length / candidates.length;

  // Pictures, by the grid's own row and column numbering.
  const placed = pictures.map((picture) => ({ ...picture, row: picture.row - grid.rowOffset, col: picture.col - grid.colOffset }));
  const picturesInColumn = (c: number) => placed.filter((p) => p.col === c && p.row >= dataStart).length;

  // Photo columns: named for photos, or holding the sheet's pictures, and
  // otherwise empty — the photos are shown on the card, not as text.
  const imageColumns = new Set<number>();
  for (let c = 0; c < width; c++) {
    const named = IMAGE_HEADING.test(headings[c]);
    const holds = picturesInColumn(c) >= Math.max(1, candidates.length * 0.3);
    if ((named || holds) && emptyShare(c) >= 0.8) imageColumns.add(c);
  }

  // A serial number: named so, or 1, 2, 3… down one of the first two columns.
  const serialColumn = (() => {
    for (let c = 0; c < width; c++) {
      if (imageColumns.has(c)) continue;
      if (SERIAL_HEADINGS.includes(squash(headings[c])) || headings[c].trim() === "#") return c;
    }
    const firstColumns = [...Array(width).keys()].filter((c) => !imageColumns.has(c) && emptyShare(c) < 1).slice(0, 2);
    for (const c of firstColumns) {
      const numbers = candidates.map((r) => grid.raw[r]?.[c]).filter((value): value is number => typeof value === "number");
      if (numbers.length < 3 || numbers.length < candidates.length * 0.8 || !numbers.every(Number.isInteger)) continue;
      const steps = numbers.slice(1).filter((value, i) => value === numbers[i] + 1).length;
      if (steps >= (numbers.length - 1) * 0.8) return c;
    }
    return -1;
  })();

  // The style / design number: by its heading, or failing that by its values
  // — nearly all different, and letters mixed with digits ("RE-25146-STL").
  const usable = [...Array(width).keys()].filter((c) => !imageColumns.has(c) && c !== serialColumn);
  const idColumn = (() => {
    let best = -1;
    let bestRank = Infinity;
    for (const c of usable) {
      const rank = ID_HEADINGS.indexOf(squash(headings[c]));
      if (rank >= 0 && rank < bestRank && emptyShare(c) <= 0.5) {
        best = c;
        bestRank = rank;
      }
    }
    if (best >= 0) return best;

    let bestScore = 0;
    for (const c of usable) {
      const values = cellsOf(c).filter(Boolean);
      if (values.length < candidates.length * 0.6) continue;
      const unique = new Set(values).size / values.length;
      const mixed = values.filter((value) => /[a-z]/i.test(value) && /\d/.test(value)).length / values.length;
      const score = unique >= 0.8 && mixed >= 0.5 ? unique + mixed : 0;
      if (score > bestScore) {
        best = c;
        bestScore = score;
      }
    }
    return best;
  })();
  if (idColumn < 0) return "Couldn't tell which column holds the style or design number.";

  // A product: a row with a style number — or, without one, a row that has a
  // photo and something else written in it.
  const photosByRow = new Map<number, Picture[]>();
  const productRows = candidates.filter((r) => cleanText(grid.shown[r]?.[idColumn]));
  // Pictures belong to the product row at or above them; the last product
  // owns as much space below it as products are apart.
  const spacing = productRows.length > 1 ? Math.max(1, Math.round((productRows.at(-1)! - productRows[0]) / (productRows.length - 1))) : 1;
  const ownerOf = (row: number, starts: number[]) => {
    let owner = -1;
    for (const start of starts) if (start <= row) owner = start;
    if (owner < 0 || (owner === starts.at(-1) && row >= owner + spacing)) return -1;
    return owner;
  };
  // Against every written row, not just the numbered ones: a picture beside
  // a row with no style number is that row's, not the product's above it. A
  // picture over a blank row is the product's above — one taller than a row.
  // Anything above the table (a logo) has no owner and is left out.
  for (const picture of placed) {
    if (picture.row < dataStart) continue;
    const owner = ownerOf(picture.row, candidates);
    if (owner < 0) continue;
    photosByRow.set(owner, [...(photosByRow.get(owner) ?? []), picture]);
  }

  const rowsKept = candidates.filter((r) => productRows.includes(r) || photosByRow.has(r));
  if (!rowsKept.length) return "No products found under the column headings.";

  // Everything else, in the sheet's order — less hidden and empty columns,
  // and unnamed ones only scribbled in here and there (a working note in the
  // margin, not a column of the table).
  const filledShare = (c: number) => rowsKept.filter((r) => cleanText(grid.shown[r]?.[c])).length / rowsKept.length;
  const fieldColumns = usable.filter(
    (c) =>
      c !== idColumn &&
      !hiddenCols[c + grid.colOffset]?.hidden &&
      filledShare(c) > 0 &&
      (headings[c] || filledShare(c) >= 0.5)
  );

  const rows = rowsKept.map((r) => {
    const shown = (c: number) => grid.shown[r]?.[c] ?? "";
    const photos = (photosByRow.get(r) ?? []).sort((a, b) => a.across - b.across);
    // The same picture placed twice in a row is one photo.
    const images = [...new Set(photos.map((photo) => photo.src))].slice(0, MAX_PHOTOS);
    return {
      row: r + grid.rowOffset + 1,
      id: displayId(shown(idColumn)),
      values: fieldColumns.map((c) => deckValue(headings[c], grid.raw[r]?.[c], shown(c))),
      images,
      excel: {
        serial: serialColumn >= 0 ? cleanText(shown(serialColumn)) : "",
        id: cleanText(shown(idColumn)),
        values: fieldColumns.map((c) => cleanText(shown(c))),
      },
    };
  });

  return {
    rows,
    idHeading: headings[idColumn] || "Style No.",
    // A column with values but no heading still goes in, under its letter.
    fields: fieldColumns.map((c) => headings[c] || columnName(c + grid.colOffset)),
    hasSerial: serialColumn >= 0,
    pictures: rows.reduce((sum, row) => sum + row.images.length, 0),
  };
}

/**
 * The workbook's products: from the first tab that has a product table with
 * photos in it, or failing that the first with a product table at all.
 */
export async function parseLineSheet(file: File): Promise<ParsedLineSheet> {
  const buffer = await file.arrayBuffer();
  const [XLSX, JSZip] = await Promise.all([import("xlsx"), import("jszip").then((module) => module.default)]);
  const workbook = XLSX.read(buffer, { type: "array" });
  const zip = await JSZip.loadAsync(buffer);
  const paths = await sheetPaths(zip);

  let chosen: (Table & { name: string }) | null = null;
  let firstProblem = "";
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet?.["!ref"]) continue;
    const path = paths.get(name);
    const pictures = path ? await readPictures(zip, path) : [];
    const table = readTable(readGrid(XLSX, sheet), sheet, sheet["!merges"] ?? [], pictures);
    if (typeof table === "string") {
      firstProblem ||= table;
      continue;
    }
    chosen ??= { ...table, name };
    if (table.pictures > 0) {
      if (!chosen.pictures) chosen = { ...table, name };
      break;
    }
  }
  if (!chosen) throw new Error(firstProblem || "That workbook has no sheets.");

  return {
    rows: chosen.rows,
    idHeading: chosen.idHeading,
    fields: chosen.fields,
    hasSerial: chosen.hasSerial,
    sheetName: workbook.SheetNames.length > 1 ? chosen.name : null,
    missingImages: chosen.rows.filter((row) => row.images.length === 0).map((row) => row.id || `row ${row.row}`),
  };
}

// ── Layout, in the editor's 1280×720 slide px ──────────────────────────────
//
// The HALO RINGS deck's look (framed cards, photo over a table), set on an
// even grid: the same GAP around the page and between the cards, and the
// same PAD inside every card on all four sides.

const SLIDE_W = 1280;
const SLIDE_H = 720;
const GAP = 24;
const PAD = 12;
/** 10pt, 9pt and 8pt in the editor's px (the PPTX export turns px back into points at ×0.75). */
const FONT_SIZES = [13.33, 12, 10.67];
const LINE_HEIGHT = 1.15;
/** Space above and below the text in a table cell. */
const CELL_PAD_Y = 8;
/** A cell never shows more than this many lines; the row height stops growing there. */
const MAX_LINES = 5;
/** The least of a card's height the photo keeps — below this, the cards go two to a slide. */
const MIN_PHOTO_SHARE = 0.42;

type Layout = {
  card: { w: number; h: number };
  slots: { x: number; y: number }[];
  font: number;
  /** Table columns (0 = the style number) per band, each band a heading row over a value row. */
  bands: number[][];
  /** Each table column's width. */
  widths: number[];
  /** Each band's heading-row and value-row heights. */
  rowHeights: { heading: number; value: number }[];
  photoH: number;
};

/**
 * A character's average width, as a share of the font size — Calibri runs
 * about half an em, bold a little wider. Erring wide: a column sized by this
 * holds its text on one line in the real font, so a cell never wraps where
 * the layout expected it not to (which would leave its text off-centre).
 */
const charWidth = (font: number, bold: boolean) => font * (bold ? 0.58 : 0.54);
/** Space either side of the text inside a cell. */
const CELL_PAD_X = 5;

/** The lines a cell's text takes in its width, wrapped at spaces as a text box wraps it. */
function linesFor(text: string, width: number, font: number, bold = false) {
  const perLine = Math.max(1, Math.floor((width - 2 * CELL_PAD_X) / charWidth(font, bold)));
  let lines = 0;
  for (const paragraph of (text || "–").split("\n")) {
    let used = 0;
    lines++;
    for (const word of paragraph.split(" ")) {
      const length = word.length + (used ? 1 : 0);
      if (used && used + length > perLine) {
        lines++;
        used = word.length;
      } else used += length;
      // A single word longer than the line breaks across lines itself.
      while (used > perLine) {
        lines++;
        used -= perLine;
      }
    }
  }
  return Math.min(lines, MAX_LINES);
}

/**
 * How wide a column wants to be: its longest value on one line, and its
 * heading on one line too when it is a couple of short words ("Dia wt"), or
 * on at most two otherwise — wrapping at a space ("Center / Shape"), never
 * mid-word. Letting the longer headings wrap is what keeps a seven-column
 * sheet at 10pt.
 */
function columnNeed(heading: string, values: string[], font: number) {
  const longest = Math.max(...values.flatMap((value) => (value || "–").split("\n").map((line) => line.length)));
  const words = heading.split(/\s+/);
  const headingChars =
    heading.length <= 8 ? heading.length : Math.max(...words.map((word) => word.length), Math.ceil(heading.length / 2));
  return Math.max(longest * charWidth(font, false), headingChars * charWidth(font, true)) + 2 * CELL_PAD_X;
}

/**
 * The layout that fits this sheet's columns: four cards a slide while the
 * table leaves the photo enough room, else two cards a slide, each the full
 * height. Within that, the table keeps as many columns side by side as fit
 * legibly, folding the rest into a second (or third) band, and steps the
 * text down a point at a time before giving up on four a slide.
 *
 * One layout for the whole deck — every card the same shape, so a page of
 * them lines up — sized to the longest value in each column.
 */
function planLayout(headings: string[], rows: string[][]): Layout {
  const twoBy = { w: (SLIDE_W - 3 * GAP) / 2, h: (SLIDE_H - 3 * GAP) / 2 };
  const options = [
    {
      card: twoBy,
      slots: [
        { x: GAP, y: GAP },
        { x: 2 * GAP + twoBy.w, y: GAP },
        { x: GAP, y: 2 * GAP + twoBy.h },
        { x: 2 * GAP + twoBy.w, y: 2 * GAP + twoBy.h },
      ],
    },
    {
      card: { w: twoBy.w, h: SLIDE_H - 2 * GAP },
      slots: [
        { x: GAP, y: GAP },
        { x: 2 * GAP + twoBy.w, y: GAP },
      ],
    },
  ];

  const columns = [...headings.keys()];
  /** Columns split into `count` runs of near-equal size, in order. */
  const split = (count: number) => {
    const size = Math.ceil(columns.length / count);
    return Array.from({ length: count }, (_, b) => columns.slice(b * size, (b + 1) * size)).filter((band) => band.length);
  };

  let fallback: Layout | null = null;
  for (const option of options) {
    const tableW = option.card.w - 2 * PAD;
    for (const font of FONT_SIZES) {
      // One very long value (a paragraph of remarks) may not claim the whole
      // row: past half the table it wraps instead.
      const need = headings.map((heading, c) =>
        Math.min(columnNeed(heading, rows.map((row) => row[c]), font), tableW / 2)
      );

      // As few bands as hold every column at its full width — one row of
      // headings where it fits, two or three when not. Where even four bands
      // can't, the columns share the width and the longest texts wrap.
      let bands = [1, 2, 3, 4].map(split).find((candidate) =>
        candidate.every((band) => band.reduce((sum, c) => sum + need[c], 0) <= tableW)
      );
      if (!bands) {
        const perBand = Math.max(1, Math.floor(tableW / (font * 6.5)));
        bands = split(Math.ceil(columns.length / perBand));
      }

      // Each column gets what it needs, and any width left over is shared in
      // proportion — so the table always spans the card.
      const widths: number[] = [];
      for (const band of bands) {
        const total = band.reduce((sum, c) => sum + need[c], 0);
        band.forEach((c) => (widths[c] = (need[c] / total) * tableW));
      }

      const height = (lines: number) => lines * font * LINE_HEIGHT + 2 * CELL_PAD_Y;
      const rowHeights = bands.map((band) => ({
        heading: height(Math.max(...band.map((c) => linesFor(headings[c], widths[c], font, true)))),
        value: Math.max(
          height(2),
          height(Math.max(...rows.map((row) => Math.max(...band.map((c) => linesFor(row[c], widths[c], font))))))
        ),
      }));
      const tableH = rowHeights.reduce((sum, row) => sum + row.heading + row.value, 0);
      const photoH = option.card.h - 3 * PAD - tableH;

      const layout = { ...option, font, bands, widths, rowHeights, photoH: Math.max(photoH, 60) };
      if (photoH >= option.card.h * MIN_PHOTO_SHARE) return layout;
      fallback = layout;
    }
  }
  return fallback!;
}

/** Which of `lineSheetPieces`' photos each row's are — rows' photos, one after another. */
function photoIndexes(rows: LineSheetRow[]) {
  let next = 0;
  return rows.map((row) => row.images.map(() => next++));
}

/** Every row's photos as the editor's pieces, in order — referenced by index rather than copied into the design. */
export function lineSheetPieces(rows: LineSheetRow[]): AffinityPiece[] {
  return rows.flatMap((row) =>
    row.images.map((image, index) => ({ id: `row-${row.row}-${index}`, image, sheetImages: [], sheetExcelText: [], designerInitial: "" }))
  );
}

/**
 * The line sheet as a free-form design for Collection Story's editor: cards
 * laid out by `planLayout`, each a framed box with its photo(s) and the
 * row's table — built from cell boxes and text so every piece can be moved,
 * restyled or deleted. A card's parts share a group, so a card moves as one.
 *
 * One photo sits centred in its box; two or three share it side by side.
 * Each is the workbook's own picture, untouched — only fitted to its space.
 */
export function buildLineSheetDesign(sheet: Pick<ParsedLineSheet, "rows" | "idHeading" | "fields">): DeckDesign {
  const { rows } = sheet;
  const headings = [sheet.idHeading, ...sheet.fields];
  const cells = rows.map((row) => [row.id, ...row.values]);
  const layout = planLayout(headings, cells);
  const { card, slots, font, bands, widths, rowHeights, photoH } = layout;
  const indexes = photoIndexes(rows);

  const slides: DesignSlide[] = [];
  for (let start = 0; start < rows.length; start += slots.length) {
    const elements: DesignElement[] = [];
    rows.slice(start, start + slots.length).forEach((row, index) => {
      const slot = slots[index];
      const rowIndex = start + index;
      const groupId = uid();
      const name = row.id || `Row ${row.row}`;

      elements.push(
        shapeElement({
          x: px(slot.x),
          y: px(slot.y),
          w: px(card.w),
          h: px(card.h),
          fill: "#FFFFFF",
          stroke: "#9BA5AF",
          strokeWidth: 1,
          groupId,
          name: `${name} card`,
        })
      );

      // The photos share the space above the table: one centred, more side by side.
      const photos = indexes[rowIndex];
      const boxW = card.w - 2 * PAD;
      const eachW = (boxW - (photos.length - 1) * PAD) / Math.max(photos.length, 1);
      photos.forEach((pieceIndex, i) => {
        elements.push(
          imageElement({
            x: px(slot.x + PAD + i * (eachW + PAD)),
            y: px(slot.y + PAD),
            w: px(eachW),
            h: px(photoH),
            pieceIndex,
            fit: "contain",
            groupId,
            name: photos.length > 1 ? `${name} photo ${i + 1}` : `${name} photo`,
          })
        );
      });

      // The table hugs the card's bottom padding, band under band.
      let y = slot.y + card.h - PAD - rowHeights.reduce((sum, band) => sum + band.heading + band.value, 0);
      bands.forEach((band, b) => {
        [
          { texts: band.map((c) => headings[c]), h: rowHeights[b].heading, heading: true },
          { texts: band.map((c) => cells[rowIndex][c]), h: rowHeights[b].value, heading: false },
        ].forEach(({ texts, h, heading }) => {
          let x = slot.x + PAD;
          band.forEach((column, i) => {
            const width = widths[column];
            const text = texts[i] || "–";
            elements.push(
              shapeElement({
                x: px(x),
                y: px(y),
                w: px(width),
                h: px(h),
                fill: heading ? "#DDE7EF" : "#F9FAFB",
                stroke: "#FFFFFF",
                strokeWidth: 1.5,
                groupId,
                name: `${name} cell`,
              })
            );
            // Text boxes are top-aligned, so each sits centred by its line count.
            const textH = linesFor(text, width, font, heading) * font * LINE_HEIGHT;
            elements.push(
              textElement({
                x: px(x) + 2,
                y: px(y + (h - textH) / 2),
                w: px(width) - 4,
                h: px(textH),
                text,
                fontFamily: "Calibri",
                fontSize: font,
                bold: heading,
                color: "#000000",
                align: "center",
                lineHeight: LINE_HEIGHT,
                groupId,
              })
            );
            x += width;
          });
          y += h;
        });
      });
    });

    slides.push({ id: uid(), background: "#FFFFFF", elements });
  }

  return { version: 1, slides };
}

const px = (value: number) => Math.round(value * 100) / 100;
