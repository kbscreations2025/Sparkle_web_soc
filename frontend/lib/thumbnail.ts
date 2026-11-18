"use client";

import { useCallback, useState } from "react";

/**
 * The small copy of a stored image, for anywhere it's shown small.
 *
 * Every image the backend stores in R2 gets a `<id>_thumb.webp` beside it,
 * at most 640px on its long edge (backend/src/storage/thumbnail.js). Results
 * are often 4K, several megabytes each, while chat tiles, toasts and the queue
 * rail draw them at 36–160px. The address is derived from the original's
 * rather than carried separately, so every place that only holds the
 * original's url can still ask for the thumbnail.
 *
 * Anything else comes back unchanged: a data: or blob: url (a photo the user
 * just picked, not yet uploaded), a video, an address outside the stored
 * images, or one that already is a thumbnail.
 */
export function thumbnailUrlFor<T extends string | null | undefined>(url: T): T {
  if (!url || !/^https?:\/\//.test(url) || !url.includes("/tenants/") || url.includes("_thumb.")) return url;
  const match = /^(.*)\.(jpe?g|png|webp)(\?.*)?$/i.exec(url);
  return (match ? `${match[1]}_thumb.webp` : url) as T;
}

/**
 * The thumbnail to show for `src`, and an `onError` that falls back to the
 * original. A few older images, or ones whose resize failed when they were
 * saved, have no thumbnail; for those this costs one failed request, never a
 * broken picture.
 */
export function useThumbnail(src: string | null | undefined) {
  const [failed, setFailed] = useState<string | null>(null);
  const thumb = thumbnailUrlFor(src);
  const shown = src && failed === src ? src : thumb;
  const onError = useCallback(() => {
    if (src && shown !== src) setFailed(src);
  }, [src, shown]);
  return [shown ?? undefined, onError] as const;
}
