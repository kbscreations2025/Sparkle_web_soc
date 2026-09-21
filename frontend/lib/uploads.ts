"use client";

import { compressImage } from "./image";
import type { UploadItem } from "@/components/studio/UploadZone";

/**
 * Turns picked files into the items an `UploadZone` renders.
 *
 * Four pages were doing this identically — mint an id, keep the name,
 * compress to a data URI, in parallel — each with its own try/catch around
 * it. The compression is the part that matters: a phone photo is several
 * megabytes and these travel to the server as base64 inside a JSON body.
 *
 * Rejects on the first unreadable file rather than silently dropping it, so
 * a caller can tell the user why nothing appeared. `limit` caps how many are
 * taken, for the tools that accept a bounded number of pieces.
 */
export async function filesToUploadItems(files: File[], limit?: number): Promise<UploadItem[]> {
  const accepted = typeof limit === "number" ? files.slice(0, Math.max(0, limit)) : files;

  return Promise.all(
    accepted.map(async (file) => ({
      id: crypto.randomUUID(),
      name: file.name,
      dataUrl: await compressImage(file),
    }))
  );
}

/** The message to show when a pick could not be read. */
export function uploadErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : "Could not read that file";
}
