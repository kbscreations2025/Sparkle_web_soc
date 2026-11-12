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

/**
 * Like `compressImage`, for graphics placed on a deck page — logos, marks,
 * textures. A PNG, WebP or GIF keeps its transparency (re-encoded as PNG),
 * where `compressImage`'s JPEG would turn a logo's clear background black;
 * an SVG is kept as it is. Capped smaller, as nothing on a slide needs more.
 */
export function compressGraphic(file: File, maxSide = 1600): Promise<string> {
  if (file.type === "image/svg+xml") return readAsDataUrl(file);
  const transparent = ["image/png", "image/webp", "image/gif"].includes(file.type);
  if (!transparent) return compressImage(file);

  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Could not read ${file.name}`));
    };
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const context = canvas.getContext("2d");
      if (!context) return resolve(readAsDataUrl(file));
      context.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (!blob) return resolve(readAsDataUrl(file));
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => resolve(readAsDataUrl(file));
        reader.readAsDataURL(blob);
      }, "image/png");
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
/**
 * Saves a whole set of results as ONE zip — `<baseName>.zip` holding
 * `<baseName>-1.jpg`, `<baseName>-2.jpg`… — instead of a download per image.
 *
 * Six separate downloads meant six save prompts (or six files scattered in
 * Downloads), and browsers throttle a burst of them from one click. Each file
 * is still fetched through our download proxy (the stored urls are
 * cross-origin), one at a time so several multi-megabyte streams don't run at
 * once; one that fails is left out rather than sinking the whole zip.
 *
 * A single image is saved as itself — a zip of one is just an extra step.
 * Resolves with how many went in, so a caller can tell a partial set.
 */
export async function downloadAllImages(sources: string[], baseName: string): Promise<number> {
  const files = sources.map((src, index) => ({ src, filename: downloadName(src, `${baseName}-${index + 1}`) }));
  return downloadFilesAsZip(files, baseName);
}

/** The zip behind `downloadAllImages`, for callers that name each file themselves (History). */
export async function downloadFilesAsZip(files: { src: string; filename: string }[], zipName: string): Promise<number> {
  if (files.length === 0) return 0;
  if (files.length === 1) return (await downloadImage(files[0].src, files[0].filename)) ? 1 : 0;

  // Loaded on demand — only someone saving a set pays for the library.
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  let added = 0;

  for (const file of files) {
    const blob = await fetchForDownload(file.src, file.filename);
    if (!blob) continue;
    // Already-compressed images: storing, not deflating, keeps it fast.
    zip.file(file.filename, blob, { compression: "STORE" });
    added++;
  }
  if (added === 0) return 0;

  const objectUrl = URL.createObjectURL(await zip.generateAsync({ type: "blob" }));
  saveLocalUrl(objectUrl, `${zipName}.zip`);
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
  return added;
}

/** One file's bytes, through our proxy for a stored url — null when it can't be had. */
async function fetchForDownload(src: string, filename: string): Promise<Blob | null> {
  try {
    if (src.startsWith("data:") || src.startsWith("blob:")) return await (await fetch(src)).blob();
    const endpoint = `${BACKEND_URL}/api/history/download?url=${encodeURIComponent(src)}&filename=${encodeURIComponent(filename)}`;
    const res = await fetch(endpoint, { credentials: "include" });
    if (!res.ok) throw new Error(`download failed with ${res.status}`);
    return await res.blob();
  } catch (error) {
    console.error(`Could not download ${filename}:`, error);
    return null;
  }
}

/**
 * The name a stored result should land on disk under.
 *
 * The extension is read off the stored url, because that is what the bytes
 * actually are — the download streams the object through untouched, so a
 * name invented independently of it is just a guess. Every Download button
 * used to hardcode `.jpg`, which meant a clip saved as a photo: the bytes
 * were a perfectly good mp4, and the operating system opened them in an
 * image viewer and gave up.
 *
 * `type` is the fallback for a url with no extension, and "jpg" the
 * fallback for that — this is a filename, so it must always produce one.
 */
export function downloadName(url: string, baseName: string, type?: string): string {
  // Parsed as a url so a query string or fragment can't be mistaken for an
  // extension. The base is a throwaway: it only makes a relative url parse.
  let pathname = url;
  try {
    pathname = new URL(url, "https://placeholder.invalid").pathname;
  } catch {
    /* Not a url at all — fall through and try the raw string. */
  }

  const match = pathname.match(/\.([a-z0-9]{2,4})$/i);
  const extension = match ? match[1].toLowerCase() : type === "video" ? "mp4" : "jpg";
  return `${baseName}.${extension}`;
}

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
