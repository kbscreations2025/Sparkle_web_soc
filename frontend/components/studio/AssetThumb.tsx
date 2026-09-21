"use client";

import { Play } from "lucide-react";
import type { HistoryOutput } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * One result as a grid tile, whatever kind of result it is.
 *
 * An image tile is its thumbnail. A video tile is its poster frame — and
 * where there isn't one, the clip itself with `preload="metadata"`, which
 * paints the first frame without fetching the whole file. What it must
 * never be is an `<img>` pointed at an mp4: that renders as a broken image,
 * which is exactly what falling back to `url` would produce.
 */
export function AssetThumb({ output, alt = "", className }: { output: HistoryOutput; alt?: string; className?: string }) {
  const tile = cn("h-full w-full object-cover", className);

  if (output.type !== "video") {
    // eslint-disable-next-line @next/next/no-img-element -- small grid tile, lazy-loaded natively; next/image adds no value at this size
    return <img src={output.thumbnailUrl ?? output.url} alt={alt} loading="lazy" decoding="async" className={tile} />;
  }

  return (
    <span className="relative block h-full w-full">
      {output.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- poster frame; same reasoning as above
        <img src={output.thumbnailUrl} alt={alt} loading="lazy" decoding="async" className={tile} />
      ) : (
        <video src={output.url} preload="metadata" muted playsInline className={tile} />
      )}
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white/90 backdrop-blur-sm">
          <Play size={12} className="translate-x-px" fill="currentColor" />
        </span>
      </span>
    </span>
  );
}
