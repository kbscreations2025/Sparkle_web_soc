"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Loader2, X } from "lucide-react";
import { thumbOf } from "@/lib/lookbook/media";
import type { Media } from "@/lib/lookbook/types";

export type ZoomItem = { media: Media; caption?: string };

const MAX_SCALE = 6;
const DOUBLE_TAP_MS = 280;
const DOUBLE_TAP_SCALE = 2.5;

type Point = { x: number; y: number };

/**
 * Full screen, full resolution: the original file, never a resized copy.
 *
 * Built for a phone first. Pinch to zoom, double-tap to zoom in on a spot,
 * drag to pan while zoomed, swipe sideways for the next photo and swipe down
 * to close. On a computer: the wheel zooms, arrow keys move, Escape closes.
 * The small copy shows at once, blurred, while the original downloads,
 * since originals can run to many megabytes on a slow connection.
 */
export function ZoomLightbox({ items, index: startIndex, onClose }: { items: ZoomItem[]; index: number; onClose: () => void }) {
  const [index, setIndex] = useState(Math.min(Math.max(0, startIndex), items.length - 1));
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  /** A swipe in progress at 1x: sideways to move on, down to close. */
  const [swipe, setSwipe] = useState<Point>({ x: 0, y: 0 });
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [animating, setAnimating] = useState(false);

  const stage = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{
    kind: "pan" | "pinch" | "swipe" | null;
    start: Point;
    startOffset: Point;
    startScale: number;
    startDistance: number;
    startMid: Point;
    moved: boolean;
  }>({ kind: null, start: { x: 0, y: 0 }, startOffset: { x: 0, y: 0 }, startScale: 1, startDistance: 1, startMid: { x: 0, y: 0 }, moved: false });
  const lastTap = useRef<{ at: number; point: Point } | null>(null);

  const item = items[index];
  const media = item?.media;
  const loaded = loadedUrl === media?.url;

  const reset = useCallback(() => {
    setAnimating(true);
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  const go = useCallback(
    (direction: 1 | -1) => {
      setIndex((current) => {
        const next = current + direction;
        return next < 0 || next >= items.length ? current : next;
      });
      setScale(1);
      setOffset({ x: 0, y: 0 });
      setSwipe({ x: 0, y: 0 });
    },
    [items.length]
  );

  // The page under the viewer stays put, and keys drive the viewer.
  useEffect(() => {
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowRight") go(1);
      else if (event.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [go, onClose]);

  /** The stage's centre, which `offset` is measured from. */
  const centre = useCallback((): Point => {
    const rect = stage.current?.getBoundingClientRect();
    return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: 0, y: 0 };
  }, []);

  /** Keeps a zoomed picture from being dragged off the screen. */
  const clampOffset = useCallback((next: Point, nextScale: number): Point => {
    const img = image.current;
    const rect = stage.current?.getBoundingClientRect();
    if (!img || !rect) return next;
    const overflowX = Math.max(0, (img.offsetWidth * nextScale - rect.width) / 2);
    const overflowY = Math.max(0, (img.offsetHeight * nextScale - rect.height) / 2);
    return { x: Math.min(overflowX, Math.max(-overflowX, next.x)), y: Math.min(overflowY, Math.max(-overflowY, next.y)) };
  }, []);

  /** Zooms to `nextScale` keeping the point under `anchor` (client coordinates) where it is. */
  const zoomAt = useCallback(
    (nextScale: number, anchor: Point, from: { scale: number; offset: Point }) => {
      const bounded = Math.min(MAX_SCALE, Math.max(1, nextScale));
      const c = centre();
      const p = { x: anchor.x - c.x, y: anchor.y - c.y };
      const ratio = bounded / from.scale;
      const next = bounded === 1 ? { x: 0, y: 0 } : { x: p.x - (p.x - from.offset.x) * ratio, y: p.y - (p.y - from.offset.y) * ratio };
      setScale(bounded);
      setOffset(clampOffset(next, bounded));
    },
    [centre, clampOffset]
  );

  // The wheel, registered by hand: React's onWheel is passive and can't stop the page zooming too.
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setAnimating(false);
      zoomAt(scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15), { x: event.clientX, y: event.clientY }, { scale, offset });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [scale, offset, zoomAt]);

  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const midpoint = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as Element).closest("button")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    setAnimating(false);
    const points = [...pointers.current.values()];
    if (points.length === 2) {
      gesture.current = {
        kind: "pinch",
        start: points[0],
        startOffset: offset,
        startScale: scale,
        startDistance: Math.max(1, distance(points[0], points[1])),
        startMid: midpoint(points[0], points[1]),
        moved: true,
      };
    } else if (points.length === 1) {
      gesture.current = {
        kind: scale > 1 ? "pan" : "swipe",
        start: points[0],
        startOffset: offset,
        startScale: scale,
        startDistance: 1,
        startMid: points[0],
        moved: false,
      };
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const g = gesture.current;
    const points = [...pointers.current.values()];
    if (g.kind === "pinch" && points.length >= 2) {
      const ratio = distance(points[0], points[1]) / g.startDistance;
      const mid = midpoint(points[0], points[1]);
      zoomAt(g.startScale * ratio, g.startMid, { scale: g.startScale, offset: { x: g.startOffset.x + (mid.x - g.startMid.x), y: g.startOffset.y + (mid.y - g.startMid.y) } });
      return;
    }
    const dx = event.clientX - g.start.x;
    const dy = event.clientY - g.start.y;
    if (Math.hypot(dx, dy) > 6) g.moved = true;
    if (g.kind === "pan") setOffset(clampOffset({ x: g.startOffset.x + dx, y: g.startOffset.y + dy }, scale));
    else if (g.kind === "swipe") setSwipe(Math.abs(dx) > Math.abs(dy) ? { x: dx, y: 0 } : { x: 0, y: Math.max(0, dy) });
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    const g = gesture.current;
    if (pointers.current.size > 0) {
      // One finger lifted from a pinch: carry on panning with the other.
      const [rest] = [...pointers.current.values()];
      gesture.current = { ...g, kind: scale > 1 ? "pan" : "swipe", start: rest, startOffset: offset, moved: true };
      return;
    }
    setAnimating(true);

    if (g.kind === "swipe") {
      if (swipe.x < -60) go(1);
      else if (swipe.x > 60) go(-1);
      else if (swipe.y > 110) onClose();
      setSwipe({ x: 0, y: 0 });
    }

    if (!g.moved) {
      const point = { x: event.clientX, y: event.clientY };
      const previous = lastTap.current;
      if (previous && Date.now() - previous.at < DOUBLE_TAP_MS && distance(previous.point, point) < 30) {
        lastTap.current = null;
        if (scale > 1) reset();
        else zoomAt(DOUBLE_TAP_SCALE, point, { scale, offset });
      } else {
        lastTap.current = { at: Date.now(), point };
        // A single tap on the dark around the picture closes, once it's clear it wasn't a double tap.
        const onBackdrop = event.target === stage.current;
        if (onBackdrop && scale === 1) {
          const at = lastTap.current.at;
          window.setTimeout(() => {
            if (lastTap.current?.at === at) onClose();
          }, DOUBLE_TAP_MS);
        }
      }
    }
    gesture.current = { ...g, kind: null };
  }

  if (!media || typeof document === "undefined") return null;

  // With the picture's shape known, its box is laid out before a byte arrives: as large as fits.
  const ratio = media.width && media.height ? media.width / media.height : null;
  const box = ratio ? { width: `min(100vw, calc((100dvh - 140px) * ${ratio}))`, aspectRatio: String(ratio) } : null;
  const transform = `translate3d(${offset.x + swipe.x}px, ${offset.y + swipe.y}px, 0) scale(${scale})`;
  const fade = swipe.y > 0 ? Math.max(0.35, 1 - swipe.y / 400) : 1;

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex flex-col text-white"
      style={{ background: `rgba(6, 6, 6, ${0.96 * fade})`, fontFamily: "var(--font-inter), system-ui, sans-serif" }}
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
    >
      <div className="flex items-center justify-between px-4 pb-2" style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}>
        <span className="text-[13px] tabular-nums text-white/70">{items.length > 1 ? `${index + 1} / ${items.length}` : ""}</span>
        <div className="flex items-center gap-3">
          {!loaded && (
            <span className="flex items-center gap-1.5 text-[12px] text-white/60">
              <Loader2 size={13} className="animate-spin" /> Full resolution
            </span>
          )}
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-white/20">
            <X size={20} />
          </button>
        </div>
      </div>

      <div
        ref={stage}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
        style={{ touchAction: "none", cursor: scale > 1 ? "grab" : "zoom-in" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          className="relative flex max-h-full max-w-full items-center justify-center"
          style={{ transform, transition: animating ? "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)" : "none", willChange: "transform" }}
        >
          <div className="relative" style={box ?? undefined}>
            {/* The small copy first, so there's something to look at while the original arrives. */}
            {!loaded && box && (
              // eslint-disable-next-line @next/next/no-img-element -- placeholder for the original below
              <img src={thumbOf(media)} alt="" aria-hidden draggable={false} className="absolute inset-0 h-full w-full object-contain blur-[2px]" />
            )}
            {/* eslint-disable-next-line @next/next/no-img-element -- the untouched original, at full resolution */}
            <img
              ref={image}
              key={media.url}
              src={media.url}
              alt={media.alt || item.caption || ""}
              draggable={false}
              onLoad={() => setLoadedUrl(media.url)}
              className={
                box
                  ? "absolute inset-0 h-full w-full select-none object-contain transition-opacity duration-300"
                  : "block h-auto max-h-[calc(100dvh-140px)] w-auto max-w-[100vw] select-none object-contain transition-opacity duration-300"
              }
              style={{ opacity: loaded ? 1 : 0 }}
            />
          </div>
        </div>

        {items.length > 1 && (
          <>
            <button
              type="button"
              aria-label="Previous photo"
              disabled={index === 0}
              onClick={() => go(-1)}
              className="absolute left-3 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-white/20 disabled:opacity-0 md:flex"
            >
              <ChevronLeft size={22} />
            </button>
            <button
              type="button"
              aria-label="Next photo"
              disabled={index === items.length - 1}
              onClick={() => go(1)}
              className="absolute right-3 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-white/20 disabled:opacity-0 md:flex"
            >
              <ChevronRight size={22} />
            </button>
          </>
        )}
      </div>

      <div className="min-h-[52px] px-5 pt-2 text-center" style={{ paddingBottom: "max(14px, env(safe-area-inset-bottom))" }}>
        {item.caption ? <p className="text-[14px] text-white/85">{item.caption}</p> : <p className="text-[12px] text-white/40">Pinch or double-tap to zoom</p>}
      </div>
    </div>,
    document.body
  );
}
