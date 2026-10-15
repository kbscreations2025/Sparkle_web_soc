"use client";

import type { AffinityItem } from "./api";
import { hasProductionSheet, splitCategoryEntries, splitEntries, type AffinityPiece, type DeckCategory } from "./affinity";
import { backgroundBox, backgroundSource, imageSource, type DeckDesign } from "./deckDesign";
import { urlToDataUrl } from "./image";

/** A picture's own width ÷ height, so PowerPoint can fit or crop it without stretching. */
function aspectOf(data: string): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth / Math.max(1, img.naturalHeight) || 1);
    img.onerror = () => resolve(1);
    img.src = data;
  });
}

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

  // A saved kit's photos are on R2, which won't let a browser read them
  // cross-origin — so they come through the backend, which can.
  try {
    return await urlToDataUrl(url);
  } catch {
    // Not one of ours (a same-origin asset, say) — try it directly below.
  }

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
  categories = [],
}: {
  collectionName: string;
  tagline: string;
  items: AffinityItem[];
  pieces: AffinityPiece[];
  /** Collection Story's groups — one cover and its own sections each. */
  categories?: DeckCategory[];
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

  /*
   * One chapter for a plain deck — its cover and its two sections — or one
   * per Collection Story category, each with its own name, tagline, chosen
   * cover photo and only its own pieces, exactly as the deck lays them out.
   */
  const chapters =
    categories.length > 0
      ? categories.map((category) => ({
          name: category.name,
          tagline: category.tagline,
          label: category.name,
          hero: pieces[category.coverIndex] ?? pieces[category.pieceIndexes[0]],
          ...splitCategoryEntries(items, pieces, category),
        }))
      : [
          {
            name: collectionName,
            tagline,
            label: "",
            hero: pieces.find((piece) => imageByPieceId.has(piece.id)),
            ...splitEntries(items, pieces),
          },
        ];

  for (const chapter of chapters) {
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

    const heroImage = chapter.hero ? imageByPieceId.get(chapter.hero.id) : undefined;
    if (heroImage) {
      cover.addImage({ data: heroImage, x: 7.6, y: 0.05, w: 5.65, h: 7.4, sizing: { type: "cover", w: 5.65, h: 7.4 } });
    }

    cover.addText(chapter.name, { x: 0.8, y: 2.5, w: 6.3, h: 1.1, fontSize: 40, color: PPT.titleGold, fontFace: "Cambria" });
    cover.addShape("line", { x: 0.8, y: 3.75, w: 0.7, h: 0, line: { color: PPT.borderGold, width: 1 } });
    cover.addText("◆", { x: 1.55, y: 3.6, w: 0.3, h: 0.3, fontSize: 10, color: PPT.borderGold, align: "center" });
    cover.addShape("line", { x: 1.9, y: 3.75, w: 0.7, h: 0, line: { color: PPT.borderGold, width: 1 } });
    cover.addText(chapter.tagline, { x: 0.8, y: 4.0, w: 5.5, h: 0.5, fontSize: 12, color: PPT.ink, charSpacing: 2 });

    const { existing, ideation } = chapter;

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
      // Which category these slides belong to, where the deck has categories.
      if (chapter.label) {
        slide.addText(chapter.label.toUpperCase(), { x: 0.6, y: 0.4, w: 6, h: 0.4, fontSize: 11, color: PPT.titleGold, charSpacing: 3 });
      }
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
  }

  await deck.writeFile({ fileName: fileName(collectionName, "pptx") });
}

/**
 * The edited design as PowerPoint — every element where it was placed, as a
 * native text box, picture or shape, so the file stays editable in PowerPoint.
 *
 * The design's 1280×720 space is exactly PowerPoint's 13.333×7.5in wide
 * layout at 96px to the inch, so a position converts by dividing by 96.
 */
