"use client";

import { Download, Pencil, X, ZoomIn, ZoomOut } from "lucide-react";
import { downloadImage } from "@/lib/image";
import { useEscapeKey } from "@/lib/useEscapeKey";
import { useImageZoom } from "@/lib/useImageZoom";

/** Full-screen "just look at it" preview. Closes on backdrop click or Escape. */
export function Lightbox({
  src,
  onClose,
  downloadName,
  onAnnotate,
}: {
  src: string | null;
  onClose: () => void;
  /** Filename offered when downloading `src`. Omit to hide the download button. */
  downloadName?: string;
  /** Omit to hide the annotate button — e.g. a plain expand with nothing to mark up. */
  onAnnotate?: () => void;
}) {
  // Wider range than the History viewer: this one is for inspecting a single
  // result closely, so it zooms out below the fitted size and much further in.
  const zoom = useImageZoom({ min: 0.25, max: 8, resetKey: src });
  const { scale, dragRef, frameRef } = zoom;

  useEscapeKey(onClose, Boolean(src));

  if (!src) return null;

  return (
    <div
      ref={frameRef}
      className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-black/85 p-6"
      onClick={() => !dragRef.current && onClose()}
      role="presentation"
      onDoubleClick={zoom.reset}
      {...zoom.panHandlers}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- transform-scaled, so next/image's fill sizing doesn't apply */}
      <img
        src={src}
        alt="Preview"
        draggable={false}
        className="block max-h-[86vh] max-w-[86vw] select-none"
        style={zoom.imageStyle}
        onClick={(event) => event.stopPropagation()}
      />

      <div
        className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/15 bg-black/60 px-1.5 py-1 backdrop-blur-sm"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={zoom.zoomOut}
          disabled={zoom.atMin}
          title="Zoom out"
          className="flex h-7 w-7 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ZoomOut size={14} />
        </button>
        <button
          type="button"
          onClick={zoom.reset}
          title="Reset to 100% (or double-click the image)"
          className="w-11 select-none rounded-full text-center text-[10px] font-medium tabular-nums text-white/70 transition-colors hover:bg-white/15 hover:text-white"
        >
          {Math.round(scale * 100)}%
        </button>
        <button
          type="button"
          onClick={zoom.zoomIn}
          disabled={zoom.atMax}
          title="Zoom in"
          className="flex h-7 w-7 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ZoomIn size={14} />
        </button>
      </div>

      <div className="absolute right-4 top-4 flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
        {onAnnotate && (
          <button
            type="button"
            onClick={onAnnotate}
            title="Annotate — draw, add shapes or text to point out changes"
            className="flex h-9 items-center gap-1.5 rounded-lg border border-white/15 bg-black/50 px-3 text-xs font-medium text-white/90 transition-colors hover:bg-black/70 hover:text-white"
          >
            <Pencil size={14} /> Annotate
          </button>
        )}
        {downloadName && (
          <button
            type="button"
            onClick={() => downloadImage(src, downloadName)}
            title="Download"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 bg-black/50 text-white/90 transition-colors hover:bg-black/70 hover:text-white"
          >
            <Download size={16} />
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          title="Close"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 bg-black/50 text-white/90 transition-colors hover:bg-black/70 hover:text-white"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
