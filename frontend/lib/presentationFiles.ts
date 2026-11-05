"use client";

import { compressImage } from "./image";

/**
 * Whatever someone drops onto the Presentation tool, read in the browser into
 * the two things the writing model can use: text and pictures.
 *
 * Any mix is fine — a price list in Excel, last season's PowerPoint, a PDF
 * brochure, a Word brief, a folder of product photos. Each file becomes a
 * `PresentationSource` (its text, labelled with where it came from) and adds
 * its pictures to one shared list the slides can place by number.
 *
 * Client-side for the same reason as `sheetFiles.ts`: the backend would
 * otherwise need a parser for every office format just to throw the files
 * away afterwards. Every parser is imported lazily.
 */

export type PresentationSource = {
  name: string;
  /** What kind of file, for the label the model reads — "Excel", "PowerPoint", … */
  kind: string;
  /** The extracted text, already trimmed to `MAX_SOURCE_CHARS`. */
  text: string;
  /** How many pictures this file added to the shared list. */
  imageCount: number;
};

export type PresentationImage = {
  /** A compressed data URI while being uploaded; an R2 url once saved. */
  src: string;
  /** Where it came from, so the model can tie a photo to the row or slide it sat on. */
  label: string;
};

export type ReadResult = { sources: PresentationSource[]; images: PresentationImage[]; skipped: string[] };

/** Every picture the model is shown counts against one request; past this the rest are dropped. */
export const MAX_IMAGES = 30;
/** Per file. A 200-page PDF is a library, not a brief — the opening is what matters. */
const MAX_SOURCE_CHARS = 40_000;
/** Pages of a PDF read for text. */
const MAX_PDF_PAGES = 40;
/** A page with less text than this is probably a picture — rendered instead of read. */
const SPARSE_PAGE_CHARS = 60;
/** Rendered PDF pages, at most, per file. */
const MAX_RENDERED_PAGES = 6;
/** Embedded pictures smaller than this are icons and bullets, not content. */
const MIN_MEDIA_BYTES = 6_000;

export const PRESENTATION_FILE_ACCEPT =
  "image/*,application/pdf,.pdf,.xlsx,.xlsm,.xls,.csv,.pptx,.docx,.txt,.md,.json,.tsv";

const clip = (text: string) => {
  const clean = text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return clean.length > MAX_SOURCE_CHARS ? `${clean.slice(0, MAX_SOURCE_CHARS)}\n… (trimmed)` : clean;
};

/**
 * Smaller than an ordinary upload: up to thirty pictures travel in one
 * request beside every document's text, under the API's 25MB body limit, and
 * a slide never shows a picture larger than 1600px anyway.
 */
const DECK_SIDE = 1600;
const DECK_QUALITY = 0.82;

function shrink(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => {
      URL.revokeObjectURL(url);
      // Not decodable here — fall back to the ordinary upload path.
      compressImage(file).then(resolve, reject);
    };
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, DECK_SIDE / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const context = canvas.getContext("2d");
      if (!context) return compressImage(file).then(resolve, reject);
      // White under a transparent PNG, or its clear parts turn black as JPEG.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", DECK_QUALITY));
    };
    img.src = url;
  });
}

/** A blob as a data URI, shrunk for the deck. */
async function blobToImage(blob: Blob, name: string): Promise<string | null> {
  try {
    return await shrink(new File([blob], name, { type: blob.type || "image/jpeg" }));
  } catch {
    return null;
  }
}

const MEDIA_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
};

/** The text runs of an Office XML part (`<a:t>` in slides, `<w:t>` in Word), paragraph by paragraph. */
function officeText(xml: string, run: "a:t" | "w:t", paragraph: "a:p" | "w:p") {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const paragraphs = Array.from(doc.getElementsByTagName(paragraph));
  return paragraphs
    .map((p) =>
      Array.from(p.getElementsByTagName(run))
        .map((node) => node.textContent ?? "")
        .join("")
        .trim()
    )
    .filter(Boolean)
    .join("\n");
}

/** Pictures from an Office zip's media folder, largest-first files skipped when tiny. */
async function zipMedia(zip: import("jszip"), folder: string, label: string, room: number) {
  const images: PresentationImage[] = [];
  const entries = Object.values(zip.files)
    .filter((entry) => !entry.dir && entry.name.startsWith(folder))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  for (const entry of entries) {
    if (images.length >= room) break;
    const ext = entry.name.split(".").pop()?.toLowerCase() ?? "";
    const type = MEDIA_TYPES[ext];
    if (!type) continue; // EMF/WMF/SVG previews — not something a slide can reuse
    const bytes = await entry.async("uint8array");
    if (bytes.byteLength < MIN_MEDIA_BYTES) continue;
    const src = await blobToImage(new Blob([bytes as BlobPart], { type }), entry.name);
    if (src) images.push({ src, label: `${label} · ${entry.name.split("/").pop()}` });
  }
  return images;
}

