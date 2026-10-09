/**
 * sha256 fingerprints of photos, as lowercase hex — the same form the backend
 * stores on every asset (`checksum`, `sourceChecksum`).
 *
 * Web Crypto only exists on a secure origin (https, or localhost), so on
 * anything else these resolve to null and the caller skips whatever it wanted
 * them for, rather than failing the upload.
 */

async function sha256Hex(bytes: ArrayBuffer): Promise<string | null> {
  if (typeof crypto === "undefined" || !crypto.subtle) return null;
  try {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

/** The file exactly as it is on disk — the same whichever browser picks it. */
export async function fingerprintFile(file: File) {
  return sha256Hex(await file.arrayBuffer());
}

/** The bytes inside a data URI — what was actually uploaded after resizing. */
export async function fingerprintDataUrl(dataUrl: string) {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return sha256Hex(bytes.buffer);
}
