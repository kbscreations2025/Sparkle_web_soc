/**
 * A PowerPoint read for its structure, not just its words: every text box and
 * every picture on every slide, where it sits, and what it says, exactly as
 * written.
 *
 * `presentationFiles.ts` reads a deck the way the model needs it (all the
 * text, all the pictures, in two piles). Redesigning a deck needs more: which
 * code and which spec lines sit under which ring, which picture is the small
 * reference in the corner, which line is the title. That is all in the
 * geometry, so this keeps it. Text is copied character for character, never
 * re-typed, which is what lets the redesign promise every word comes through
 * unchanged.
 *
 * Browser-only (DOMParser, createImageBitmap). Positions are in inches.
 */

export type Box = { x: number; y: number; w: number; h: number };

export type PptxParagraph = {
  text: string;
  /** Shown with a bullet in the original (explicitly, or by its placeholder's default). */
  bullet: boolean;
  /** Largest font size in the paragraph, in points, where one is set. */
  size: number | null;
  bold: boolean;
};

export type PptxText = {
  id: string;
  box: Box | null;
  /** "title", "ctrTitle", "subTitle", "body"… for a placeholder; null for a plain text box. */
  placeholder: string | null;
  paragraphs: PptxParagraph[];
};

/** A crop the deck's author applied, as fractions of the picture (0–1) cut from each side. */
export type Crop = { l: number; t: number; r: number; b: number };

export type PptxPicture = {
  id: string;
  box: Box | null;
  /** Key into `PptxDeck.media`. */
  media: string;
  crop: Crop | null;
};

export type PptxTable = { id: string; box: Box | null; rows: string[][] };

export type PptxSlide = {
  /** 1-based, in the order the deck presents them. */
  number: number;
  texts: PptxText[];
  pictures: PptxPicture[];
  tables: PptxTable[];
  /** The speaker notes, as written; empty when there are none. */
  notes: string;
};

export type PptxMedia = { path: string; mimeType: string; bytes: Uint8Array; width: number; height: number };

export type PptxDeck = {
  fileName: string;
  /** Slide size, inches. */
  width: number;
  height: number;
  slides: PptxSlide[];
  media: Map<string, PptxMedia>;
  /**
   * What couldn't be read, described for the person: pictures in formats a
   * browser can't draw (EMF, WMF, TIFF…) and charts. Reported, not silently
   * lost.
   */
  skipped: string[];
};

const EMU_PER_INCH = 914400;
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
};

// ── XML helpers ──────────────────────────────────────────────────────────────

function parseXml(xml: string) {
  return new DOMParser().parseFromString(xml, "application/xml");
}

const children = (el: Element | null, name: string) => (el ? Array.from(el.children).filter((c) => c.localName === name) : []);
const child = (el: Element | null, name: string) => children(el, name)[0] ?? null;
const descendants = (el: Element | Document | null, name: string) => (el ? Array.from(el.getElementsByTagNameNS("*", name)) : []);
const descendant = (el: Element | Document | null, name: string) => descendants(el, name)[0] ?? null;
const num = (el: Element | null, attr: string) => Number(el?.getAttribute(attr) ?? NaN);

/** A part's relationships: id → absolute part path inside the zip. */
function relationships(relsXml: string | null, partPath: string): Map<string, { target: string; type: string }> {
  const map = new Map<string, { target: string; type: string }>();
  if (!relsXml) return map;
  const dir = partPath.slice(0, partPath.lastIndexOf("/"));
  for (const rel of descendants(parseXml(relsXml), "Relationship")) {
    const target = rel.getAttribute("Target") ?? "";
    if (rel.getAttribute("TargetMode") === "External") continue;
    map.set(rel.getAttribute("Id") ?? "", { target: resolvePath(dir, target), type: rel.getAttribute("Type") ?? "" });
  }
  return map;
}

function resolvePath(dir: string, target: string) {
  if (target.startsWith("/")) return target.slice(1);
  const parts = `${dir}/${target}`.split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "..") out.pop();
    else if (part && part !== ".") out.push(part);
  }
  return out.join("/");
}

