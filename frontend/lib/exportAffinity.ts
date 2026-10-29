"use client";

import type { AffinityPiece } from "./affinity";
import { aspectOf, backgroundBox, backgroundSource, imageSource, type DeckDesign } from "./deckDesign";
import { urlToDataUrl } from "./image";

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
 *    text in the deck stays selectable and editable in PowerPoint.
 */

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
  // Imported on demand: the library is large, and a page that never exports
  // should never download it.
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