async function readPptx(file: File, room: number) {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const slides = Object.keys(zip.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));

  const parts: string[] = [];
  for (const [n, path] of slides.entries()) {
    const text = officeText(await zip.file(path)!.async("string"), "a:t", "a:p");
    // Speaker notes often hold what the slide only hinted at.
    const notesPath = `ppt/notesSlides/notesSlide${path.match(/\d+/)![0]}.xml`;
    const notes = zip.file(notesPath) ? officeText(await zip.file(notesPath)!.async("string"), "a:t", "a:p") : "";
    parts.push(`[Slide ${n + 1}]\n${text || "(no text)"}${notes ? `\nNotes: ${notes}` : ""}`);
  }

  return { text: parts.join("\n\n"), images: await zipMedia(zip, "ppt/media/", file.name, room) };
}

async function readDocx(file: File, room: number) {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const body = zip.file("word/document.xml");
  const text = body ? officeText(await body.async("string"), "w:t", "w:p") : "";
  return { text, images: await zipMedia(zip, "word/media/", file.name, room) };
}

async function readExcel(file: File, room: number) {
  const xlsx = await import("xlsx");
  const workbook = xlsx.read(await file.arrayBuffer(), { type: "array" });
  const text = workbook.SheetNames.map((name) => {
    const csv = xlsx.utils.sheet_to_csv(workbook.Sheets[name], { blankrows: false });
    return `Sheet: ${name}\n${csv}`;
  }).join("\n\n");

  // A price list with a photo column: the Line Sheet reader already knows how
  // to pull each row's pictures out with its style number, which is exactly
  // the label the model needs to put the right photo beside the right row.
  const images: PresentationImage[] = [];
  if (/\.(xlsx|xlsm)$/i.test(file.name)) {
    try {
      const { parseLineSheet } = await import("./lineSheet");
      const sheet = await parseLineSheet(file);
      for (const row of sheet.rows) {
        for (const src of row.images) {
          if (images.length >= room) break;
          images.push({ src, label: `${file.name} · ${sheet.idHeading || "row"} ${row.id || row.row}` });
        }
      }
    } catch {
      // Not a product list, or no pictures — the text is still read.
    }
  }
  return { text, images };
}

async function readPdf(file: File, room: number) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;

  const parts: string[] = [];
  const images: PresentationImage[] = [];
  for (let page = 1; page <= Math.min(pdf.numPages, MAX_PDF_PAGES); page++) {
    const rendered = await pdf.getPage(page);
    const content = await rendered.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : " ") : ""))
      .join("")
      .trim();
    parts.push(`[Page ${page}]\n${text || "(no text)"}`);

    // A scanned page or a picture page: its look is the content, so it is
    // rendered and shown to the model instead.
    if (text.length < SPARSE_PAGE_CHARS && images.length < Math.min(room, MAX_RENDERED_PAGES)) {
      const viewport = rendered.getViewport({ scale: 1.25 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const context = canvas.getContext("2d");
      if (!context) continue;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await rendered.render({ canvasContext: context, viewport, canvas }).promise;
      images.push({ src: canvas.toDataURL("image/jpeg", 0.85), label: `${file.name} · page ${page}` });
    }
  }
  if (pdf.numPages > MAX_PDF_PAGES) parts.push(`… ${pdf.numPages - MAX_PDF_PAGES} more pages not read`);
  return { text: parts.join("\n\n"), images };
}

const kindOf = (file: File) => {
  const name = file.name.toLowerCase();
  if (file.type.startsWith("image/")) return "Image";
  if (name.endsWith(".pdf") || file.type === "application/pdf") return "PDF";
  if (/\.(xlsx|xlsm|xls)$/.test(name)) return "Excel";
  if (/\.(csv|tsv)$/.test(name)) return "Table";
  if (name.endsWith(".pptx")) return "PowerPoint";
  if (name.endsWith(".docx")) return "Word";
  if (/\.(txt|md|json)$/.test(name) || file.type.startsWith("text/")) return "Text";
  return null;
};

/**
 * Reads every file it can. One that fails or isn't a known kind is listed in
 * `skipped` rather than failing the batch — a dropped folder should give the
 * files that could be read, and say which couldn't.
 *
 * `existingImages` is how many pictures are already on the list, so the cap
 * holds across several drops.
 */
export async function readPresentationFiles(files: File[], existingImages = 0): Promise<ReadResult> {
  const sources: PresentationSource[] = [];
  const images: PresentationImage[] = [];
  const skipped: string[] = [];
  const room = () => Math.max(0, MAX_IMAGES - existingImages - images.length);

  for (const file of files) {
    const kind = kindOf(file);
    if (!kind) {
      skipped.push(file.name);
      continue;
    }
    try {
      if (kind === "Image") {
        if (room() === 0) {
          skipped.push(file.name);
          continue;
        }
        const src = await shrink(file);
        images.push({ src, label: file.name });
        continue;
      }

      const read =
        kind === "PDF"
          ? await readPdf(file, room())
          : kind === "Excel"
            ? await readExcel(file, room())
            : kind === "PowerPoint"
              ? await readPptx(file, room())
              : kind === "Word"
                ? await readDocx(file, room())
                : { text: await file.text(), images: [] as PresentationImage[] };

      images.push(...read.images.slice(0, room()));
      const text = clip(read.text);
      if (text || read.images.length) {
        sources.push({ name: file.name, kind, text, imageCount: read.images.length });
      } else {
        skipped.push(file.name);
      }
    } catch (err) {
      console.error(`[presentation] could not read ${file.name}:`, err);
      skipped.push(file.name);
    }
  }

  return { sources, images, skipped };
}
