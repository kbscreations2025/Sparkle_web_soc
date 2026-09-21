"use client";

import { compressImage } from "./image";

/**
 * Production development sheets, read in the browser.
 *
 * A sheet arrives as a photo, a PDF or a workbook, and the model only
 * understands the first two — so a PDF is rendered to page images and a
 * workbook is flattened to text here, before anything is sent.
 *
 * Deliberately client-side. Doing it on the server would mean the backend
 * carrying a PDF renderer and a spreadsheet parser for one tool, and
 * shipping the original files up only to throw them away after extraction.
 *
 * Both libraries are imported lazily, so a page that never sees a PDF never
 * downloads a PDF renderer.
 */

export type SheetUpload = {
  /** Page images — a photo as-is, or one per rendered PDF page. */
  images: string[];
  /** Flattened workbook text, one entry per file. */
  excelText: string[];
};

/** Beyond this a sheet is a document, not a reference, and the model stops reading it closely. */
const MAX_PDF_PAGES = 8;

const EXCEL_EXTENSIONS = /\.(xlsx|xlsm|xls|csv)$/i;

/** Renders each page of a PDF to a PNG data URL. */
async function pdfToImages(file: File): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist");
  // The worker is fetched from a CDN pinned to the exact version of the
  // library that asked for it — a mismatch between the two fails at parse
  // time with an error that says nothing about versions.
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: string[] = [];

  for (let page = 1; page <= Math.min(pdf.numPages, MAX_PDF_PAGES); page++) {
    const rendered = await pdf.getPage(page);
    // 1.5 rather than 1: a technical sheet's printed setting codes are the
    // point of reading it, and at native scale they don't survive.
    const viewport = rendered.getViewport({ scale: 1.5 });

    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const context = canvas.getContext("2d");
    if (!context) continue;

    await rendered.render({ canvasContext: context, viewport, canvas }).promise;
    pages.push(canvas.toDataURL("image/png"));
  }

  return pages;
}

/** Flattens a workbook to one plain-text block per sheet. */
async function excelToText(file: File): Promise<string> {
  const xlsx = await import("xlsx");
  const workbook = xlsx.read(await file.arrayBuffer(), { type: "array" });

  return workbook.SheetNames.map((name) => {
    const csv = xlsx.utils.sheet_to_csv(workbook.Sheets[name], { blankrows: false });
    return `Sheet: ${name}\n${csv}`;
  }).join("\n\n");
}

/**
 * Turns whatever was dropped into what the model can be sent.
 *
 * A file of an unrecognised kind is skipped rather than failing the batch:
 * someone dragging a folder of a piece's paperwork should get the pages that
 * could be read, not an error about the one that couldn't.
 */
export async function readSheetFiles(files: File[]): Promise<SheetUpload> {
  const images: string[] = [];
  const excelText: string[] = [];

  for (const file of files) {
    try {
      if (file.type.startsWith("image/")) {
        images.push(await compressImage(file));
      } else if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
        images.push(...(await pdfToImages(file)));
      } else if (EXCEL_EXTENSIONS.test(file.name)) {
        const text = await excelToText(file);
        if (text.trim()) excelText.push(text);
      }
    } catch (err) {
      console.error(`[sheets] could not read ${file.name}:`, err);
    }
  }

  return { images, excelText };
}

/** What the file picker should offer. */
export const SHEET_FILE_ACCEPT = "image/*,application/pdf,.xlsx,.xlsm,.xls,.csv";
