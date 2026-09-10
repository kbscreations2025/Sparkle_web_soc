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

/** Turns a data URI into a file the browser will download. */
export function downloadDataUrl(dataUrl: string, filename: string) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}
