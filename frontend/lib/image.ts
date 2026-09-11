import { BACKEND_URL } from "./api";

/** Long edge cap. Past this the model gains nothing and the upload just gets slower. */
const MAX_SIDE = 2048;

/** High enough that retouching detail survives the round trip. */
const JPEG_QUALITY = 0.88;

/**
 * Shrinks and re-encodes a picked file to a data URI before it is uploaded.
 *
 * Phone photos are routinely 8–12MB, which is slow to send and no more useful
 * to the model than a 2048px version. Falls back to the untouched file if
 * canvas encoding fails, so a strange format still gets a chance upstream.
 */
export function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Could not read ${file.name}`));
    };

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);

      const context = canvas.getContext("2d");
      if (!context) return resolve(readAsDataUrl(file));

      context.drawImage(img, 0, 0, canvas.width, canvas.height);

      // toBlob + FileReader rather than the simpler toDataURL: toDataURL
      // encodes synchronously and can briefly freeze the tab on a large
      // canvas, where toBlob hands the work off and resolves via a callback.
      canvas.toBlob(
        (blob) => {
          if (!blob) return resolve(readAsDataUrl(file)); // unsupported encoder — send the original
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => resolve(readAsDataUrl(file));
          reader.readAsDataURL(blob);
        },
        "image/jpeg",
        JPEG_QUALITY
      );
    };

    img.src = objectUrl;
  });
}

/** Long edge of a queue thumbnail. Enough to recognise a piece, not to inspect it. */
const THUMB_SIDE = 96;
const THUMB_QUALITY = 0.6;

/**
 * A tiny stand-in for an image, small enough to live in a database row.
 *
 * The queue rail has to show what is being worked on, but a job record
 * deliberately stores no image bytes — the full picture travels through Redis
 * and is dropped when the job settles. A 96px JPEG is a few kilobytes, which
 * is cheap enough to keep on the job itself and is all the rail can display
 * anyway.
 *
 * Resolves to null rather than throwing: a missing thumbnail costs a preview,
 * and that must never be the reason a generation doesn't get submitted.
 */
export function makeThumbnail(dataUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onerror = () => resolve(null);
    img.onload = () => {
      const scale = Math.min(1, THUMB_SIDE / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));

      const context = canvas.getContext("2d");
      if (!context) return resolve(null);

      context.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          if (!blob) return resolve(null);
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(blob);
        },
        "image/jpeg",
        THUMB_QUALITY
      );
    };
    img.src = dataUrl;
  });
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

/**
 * Fetches a hosted image (an R2 result URL, typically) and turns it into a
 * data URI. Needed when resuming a History conversation: the backend only
 * ever accepts a data URI as the image to edit, but a past result is stored
 * and returned as a URL, not the base64 that produced it.
 *
 * Routed through the backend rather than fetched directly: R2 doesn't send
 * CORS headers permitting a browser to read the response, but there's no
 * such restriction server-to-server.
 */
export async function urlToDataUrl(url: string): Promise<string> {
  const res = await fetch(`${BACKEND_URL}/api/history/image-data?url=${encodeURIComponent(url)}`, {
    credentials: "include",
  });
  const body = await res.json();
  if (body.status !== "success") throw new Error(body.message || "Could not load image");
  return body.dataUri;
}

/**
 * Hands a same-origin url to the browser as a file to save.
 *
 * Not exported: `downloadImage` is the one way anything downloads an image,
 * so a caller can't accidentally reach for this with a remote url — which is
 * exactly the mistake that made every Download button open the picture
 * instead of saving it.
 */
function saveLocalUrl(url: string, filename: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/**
 * Saves an image to disk, whether it is inline bytes or a stored result.
 *
 * A plain `<a href download>` only works for the first kind. The `download`
 * attribute is ignored on a cross-origin URL — a deliberate browser rule, so
 * one site can't silently write files sourced from another — and an R2 result
 * url is always cross-origin. The anchor then falls back to being an ordinary
 * link, which is why clicking Download used to just open the picture.
 *
 * So a stored result is pulled through our own backend, which returns it with
 * `Content-Disposition: attachment`. That both makes it a download and lets
 * the filename be one we chose. The bytes are turned into a blob URL rather
 * than navigated to, so the tab never leaves the page.
 *
 * Resolves `false` instead of throwing when it can't: every Download button
 * in the app treats a failure the same way, and making each one write its own
 * `.catch` only invites one of them to forget and surface an unhandled
 * rejection.
 */
export async function downloadImage(src: string, filename: string): Promise<boolean> {
  // Inline bytes are same-origin by definition — the simple path still works.
  if (src.startsWith("data:") || src.startsWith("blob:")) {
    saveLocalUrl(src, filename);
    return true;
  }

  let objectUrl: string | null = null;
  try {
    const endpoint = `${BACKEND_URL}/api/history/download?url=${encodeURIComponent(src)}&filename=${encodeURIComponent(filename)}`;
    const res = await fetch(endpoint, { credentials: "include" });
    if (!res.ok) throw new Error(`download failed with ${res.status}`);

    objectUrl = URL.createObjectURL(await res.blob());
    saveLocalUrl(objectUrl, filename);
    return true;
  } catch (error) {
    console.error(`Could not download ${filename}:`, error);
    return false;
  } finally {
    // Not immediately: revoking before the click has been handled cancels the
    // download in some browsers.
    const created = objectUrl;
    if (created) setTimeout(() => URL.revokeObjectURL(created), 10000);
  }
}
