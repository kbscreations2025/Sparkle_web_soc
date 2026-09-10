"use client";

import Image from "next/image";
import { Download, Loader2, Maximize2, Pencil } from "lucide-react";

/**
 * The large preview every results screen shares — whatever a tool is showing
 * off, this is where it goes: the latest image, a "Generating…" spinner while
 * a run or a refinement is in flight, or an empty prompt before anything
 * exists yet.
 */
export function GenerationStage({
  src,
  alt = "Result",
  busy,
  busyLabel = "Generating…",
  emptyLabel = "Nothing generated yet",
  downloadName,
  onExpand,
  onAnnotate,
}: {
  src: string | null;
  alt?: string;
  busy?: boolean;
  busyLabel?: string;
  emptyLabel?: string;
  /** Filename offered when downloading `src`. Omit to hide the download button. */
  downloadName?: string;
  /** Omit to hide the expand button — usually opens the image in a lightbox. */
  onExpand?: (src: string) => void;
  /** Omit to hide the annotate button. */
  onAnnotate?: (src: string) => void;
}) {
  return (
    <div className="relative flex h-full min-h-[320px] items-center justify-center overflow-hidden">
      {src && (
        <Image
          src={src}
          alt={alt}
          fill
          sizes="(max-width: 1024px) 100vw, 65vw"
          // Dims rather than disappears while a refinement runs, so the
          // previous result stays visible as a reference for what's changing.
          className={busy ? "object-contain opacity-40 blur-[1px]" : "object-contain"}
        />
      )}

      {busy && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/10">
          <Loader2 size={28} className="animate-spin text-gold" />
          <p className="text-[12px] text-cream">{busyLabel}</p>
        </div>
      )}

      {!src && !busy && <p className="px-6 text-center text-[12px] text-faint">{emptyLabel}</p>}

      {src && !busy && (
        <div className="absolute right-3 top-3 flex items-center gap-2">
          {onAnnotate && (
            <button
              type="button"
              onClick={() => onAnnotate(src)}
              title="Annotate — draw, add shapes or text to point out changes"
              className="flex h-8 items-center gap-1 rounded-full bg-black/55 px-2.5 text-[11px] font-medium text-white backdrop-blur-sm transition-colors hover:bg-black/75"
            >
              <Pencil size={12} /> Annotate
            </button>
          )}
          {onExpand && (
            <button
              type="button"
              onClick={() => onExpand(src)}
              title="Expand"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/75"
            >
              <Maximize2 size={13} />
            </button>
          )}
          {downloadName && (
            <a
              href={src}
              download={downloadName}
              title="Download"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/75"
            >
              <Download size={13} />
            </a>
          )}
        </div>
      )}
    </div>
  );
}
