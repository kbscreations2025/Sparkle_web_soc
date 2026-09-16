"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Zoom and pan for a full-screen image viewer.
 *
 * Both lightboxes in this app grew their own copy of this — same wheel
 * handling, same drag-to-pan, same clamping — which is how the identical
 * "ref read during render" bug ended up in both of them. It lives here now so
 * a fix lands once.
 *
 * Zoom is always about a point: whatever pixel sits under the cursor stays
 * under the cursor, which is what makes wheel zoom feel like magnifying rather
 * than jumping. Buttons pass no anchor and so zoom about the centre.
 */

export type ZoomOptions = {
  /** Smallest scale. 1 keeps the image from shrinking below its natural fit. */
  min?: number;
  max?: number;
  /** One wheel notch. Multiplicative, so a notch feels the same at 50% and 400%. */
  wheelStep?: number;
  /** One button press. */
  buttonStep?: number;
  /** Changing this resets the view — pass the image being shown. */
  resetKey?: unknown;
};

export function useImageZoom({
  min = 1,
  max = 4,
  wheelStep = 1.12,
  buttonStep = 1.25,
  resetKey,
}: ZoomOptions = {}) {
  const [scale, setScale] = useState(1);
  /** Pan, in screen pixels, of the image's centre away from the frame's centre. */
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  /** Put this on the element the wheel and pointer events are measured against. */
  const frameRef = useRef<HTMLDivElement>(null);
  // The ref carries the grab point (needed synchronously while dragging); the
  // flag is what the render reads, since a ref's value is invisible to it.
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  const clamp = useCallback((value: number) => Math.min(Math.max(value, min), max), [min, max]);

  const reset = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  // Each image opens at 100%, centred, rather than inheriting the last one's
  // view. Adjusted during render rather than in an effect, so the new image
  // never paints once at the previous one's zoom before snapping back.
  const [viewedKey, setViewedKey] = useState(resetKey);
  if (resetKey !== viewedKey) {
    setViewedKey(resetKey);
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }

  const zoomBy = useCallback(
    (factor: number, clientX?: number, clientY?: number) => {
      const frame = frameRef.current;
      if (!frame) return;
      const box = frame.getBoundingClientRect();
      const anchorX = clientX ?? box.left + box.width / 2;
      const anchorY = clientY ?? box.top + box.height / 2;

      setScale((current) => {
        const next = clamp(current * factor);
        const ratio = next / current;
        setOffset((pan) => {
          // Distance from the frame centre to the anchor, scaled about it.
          const dx = anchorX - (box.left + box.width / 2);
          const dy = anchorY - (box.top + box.height / 2);
          return next === 1
            ? { x: 0, y: 0 } // snapping back to 100% re-centres
            : { x: dx + (pan.x - dx) * ratio, y: dy + (pan.y - dy) * ratio };
        });
        return next;
      });
    },
    [clamp]
  );

  const zoomIn = useCallback(() => zoomBy(buttonStep), [zoomBy, buttonStep]);
  const zoomOut = useCallback(() => zoomBy(1 / buttonStep), [zoomBy, buttonStep]);

  // Registered by hand because React's onWheel is passive — it cannot
  // preventDefault, so the page (or the browser's own zoom) would scroll too.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    function onWheel(event: WheelEvent) {
      event.preventDefault();
      zoomBy(event.deltaY < 0 ? wheelStep : 1 / wheelStep, event.clientX, event.clientY);
    }
    frame.addEventListener("wheel", onWheel, { passive: false });
    return () => frame.removeEventListener("wheel", onWheel);
  }, [zoomBy, wheelStep, resetKey]);

  /**
   * Spread onto the element that should be draggable. Panning only starts once
   * zoomed in, so a click on an un-zoomed image still reaches whatever is
   * beneath it (the backdrop that closes the viewer).
   */
  const panHandlers = {
    onPointerDown: (event: React.PointerEvent) => {
      if (scale <= 1 || event.button !== 0) return;
      dragRef.current = { x: event.clientX - offset.x, y: event.clientY - offset.y };
      setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: React.PointerEvent) => {
      const start = dragRef.current;
      if (!start) return;
      setOffset({ x: event.clientX - start.x, y: event.clientY - start.y });
    },
    onPointerUp: () => {
      // Cleared next tick so the click that ends a drag doesn't also register
      // on whatever sits underneath.
      setTimeout(() => (dragRef.current = null), 0);
      setDragging(false);
    },
  };

  return {
    scale,
    offset,
    dragging,
    frameRef,
    dragRef,
    zoomBy,
    zoomIn,
    zoomOut,
    reset,
    panHandlers,
    atMin: scale <= min,
    atMax: scale >= max,
    /** `transform` and `cursor` for the image itself. */
    imageStyle: {
      transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
      cursor: scale > 1 ? (dragging ? "grabbing" : "grab") : "default",
    } as const,
  };
}
