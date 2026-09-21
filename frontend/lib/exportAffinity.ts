"use client";

import type { AffinityItem } from "./api";
import { hasProductionSheet, splitEntries, type AffinityPiece } from "./affinity";

/**
 * Exporting the catalog.
 *
 * Two formats, two completely different mechanisms:
 *
 *  · **PDF** is the browser's own print pipeline (`window.print()`), with a
 *    print stylesheet that hides the app's chrome. No dependency, and the
 *    deck is already laid out at the real 16:9 slide ratio, so what prints
 *    is what is on screen.
 *  · **PPTX** is rebuilt from the data rather than screenshotted, so the
 *    text in the deck stays selectable and editable in PowerPoint. That
 *    means the slide geometry here has to mirror `AffinityDeck` by hand —
 *    the two are kept in step through the shared palette and the shared
 *    `splitEntries`.
 */

/** Hex without the `#`, which is what pptxgenjs wants. */
const PPT = {
  cream: "F7F2EC",
  borderGold: "B4A794",
  titleGold: "6B5D42",
  ink: "46423C",
  labelGray: "646464",
} as const;

/** How many grid columns a card spans, from its on-screen size. */
const SIZE_COLS = { sm: 1, md: 1, lg: 2 } as const;

/**
 * pptxgenjs embeds images as base64. A freshly uploaded piece is already a
 * data URI; one from a saved kit is an R2 url and has to be fetched first.
 */
async function toBase64(url: string): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith("data:")) return url;

  try {
    const blob = await fetch(url).then((response) => response.blob());
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    // A picture that can't be fetched costs one image on one slide, not the
    // whole export.
    return null;
  }
}

/** The filename a collection downloads as. */
function fileName(collectionName: string, extension: string) {
  const stem = collectionName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  return `${stem || "affinity-collection"}.${extension}`;
}

