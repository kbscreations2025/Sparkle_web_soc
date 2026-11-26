import type { HistoryOutput, LibraryItem } from "../api";
import type { Aspect, ContactButton, Media } from "./types";

/* ── Pictures ────────────────────────────────────────────────────────── */

/** The long edge of every stored thumbnail (backend/src/storage/thumbnail.js). */
const THUMB_MAX_SIDE = 640;

/** A picked library photo, by reference: nothing is downloaded or uploaded again. */
export function mediaFromLibraryItem(item: LibraryItem): Media {
  return {
    kind: "image",
    url: item.url,
    thumbnailUrl: item.thumbnailUrl,
    width: item.width,
    height: item.height,
    // Product Background's transparent cutouts are PNGs, and their thumbnails were flattened onto white.
    ...(item.mimeType === "image/png" && item.tool === "product_background" ? { alpha: true } : {}),
  };
}

/** A History result or input, by reference. */
export function mediaFromHistoryOutput(output: HistoryOutput): Media {
  return output.type === "video"
    ? { kind: "video", url: output.url, posterUrl: output.thumbnailUrl, width: output.width, height: output.height }
    : { kind: "image", url: output.url, thumbnailUrl: output.thumbnailUrl, width: output.width, height: output.height };
}

/** The small copy, where it's safe to show one; the original otherwise. */
export function thumbOf(media: Media): string {
  if (media.kind === "video") return media.posterUrl || "";
  return !media.alpha && media.thumbnailUrl ? media.thumbnailUrl : media.url;
}

/**
 * `src` and `srcSet` for a picture on the public page.
 *
 * Both stored sizes are offered and the browser picks. A gallery tile on a
 * phone gets the 640px copy; a full-width hero on a 3x screen, where that
 * copy would look soft, gets the original. Whatever is picked, the picture is
 * never re-encoded on the way, and zoom always opens the original.
 */
export function responsiveSources(media: Media): { src: string; srcSet?: string } {
  const original = media.url;
  const thumb = !media.alpha && media.thumbnailUrl && media.thumbnailUrl !== original ? media.thumbnailUrl : null;
  if (!thumb) return { src: original };
  const width = media.width ?? null;
  const height = media.height ?? null;
  const scale = width && height ? Math.min(1, THUMB_MAX_SIDE / Math.max(width, height)) : 1;
  const thumbWidth = width && height ? Math.round(width * scale) : THUMB_MAX_SIDE;
  // Unknown size: assume a large original, so big slots still get it.
  const fullWidth = width ?? 2400;
  if (fullWidth <= thumbWidth) return { src: original };
  return { src: thumb, srcSet: `${thumb} ${thumbWidth}w, ${original} ${fullWidth}w` };
}

/**
 * A `sizes` value for a slot taking `desktop` of the content width on a large
 * screen and `mobile` of the screen on a phone. `maxWidth` is the content
 * column's cap, past which the slot stops growing.
 */
export function sizesFor({ desktop, mobile, maxWidth }: { desktop: number; mobile: number; maxWidth: number | null }) {
  const phone = `${Math.round(mobile * 100)}vw`;
  const tablet = `${Math.round(desktop * 100)}vw`;
  if (!maxWidth) return `(min-width: 768px) ${tablet}, ${phone}`;
  return `(min-width: ${maxWidth}px) ${Math.round(maxWidth * desktop)}px, (min-width: 768px) ${tablet}, ${phone}`;
}

export const ASPECT_RATIOS: Record<Aspect, number | null> = {
  auto: null,
  "1:1": 1,
  "4:5": 4 / 5,
  "3:4": 3 / 4,
  "2:3": 2 / 3,
  "3:2": 3 / 2,
  "16:9": 16 / 9,
  "9:16": 9 / 16,
};

export const ASPECT_LABELS: Record<Aspect, string> = {
  auto: "Original",
  "1:1": "Square",
  "4:5": "4:5",
  "3:4": "3:4",
  "2:3": "2:3",
  "3:2": "3:2",
  "16:9": "16:9",
  "9:16": "9:16",
};

/** A picture's own width ÷ height, when known. */
export function naturalRatio(media: Media | null | undefined): number | null {
  return media?.width && media?.height ? media.width / media.height : null;
}

/* ── Colours ─────────────────────────────────────────────────────────── */

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * A colour from the document, or the fallback. Colours go into style
 * attributes, so only a plain hex value is let through, never a string
 * that could carry a second declaration.
 */
export function safeColor(value: unknown, fallback: string): string {
  return typeof value === "string" && HEX.test(value) ? value : fallback;
}

function rgbOf(hex: string): [number, number, number] {
  let value = hex.slice(1);
  if (value.length === 3 || value.length === 4) value = value.slice(0, 3).replace(/./g, (c) => c + c);
  const n = parseInt(value.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** `hex` at `alpha` opacity, as an rgba() string. */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = rgbOf(safeColor(hex, "#000000"));
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}

/** Relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const [r, g, b] = rgbOf(safeColor(hex, "#000000")).map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Black or white, whichever reads better on `hex`. */
export function readableOn(hex: string): string {
  return luminance(hex) > 0.45 ? "#111111" : "#FFFFFF";
}

/* ── Contact links ───────────────────────────────────────────────────── */

const EMAIL = /^[^\s@<>()?&,;:"]+@[^\s@<>()?&,;:"]+\.[^\s@<>()?&,;:"]+$/;

/**
 * Where a contact button goes, built here from its bare value — or null when
 * the value can't make a working link, in which case the page shows no
 * button rather than a broken one. Only these four schemes are ever produced.
 */
export function contactHref(button: Pick<ContactButton, "kind" | "value" | "message">): string | null {
  const value = String(button.value ?? "").trim();
  const message = String(button.message ?? "").trim();
  switch (button.kind) {
    case "whatsapp": {
      const digits = value.replace(/\D/g, "");
      if (digits.length < 7) return null;
      return `https://wa.me/${digits}${message ? `?text=${encodeURIComponent(message)}` : ""}`;
    }
    case "phone": {
      const number = value.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
      return number.replace(/\D/g, "").length >= 5 ? `tel:${number}` : null;
    }
    case "email":
      return EMAIL.test(value) ? `mailto:${value}${message ? `?body=${encodeURIComponent(message)}` : ""}` : null;
    case "link":
      return /^https?:\/\/[^\s"'<>]+$/i.test(value) ? value : null;
    default:
      return null;
  }
}

/** The page's own address with a message, for "Share on WhatsApp". */
export function whatsappShareHref(text: string) {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