const relsPathFor = (partPath: string) => {
  const slash = partPath.lastIndexOf("/");
  return `${partPath.slice(0, slash)}/_rels/${partPath.slice(slash + 1)}.rels`;
};

// ── Geometry ─────────────────────────────────────────────────────────────────

/** Maps a box in a group's child space to slide space. Nested groups compose. */
type Transform = (box: Box) => Box;
const identity: Transform = (box) => box;

function xfrmBox(xfrm: Element | null): Box | null {
  const off = child(xfrm, "off");
  const ext = child(xfrm, "ext");
  if (!off || !ext) return null;
  return {
    x: num(off, "x") / EMU_PER_INCH,
    y: num(off, "y") / EMU_PER_INCH,
    w: num(ext, "cx") / EMU_PER_INCH,
    h: num(ext, "cy") / EMU_PER_INCH,
  };
}

function groupTransform(grpSpPr: Element | null, parent: Transform): Transform {
  const xfrm = child(grpSpPr, "xfrm");
  const own = xfrmBox(xfrm);
  const chOff = child(xfrm, "chOff");
  const chExt = child(xfrm, "chExt");
  if (!own || !chOff || !chExt) return parent;
  const cx = num(chOff, "x") / EMU_PER_INCH;
  const cy = num(chOff, "y") / EMU_PER_INCH;
  const sx = num(chExt, "cx") ? own.w / (num(chExt, "cx") / EMU_PER_INCH) : 1;
  const sy = num(chExt, "cy") ? own.h / (num(chExt, "cy") / EMU_PER_INCH) : 1;
  return (box) => parent({ x: own.x + (box.x - cx) * sx, y: own.y + (box.y - cy) * sy, w: box.w * sx, h: box.h * sy });
}

// ── Placeholders ────────────────────────────────────────────────────────────

type Placeholder = { type: string; idx: string | null };

function placeholderOf(shape: Element): Placeholder | null {
  const ph = descendant(child(shape, "nvSpPr"), "ph");
  if (!ph) return null;
  return { type: ph.getAttribute("type") ?? "body", idx: ph.getAttribute("idx") };
}

/**
 * Placeholders PowerPoint fills in by itself: the slide number and the date.
 * Not anything the author wrote, and the redesign numbers its own pages.
 */
const AUTOMATIC_PLACEHOLDERS = new Set(["sldNum", "dt"]);

/** Placeholder boxes a layout or master defines, for slide placeholders that inherit their position. */
function placeholderBoxes(xml: string | null) {
  const byIdx = new Map<string, Box>();
  const byType = new Map<string, Box>();
  if (!xml) return { byIdx, byType };
  for (const sp of descendants(parseXml(xml), "sp")) {
    const ph = placeholderOf(sp);
    const box = xfrmBox(child(child(sp, "spPr"), "xfrm"));
    if (!ph || !box) continue;
    if (ph.idx) byIdx.set(ph.idx, box);
    if (!byType.has(ph.type)) byType.set(ph.type, box);
  }
  return { byIdx, byType };
}

// ── Text ────────────────────────────────────────────────────────────────────

function paragraphsOf(txBody: Element | null, defaultBullets: boolean): PptxParagraph[] {
  const out: PptxParagraph[] = [];
  for (const p of children(txBody, "p")) {
    let text = "";
    const sizes: number[] = [];
    let bold = false;
    for (const node of Array.from(p.children)) {
      if (node.localName === "r" || node.localName === "fld") {
        text += descendant(node, "t")?.textContent ?? "";
        const rPr = child(node, "rPr");
        if (rPr?.getAttribute("sz")) sizes.push(Number(rPr.getAttribute("sz")) / 100);
        if (rPr?.getAttribute("b") === "1") bold = true;
      } else if (node.localName === "br") {
        text += "\n";
      }
    }
    if (!text.trim()) continue;
    const pPr = child(p, "pPr");
    const explicitBullet = Boolean(child(pPr, "buChar") || child(pPr, "buAutoNum"));
    const noBullet = Boolean(child(pPr, "buNone"));
    out.push({ text, bullet: explicitBullet || (defaultBullets && !noBullet), size: sizes.length ? Math.max(...sizes) : null, bold });
  }
  return out;
}