export async function exportAffinityPptx({
  collectionName,
  tagline,
  items,
  pieces,
}: {
  collectionName: string;
  tagline: string;
  items: AffinityItem[];
  pieces: AffinityPiece[];
}) {
  // Imported on demand: the library is large, and a page that never exports
  // should never download it.
  const PptxGenJS = (await import("pptxgenjs")).default;
  const deck = new PptxGenJS();
  deck.layout = "LAYOUT_WIDE";

  // Resolved once per piece rather than per slide — the same photo appears
  // on the cover and in the grid.
  const imageByPieceId = new Map<string, string>();
  await Promise.all(
    pieces.map(async (piece) => {
      const data = await toBase64(piece.image);
      if (data) imageByPieceId.set(piece.id, data);
    })
  );

  /* ── Cover ─────────────────────────────────────────────────────────── */
  const cover = deck.addSlide();
  cover.background = { color: PPT.cream };
  cover.addShape("rect", {
    x: 0.05,
    y: 0.05,
    w: 13.23,
    h: 7.4,
    fill: { type: "none" },
    line: { color: PPT.borderGold, width: 1 },
  });

  const heroPiece = pieces.find((piece) => imageByPieceId.has(piece.id));
  const heroImage = heroPiece ? imageByPieceId.get(heroPiece.id) : undefined;
  if (heroImage) {
    cover.addImage({ data: heroImage, x: 7.6, y: 0.05, w: 5.65, h: 7.4, sizing: { type: "cover", w: 5.65, h: 7.4 } });
  }

  cover.addText(collectionName, { x: 0.8, y: 2.5, w: 6.3, h: 1.1, fontSize: 40, color: PPT.titleGold, fontFace: "Cambria" });
  cover.addShape("line", { x: 0.8, y: 3.75, w: 0.7, h: 0, line: { color: PPT.borderGold, width: 1 } });
  cover.addText("◆", { x: 1.55, y: 3.6, w: 0.3, h: 0.3, fontSize: 10, color: PPT.borderGold, align: "center" });
  cover.addShape("line", { x: 1.9, y: 3.75, w: 0.7, h: 0, line: { color: PPT.borderGold, width: 1 } });
  cover.addText(tagline, { x: 0.8, y: 4.0, w: 5.5, h: 0.5, fontSize: 12, color: PPT.ink, charSpacing: 2 });

  const { existing, ideation } = splitEntries(items, pieces);

  /** The gold frame and section title every grid slide carries. */
  const gridSlide = (label: string) => {
    const slide = deck.addSlide();
    slide.background = { color: "FFFFFF" };
    slide.addShape("rect", {
      x: 0.05,
      y: 0.05,
      w: 13.23,
      h: 7.4,
      fill: { type: "none" },
      line: { color: PPT.borderGold, width: 1 },
    });
    slide.addText(label, {
      x: 9.5,
      y: 0.4,
      w: 3.3,
      h: 0.4,
      fontSize: 16,
      italic: true,
      color: PPT.ink,
      fontFace: "Cambria",
      align: "right",
    });
    return slide;
  };

  /* ── Existing style — 4 per slide, real spec captions only ─────────── */
  const EXISTING_PER_SLIDE = 4;
  for (let start = 0; start < existing.length; start += EXISTING_PER_SLIDE) {
    const chunk = existing.slice(start, start + EXISTING_PER_SLIDE);
    const slide = gridSlide("Existing style");

    const cols = 2;
    const cardW = 5.8;
    const cardH = 2.9;

    chunk.forEach(({ item, piece }, position) => {
      const x = 0.8 + (position % cols) * (cardW + 0.6);
      const y = 1.1 + Math.floor(position / cols) * (cardH + 0.5);

      const image = piece ? imageByPieceId.get(piece.id) : undefined;
      if (image) slide.addImage({ data: image, x, y, w: cardW, h: cardH, sizing: { type: "contain", w: cardW, h: cardH } });

      slide.addText(item.sourceCode || "Existing piece", {
        x,
        y: y + cardH + 0.05,
        w: cardW,
        h: 0.3,
        fontSize: 13,
        color: PPT.ink,
        align: "center",
      });
      // Guarded: an empty string still adds a stray text frame to the slide.
      if (item.caption) {
        slide.addText(item.caption, {
          x,
          y: y + cardH + 0.35,
          w: cardW,
          h: 0.25,
          fontSize: 10,
          color: PPT.labelGray,
          align: "center",
        });
      }
    });
  }

  /* ── New Ideation — 6 per slide, each card spanning its chosen size ── */
  const IDEATION_PER_SLIDE = 6;
  for (let start = 0; start < ideation.length; start += IDEATION_PER_SLIDE) {
    const chunk = ideation.slice(start, start + IDEATION_PER_SLIDE);
    const slide = gridSlide("New Ideation");

    const cols = 3;
    const unitW = 3.9;
    const cardH = 2.8;
    let col = 0;
    let row = 0;

    chunk.forEach(({ item, index, piece }) => {
      const span = Math.min(SIZE_COLS[item.size ?? "md"], cols);
      if (col + span > cols) {
        col = 0;
        row += 1;
      }

      const x = 0.55 + col * (unitW + 0.35);
      const y = 1.15 + row * (cardH + 0.75 + 0.35);
      const cardW = unitW * span + 0.35 * (span - 1);

      slide.addText(item.category, { x, y, w: cardW, h: 0.3, fontSize: 12, color: PPT.labelGray, align: "center" });

      const image = piece ? imageByPieceId.get(piece.id) : undefined;
      if (image) {
        slide.addImage({ data: image, x, y: y + 0.35, w: cardW, h: cardH, sizing: { type: "contain", w: cardW, h: cardH } });
      }

      slide.addText(item.sourceCode || `${piece?.designerInitial || "R"}-${index + 1}`, {
        x,
        y: y + 0.35 + cardH + 0.05,
        w: cardW * 0.5,
        h: 0.25,
        fontSize: 11,
        bold: true,
        color: PPT.ink,
      });
      // A New Ideation piece ships with no title or caption by design.
      if (item.title) {
        slide.addText(item.title, {
          x: x + cardW * 0.5,
          y: y + 0.35 + cardH + 0.05,
          w: cardW * 0.5,
          h: 0.25,
          fontSize: 10,
          color: PPT.labelGray,
          align: "right",
        });
      }
      if (item.caption) {
        slide.addText(item.caption, { x, y: y + 0.35 + cardH + 0.3, w: cardW, h: 0.25, fontSize: 9, color: PPT.labelGray });
      }

      col += span;
      if (col >= cols) {
        col = 0;
        row += 1;
      }
    });
  }

  await deck.writeFile({ fileName: fileName(collectionName, "pptx") });
}

/**
 * The PDF, via the browser's print dialog.
 *
 * Deliberately not a canvas screenshot: the deck is already at slide ratio
 * and the print stylesheet hides everything around it, so printing gives
 * real vector text at whatever resolution the user chooses.
 */
export function exportAffinityPdf() {
  window.print();
}

export { hasProductionSheet };
