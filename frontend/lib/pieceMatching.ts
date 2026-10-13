/**
 * Pairs a pile of uploaded files — jewellery photos and production sheets —
 * into pieces, the way a person would: by folder, then by name.
 *
 * Pure (no File reading), so it can be tested and so the review table shows
 * the pairing before anything heavy (rendering PDFs) happens.
 *
 * How a sheet finds its photo, strongest evidence first:
 *   1. folder — the sheet sits in a sub-folder holding exactly one photo
 *      ("Piece 3/ring.jpg" + "Piece 3/specs.pdf")
 *   2. name   — the names match once the noise is stripped
 *      ("R-1023 photo.jpg" ↔ "R-1023_sheet.pdf")
 *   3. code   — they share a style code ("IMG_AB1234.png" ↔ "AB1234 PDS.xlsx")
 *   4. similar — the names are close enough (≥ 60% alike)
 * A sheet with no convincing match is left unassigned for the person to place,
 * never guessed — a sheet on the wrong piece writes a wrong spec.
 */

export type FileRole = "photo" | "sheet";

export type MatchReason = "folder" | "name" | "code" | "similar" | "manual";

export type UploadedFile = {
  /** Stable within one batch. */
  id: string;
  name: string;
  /** "Folder/Sub/file.jpg" for a folder upload, "" for loose files. */
  path: string;
  role: FileRole;
};

export type PieceDraft = {
  photo: UploadedFile;
  sheets: { file: UploadedFile; reason: MatchReason }[];
};

export type MatchResult = {
  pieces: PieceDraft[];
  unmatchedSheets: UploadedFile[];
};

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i;
const SHEET_EXT = /\.(pdf|xlsx|xlsm|xls|csv)$/i;

/** An image whose name says it is paperwork, not the piece. */
const SHEET_WORDS = /\b(sheet|pds|spec|specs|specification|tech|technical|production|development|cad|drawing|dwg)\b/i;

/** Words that describe the file rather than the piece, stripped before comparing names. */
const NOISE_WORDS = new Set([
  "sheet", "sheets", "pds", "spec", "specs", "specification", "tech", "technical", "production", "development",
  "dev", "image", "img", "photo", "photos", "pic", "picture", "final", "copy", "new", "edit", "edited", "hd",
  "front", "main", "hero", "jewellery", "jewelry", "cad", "drawing", "file", "scan", "scanned",
]);

/** What a file is, from its name and type. Null for anything that can't be used. */
export function roleOf(name: string, mimeType = ""): FileRole | null {
  if (SHEET_EXT.test(name) || mimeType === "application/pdf") return "sheet";
  if (IMAGE_EXT.test(name) || mimeType.startsWith("image/")) {
    return SHEET_WORDS.test(separated(stem(name))) ? "sheet" : "photo";
  }
  return null;
}

function stem(name: string) {
  return name.replace(/\.[^.]+$/, "");
}

/** "R-1023_Sheet(1)" → "r 1023 sheet 1" — camelCase and digit runs split too. */
function separated(text: string) {
  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-zA-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The name with the noise removed: what actually identifies the piece. */
export function nameKey(name: string) {
  return separated(stem(name))
    .split(" ")
    .filter((word) => word && !NOISE_WORDS.has(word))
    // A trailing "1"/"2" is usually a copy or page counter, not the piece.
    .filter((word, index, words) => !(index === words.length - 1 && words.length > 1 && /^\d$/.test(word)))
    .join(" ");
}

/** Style-code-like tokens: a run of 3+ digits, optionally with letters — "1023", "ab1234". */
function codes(name: string) {
  const raw = stem(name).toLowerCase();
  const found = new Set<string>();
  for (const match of raw.matchAll(/[a-z]{0,4}[-_ ]?\d{3,}[a-z]?/g)) {
    found.add(match[0].replace(/[-_ ]/g, ""));
    const digits = match[0].match(/\d{3,}/)?.[0];
    if (digits) found.add(digits);
  }
  return found;
}

/** Similarity 0–1 from the longest common substring of two keys, against the shorter. */
function similarity(a: string, b: string) {
  const x = a.replace(/ /g, "");
  const y = b.replace(/ /g, "");
  if (!x || !y) return 0;
  let best = 0;
  const row = new Array(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i++) {
    let prev = 0;
    for (let j = 1; j <= y.length; j++) {
      const temp = row[j];
      row[j] = x[i - 1] === y[j - 1] ? prev + 1 : 0;
      if (row[j] > best) best = row[j];
      prev = temp;
    }
  }
  return best / Math.min(x.length, y.length);
}

function folderOf(file: UploadedFile) {
  const parts = file.path.split("/");
  // Only a real sub-folder counts: the folder the person picked holds everything.
  return parts.length > 2 ? parts.slice(0, -1).join("/") : "";
}

/** How strongly a sheet points at a photo, or 0. Higher wins. */
function score(sheet: UploadedFile, photo: UploadedFile): { value: number; reason: MatchReason } {
  const sheetKey = nameKey(sheet.name);
  const photoKey = nameKey(photo.name);
  if (sheetKey && sheetKey === photoKey) return { value: 90, reason: "name" };

  const shortest = Math.min(sheetKey.length, photoKey.length);
  if (shortest >= 3 && (sheetKey.includes(photoKey) || photoKey.includes(sheetKey))) return { value: 80, reason: "name" };

  const sheetCodes = codes(sheet.name);
  for (const code of codes(photo.name)) if (sheetCodes.has(code)) return { value: 70, reason: "code" };

  const alike = similarity(sheetKey, photoKey);
  if (shortest >= 3 && alike >= 0.6) return { value: 40 + alike * 20, reason: "similar" };
  return { value: 0, reason: "similar" };
}

export function matchFiles(files: UploadedFile[]): MatchResult {
  const photos = files.filter((file) => file.role === "photo");
  const sheets = files.filter((file) => file.role === "sheet");
  const pieces: PieceDraft[] = photos
    .slice()
    .sort((a, b) => (a.path || a.name).localeCompare(b.path || b.name, undefined, { numeric: true }))
    .map((photo) => ({ photo, sheets: [] }));

  // Folders first: a sub-folder with exactly one photo owns every sheet in it.
  const photosByFolder = new Map<string, PieceDraft[]>();
  for (const piece of pieces) {
    const folder = folderOf(piece.photo);
    if (folder) photosByFolder.set(folder, [...(photosByFolder.get(folder) ?? []), piece]);
  }

  const unmatchedSheets: UploadedFile[] = [];
  for (const sheet of sheets) {
    const inFolder = photosByFolder.get(folderOf(sheet));
    if (folderOf(sheet) && inFolder?.length === 1) {
      inFolder[0].sheets.push({ file: sheet, reason: "folder" });
      continue;
    }

    // Then by name, among the folder's photos if it has several, else all.
    const candidates = inFolder?.length ? inFolder : pieces;
    let best: { piece: PieceDraft; value: number; reason: MatchReason } | null = null;
    let runnerUp = 0;
    for (const piece of candidates) {
      const { value, reason } = score(sheet, piece.photo);
      if (!best || value > best.value) {
        runnerUp = best?.value ?? 0;
        best = { piece, value, reason };
      } else if (value > runnerUp) {
        runnerUp = value;
      }
    }

    // A tie is not a match: two photos equally like the sheet is a guess.
    if (best && best.value > 0 && best.value > runnerUp) best.piece.sheets.push({ file: sheet, reason: best.reason });
    else unmatchedSheets.push(sheet);
  }

  return { pieces, unmatchedSheets };
}