// ── Pictures ────────────────────────────────────────────────────────────────

function cropOf(blipFill: Element | null): Crop | null {
  const rect = child(blipFill, "srcRect");
  if (!rect) return null;
  const part = (attr: string) => Math.max(0, (Number(rect.getAttribute(attr) ?? 0) || 0) / 100000);
  const crop = { l: part("l"), t: part("t"), r: part("r"), b: part("b") };
  return crop.l || crop.t || crop.r || crop.b ? crop : null;
}

async function imageSize(bytes: Uint8Array, mimeType: string) {
  try {
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: mimeType }));
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return null;
  }
}

// ── The deck ────────────────────────────────────────────────────────────────

export async function readPptxStructure(file: File): Promise<PptxDeck> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const read = async (path: string) => (zip.file(path) ? zip.file(path)!.async("string") : null);

  const presentation = parseXml((await read("ppt/presentation.xml")) ?? "");
  const presentationRels = relationships(await read("ppt/_rels/presentation.xml.rels"), "ppt/presentation.xml");
  const size = descendant(presentation, "sldSz");
  const width = (num(size, "cx") || 12192000) / EMU_PER_INCH;
  const height = (num(size, "cy") || 6858000) / EMU_PER_INCH;
  const slidePaths = descendants(presentation, "sldId")
    .map((sldId) => presentationRels.get(sldId.getAttributeNS(R_NS, "id") ?? sldId.getAttribute("r:id") ?? "")?.target)
    .filter((path): path is string => Boolean(path && zip.file(path)));

  const media = new Map<string, PptxMedia>();
  const skipped = new Set<string>();
  const placeholderCache = new Map<string, ReturnType<typeof placeholderBoxes>>();
  const placeholdersFor = async (path: string | undefined) => {
    if (!path) return placeholderBoxes(null);
    if (!placeholderCache.has(path)) placeholderCache.set(path, placeholderBoxes(await read(path)));
    return placeholderCache.get(path)!;
  };

  let nextId = 0;
  const id = (kind: string) => `${kind}${++nextId}`;
  const slides: PptxSlide[] = [];

  for (const [index, slidePath] of slidePaths.entries()) {
    const doc = parseXml((await read(slidePath)) ?? "");
    const rels = relationships(await read(relsPathFor(slidePath)), slidePath);
    const layoutPath = [...rels.values()].find((rel) => rel.type.endsWith("/slideLayout"))?.target;
    const layoutRels = layoutPath ? relationships(await read(relsPathFor(layoutPath)), layoutPath) : new Map();
    const masterPath = [...layoutRels.values()].find((rel) => rel.type.endsWith("/slideMaster"))?.target;
    const layoutBoxes = await placeholdersFor(layoutPath);
    const masterBoxes = await placeholdersFor(masterPath);
    const inheritedBox = (ph: Placeholder) =>
      (ph.idx ? layoutBoxes.byIdx.get(ph.idx) : undefined) ??
      layoutBoxes.byType.get(ph.type) ??
      (ph.idx ? masterBoxes.byIdx.get(ph.idx) : undefined) ??
      masterBoxes.byType.get(ph.type) ??
      null;

    const slide: PptxSlide = { number: index + 1, texts: [], pictures: [], tables: [], notes: "" };
    const unreadable = (what: string) => skipped.add(`${what} on slide ${slide.number}`);

    const addPicture = async (blipFill: Element | null, box: Box | null) => {
      const blip = child(blipFill, "blip");
      const rel = rels.get(blip?.getAttributeNS(R_NS, "embed") ?? blip?.getAttribute("r:embed") ?? "");
      if (!rel) return;
      const extension = rel.target.split(".").pop()?.toLowerCase() ?? "";
      const mimeType = MIME[extension];
      if (!mimeType) {
        unreadable(`a picture in ${extension.toUpperCase() || "an unknown"} format`);
        return;
      }
      if (!media.has(rel.target)) {
        const bytes = await zip.file(rel.target)?.async("uint8array");
        const dims = bytes ? await imageSize(bytes, mimeType) : null;
        if (!bytes || !dims) {
          unreadable("a picture that couldn't be opened");
          return;
        }
        media.set(rel.target, { path: rel.target, mimeType, bytes, ...dims });
      }
      slide.pictures.push({ id: id("p"), box, media: rel.target, crop: cropOf(blipFill) });
    };

    const walk = async (container: Element | null, transform: Transform) => {
      for (const el of Array.from(container?.children ?? [])) {
        if (el.localName === "grpSp") {
          await walk(el, groupTransform(child(el, "grpSpPr"), transform));
        } else if (el.localName === "pic") {
          const own = xfrmBox(child(child(el, "spPr"), "xfrm"));
          await addPicture(child(el, "blipFill"), own ? transform(own) : null);
        } else if (el.localName === "sp") {
          const spPr = child(el, "spPr");
          const ph = placeholderOf(el);
          if (ph && AUTOMATIC_PLACEHOLDERS.has(ph.type)) continue;
          const own = xfrmBox(child(spPr, "xfrm"));
          const box = own ? transform(own) : ph ? inheritedBox(ph) : null;
          // A shape filled with a picture is a picture.
          const pictureFill = child(spPr, "blipFill");
          if (pictureFill) await addPicture(pictureFill, box);
          // Body placeholders (and untyped ones) are bulleted unless a paragraph says otherwise.
          const defaultBullets = Boolean(ph && ["body", "obj"].includes(ph.type) && ph.idx !== null) || ph?.type === "body";
          const paragraphs = paragraphsOf(child(el, "txBody"), defaultBullets);
          if (paragraphs.length) slide.texts.push({ id: id("t"), box, placeholder: ph?.type ?? null, paragraphs });
        } else if (el.localName === "graphicFrame") {
          const own = xfrmBox(child(el, "xfrm"));
          const box = own ? transform(own) : null;
          const table = descendant(el, "tbl");
          if (table) {
            const rows = children(table, "tr").map((tr) =>
              children(tr, "tc").map((tc) =>
                paragraphsOf(child(tc, "txBody"), false)
                  .map((p) => p.text)
                  .join("\n")
              )
            );
            if (rows.some((row) => row.some((cell) => cell.trim()))) slide.tables.push({ id: id("tbl"), box, rows });
            continue;
          }
          // SmartArt keeps its words in a data part of its own: read as one text block, in order.
          const relIds = descendant(el, "relIds");
          const dataPart = relIds ? rels.get(relIds.getAttributeNS(R_NS, "dm") ?? relIds.getAttribute("r:dm") ?? "") : undefined;
          if (dataPart) {
            const data = await read(dataPart.target);
            const paragraphs = data ? descendants(parseXml(data), "pt").flatMap((point) => paragraphsOf(child(point, "t"), false)) : [];
            if (paragraphs.length) slide.texts.push({ id: id("t"), box, placeholder: null, paragraphs });
            continue;
          }
          if (descendant(el, "chart")) unreadable("a chart");
          else if (descendant(el, "oleObj")) unreadable("an embedded object");
        }
      }
    };

    await walk(descendant(doc, "spTree"), identity);

    // Speaker notes: the notes page's body text, not its slide picture or page number.
    const notesPath = [...rels.values()].find((rel) => rel.type.endsWith("/notesSlide"))?.target;
    const notesXml = notesPath ? await read(notesPath) : null;
    if (notesXml) {
      slide.notes = descendants(parseXml(notesXml), "sp")
        .filter((sp) => placeholderOf(sp)?.type === "body")
        .flatMap((sp) => paragraphsOf(child(sp, "txBody"), false).map((p) => p.text))
        .join("\n")
        .trim();
    }

    slides.push(slide);
  }

  return { fileName: file.name, width, height, slides, media, skipped: [...skipped] };
}