export async function exportDesignPptx({
  design,
  pieces,
  collectionName,
}: {
  design: DeckDesign;
  pieces: AffinityPiece[];
  collectionName: string;
}) {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const deck = new PptxGenJS();
  deck.layout = "LAYOUT_WIDE";

  const inch = (px: number) => px / 96;
  const hex = (color: string) => color.replace("#", "").slice(0, 6).toUpperCase();
  const visible = (color: string) => Boolean(color) && color !== "transparent";

  // Each picture fetched once, however many times it appears.
  const cache = new Map<string, Promise<string | null>>();
  const dataFor = (url: string) => {
    if (!cache.has(url)) cache.set(url, toBase64(url));
    return cache.get(url)!;
  };

  const SHAPES: Record<string, string> = {
    rect: "rect",
    ellipse: "ellipse",
    diamond: "diamond",
    triangle: "triangle",
    sparkle: "star4",
    star: "star5",
    hexagon: "hexagon",
    octagon: "octagon",
    heart: "heart",
    arrow: "rightArrow",
    chevron: "chevron",
    plus: "plus",
    parallelogram: "parallelogram",
  };
  const DASH = { solid: "solid", dash: "dash", dot: "sysDot" } as const;

  for (const designSlide of design.slides) {
    const slide = deck.addSlide();
    slide.background = { color: hex(designSlide.background) };

    // The background picture first, so everything else lands on top of it.
    const backdrop = designSlide.backgroundImage;
    const backdropUrl = backdrop ? backgroundSource(backdrop, pieces) : "";
    const backdropData = backdropUrl ? await dataFor(backdropUrl) : null;
    if (backdrop && backdropData) {
      const box = backgroundBox(backdrop);
      const aspect = await aspectOf(backdropData);
      slide.addImage({
        data: backdropData,
        x: inch(box.x),
        y: inch(box.y),
        w: inch(box.w),
        h: inch(box.w) / aspect,
        sizing: { type: backdrop.mode === "fill" ? "cover" : "contain", w: inch(box.w), h: inch(box.h) },
        transparency: Math.round((1 - backdrop.opacity) * 100),
      });
    }

    for (const element of designSlide.elements) {
      const box = { x: inch(element.x), y: inch(element.y), w: inch(element.w), h: inch(element.h), rotate: element.rotation || 0 };
      const transparency = Math.round((1 - element.opacity) * 100);

      if (element.type === "text") {
        // An empty box is a prompt in the editor, not part of the deck.
        if (!element.text.trim()) continue;
        slide.addText(element.uppercase ? element.text.toUpperCase() : element.text, {
          ...box,
          fontFace: element.fontFamily,
          fontSize: Math.max(1, element.fontSize * 0.75),
          bold: element.bold,
          italic: element.italic,
          underline: element.underline ? { style: "sng" } : undefined,
          color: hex(element.color),
          align: element.align,
          valign: "top",
          charSpacing: element.letterSpacing * 0.75,
          lineSpacingMultiple: element.lineHeight,
          margin: 0,
          transparency,
        });
      } else if (element.type === "image") {
        const url = imageSource(element, pieces);
        const data = url ? await dataFor(url) : null;
        if (!data) continue;
        // pptxgenjs fits or crops from the size it is told the picture is, so
        // that size has to carry the picture's real proportions.
        const aspect = await aspectOf(data);
        slide.addImage({
          data,
          x: box.x,
          y: box.y,
          w: box.w,
          h: box.w / aspect,
          rotate: box.rotate,
          sizing: { type: element.fit, w: box.w, h: box.h },
          transparency,
        });
      } else if (element.shape === "line") {
        slide.addShape("line", {
          x: box.x,
          y: box.y + box.h / 2,
          w: box.w,
          h: 0,
          rotate: box.rotate,
          line: {
            color: hex(visible(element.stroke) ? element.stroke : element.fill),
            width: Math.max(0.5, element.strokeWidth * 0.75),
            dashType: DASH[element.dash ?? "solid"],
            transparency,
          },
        });
      } else {
        const rounded = element.shape === "rect" && element.radius > 0;
        slide.addShape((rounded ? "roundRect" : SHAPES[element.shape]) as Parameters<typeof slide.addShape>[0], {
          ...box,
          fill: visible(element.fill) ? { color: hex(element.fill), transparency } : { type: "none" },
          line:
            visible(element.stroke) && element.strokeWidth > 0
              ? { color: hex(element.stroke), width: element.strokeWidth * 0.75, dashType: DASH[element.dash ?? "solid"], transparency }
              : { type: "none" },
          ...(rounded ? { rectRadius: Math.min(0.5, element.radius / Math.min(element.w, element.h)) } : {}),
        } as Parameters<typeof slide.addShape>[1]);
      }
    }
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
