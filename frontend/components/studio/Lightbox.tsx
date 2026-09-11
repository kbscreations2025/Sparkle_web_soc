"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Pencil, X, ZoomIn, ZoomOut } from "lucide-react";
import { downloadImage } from "@/lib/image";

const MIN_SCALE = 0.25;
const MAX_SCALE = 8;
/** One wheel notch. Multiplicative, so a notch feels the same at 50% and 400%. */
const WHEEL_STEP = 1.12;
const BUTTON_STEP = 1.25;

const clampScale = (value: number) => Math.min(Math.max(value, MIN_SCALE), MAX_SCALE);

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
  const [scale, setScale] = useState(1);
  // Pan, in screen pixels, of the image's centre away from the viewport centre.
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  // Each image opens at 100%, centred, rather than inheriting the last one's view.
  useEffect(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, [src]);

  /**
   * Zooms about a point on screen: whatever pixel of the photo sits under the
   * cursor stays under the cursor, which is what makes wheel zoom feel like
   * magnifying rather than jumping.
   */
  const zoomAt = useCallback((factor: number, clientX?: number, clientY?: number) => {
    const frame = frameRef.current;
    if (!frame) return;
    const box = frame.getBoundingClientRect();
    const anchorX = clientX ?? box.left + box.width / 2;
    const anchorY = clientY ?? box.top + box.height / 2;

    setScale((current) => {
      const next = clampScale(current * factor);
      const ratio = next / current;
      setOffset((pan) => {
        // Distance from the frame centre to the anchor, scaled about that anchor.
        const dx = anchorX - (box.left + box.width / 2);
        const dy = anchorY - (box.top + box.height / 2);
        return next === 1
          ? { x: 0, y: 0 } // snapping back to 100% re-centres
          : { x: dx + (pan.x - dx) * ratio, y: dy + (pan.y - dy) * ratio };
      });
      return next;
    });
  }, []);

  // Registered by hand because React's onWheel is passive — it cannot
  // preventDefault, so the page (or the browser's own zoom) would scroll too.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !src) return;
    function onWheel(event: WheelEvent) {
      event.preventDefault();
      zoomAt(event.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP, event.clientX, event.clientY);
    }
    frame.addEventListener("wheel", onWheel, { passive: false });
    return () => frame.removeEventListener("wheel", onWheel);
  }, [src, zoomAt]);

  useEffect(() => {
    if (!src) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [src, onClose]);

  if (!src) return null;

  return (
    <div
      ref={frameRef}
      className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-black/85 p-6"
      onClick={() => !dragRef.current && onClose()}
      role="presentation"
      onDoubleClick={() => {
        setScale(1);
        setOffset({ x: 0, y: 0 });
      }}
      onPointerDown={(event) => {
        if (scale <= 1 || event.button !== 0) return;
        dragRef.current = { x: event.clientX - offset.x, y: event.clientY - offset.y };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const start = dragRef.current;
        if (!start) return;
        setOffset({ x: event.clientX - start.x, y: event.clientY - start.y });
      }}
      onPointerUp={() => {
        // Cleared next tick so the click that ends a drag doesn't close the preview.
        setTimeout(() => (dragRef.current = null), 0);
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- transform-scaled, so next/image's fill sizing doesn't apply */}
      <img
        src={src}
        alt="Preview"
        draggable={false}
        className="block max-h-[86vh] max-w-[86vw] select-none"
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          cursor: scale > 1 ? (dragRef.current ? "grabbing" : "grab") : "default",
        }}
        onClick={(event) => event.stopPropagation()}
      />

      <div
        className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/15 bg-black/60 px-1.5 py-1 backdrop-blur-sm"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => zoomAt(1 / BUTTON_STEP)}
          disabled={scale <= MIN_SCALE}
          title="Zoom out"
          className="flex h-7 w-7 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ZoomOut size={14} />
        </button>
        <button
          type="button"
          onClick={() => {
            setScale(1);
            setOffset({ x: 0, y: 0 });
          }}
          title="Reset to 100% (or double-click the image)"
          className="w-11 select-none rounded-full text-center text-[10px] font-medium tabular-nums text-white/70 transition-colors hover:bg-white/15 hover:text-white"
        >
          {Math.round(scale * 100)}%
        </button>
        <button
          type="button"
          onClick={() => zoomAt(BUTTON_STEP)}
          disabled={scale >= MAX_SCALE}
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
