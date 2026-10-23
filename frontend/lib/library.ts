"use client";

import { useCallback, useState, type RefObject } from "react";
import { BACKEND_URL, type LibraryItem } from "./api";
import { useAuth } from "./auth-context";
import { TOOL_LABELS } from "./nav";
import { can } from "./permissions";

/**
 * The grant the library sits behind — History's, since it is the same
 * pictures, and a pick is turned into bytes through a History route.
 */
export const LIBRARY_PERMISSION = "result.read.own";

/** Where a picked file came from, for the pages that care — see `libraryOriginOf`. */
export type LibraryOrigin = {
  assetId: string;
  /** The photo's fingerprint, as the library de-duplicates on it — see `LibraryItem.fingerprint`. */
  fingerprint: string;
  tool: string;
  role: string;
};

/**
 * Picks travel as plain `File`s, so every upload box's existing handler —
 * resize, fingerprint, duplicate check — treats a pick exactly as a file off
 * the disk and no tool needed changing. The few that want to know it was a
 * pick look it up here. A WeakMap, so a file nothing holds any more is let go.
 */
const origins = new WeakMap<File, LibraryOrigin>();

/** Undefined for a file that came off the disk. */
export function libraryOriginOf(file: File): LibraryOrigin | undefined {
  return origins.get(file);
}

const EXTENSION_BY_MIME: Record<string, string> = { "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

/**
 * What a pick is called wherever a page shows a file's name — "Image Cleaning
 * upload · 21 Oct 2026.jpg". Original file names were never stored, so this
 * says what the library knows instead: where it came from, and when.
 */
function libraryFileName(item: LibraryItem) {
  const tool = TOOL_LABELS[item.tool] ?? "Sparkle";
  const kind = item.role === "generated" ? "result" : "upload";
  const day = new Date(item.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  return `${tool} ${kind} · ${day}.${EXTENSION_BY_MIME[item.mimeType] ?? "jpg"}`;
}

/**
 * The stored original as a `File`, as if it had just been chosen from disk.
 *
 * Streamed through /api/history/download rather than /api/history/image-data:
 * R2 sends no CORS headers, so the bytes have to come through our own origin
 * either way, but image-data builds the whole image as base64 JSON in the
 * API's memory — and results run to 20MB, picked several at a time, on a
 * process capped at a few hundred. The download route streams them.
 */
async function libraryItemToFile(item: LibraryItem, signal?: AbortSignal): Promise<File> {
  const res = await fetch(`${BACKEND_URL}/api/history/download?url=${encodeURIComponent(item.url)}`, {
    credentials: "include",
    signal,
  });
  if (!res.ok) throw new Error("Could not load that photo from your library — try again.");
  const blob = await res.blob();
  const file = new File([blob], libraryFileName(item), {
    type: blob.type || item.mimeType,
    lastModified: Date.parse(item.createdAt) || Date.now(),
  });
  origins.set(file, { assetId: item.id, fingerprint: item.fingerprint, tool: item.tool, role: item.role });
  return file;
}

/** How many originals download at once — several megabytes each, so a few at a time. */
const PARALLEL_DOWNLOADS = 3;

/**
 * Every pick as a `File`, in the order they were picked. Rejects if any one
 * can't be fetched: adding some of a selection and quietly dropping the rest
 * would leave the person to work out which.
 */
export async function libraryItemsToFiles(
  items: LibraryItem[],
  { signal, onProgress }: { signal?: AbortSignal; onProgress?: (done: number) => void } = {}
): Promise<File[]> {
  const files: File[] = new Array(items.length);
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      files[index] = await libraryItemToFile(items[index], signal);
      onProgress?.(++done);
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL_DOWNLOADS, items.length) }, worker));
  return files;
}

/**
 * Opens the library from an upload box, or — for someone without the grant —
 * goes straight to the file dialog, which is all the box used to do.
 *
 * `fallbackInput` is the box's own file input, kept for exactly that case.
 */
export function useLibraryPicker(fallbackInput: RefObject<HTMLInputElement | null>) {
  const { user } = useAuth();
  const available = can(user, LIBRARY_PERMISSION);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return {
    /** Whether clicking the box offers the library at all — for its help text. */
    available,
    open,
    close,
    show: () => {
      if (available) setOpen(true);
      else fallbackInput.current?.click();
    },
  };
}
