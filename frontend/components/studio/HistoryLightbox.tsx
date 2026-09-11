"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Loader2, MessageCircle, Trash2, X, ZoomIn, ZoomOut } from "lucide-react";
import type { HistoryItem } from "@/lib/api";
import { downloadImage } from "@/lib/image";

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const STEP = 1.25;
/** One wheel notch. Multiplicative, so a notch feels the same at 100% and 400%. */
const WHEEL_STEP = 1.12;

const clampScale = (value: number) => Math.min(Math.max(value, MIN_SCALE), MAX_SCALE);

/**
 * The detail view for one History tile: every output image of that
 * generation as a thumbnail strip, plus the run's metadata (tool, model,
 * quality, when, who). Distinct from the plain `Lightbox` used mid-tool —
 * that one shows a single in-progress result, this one is a read-only look
 * back at a finished run.
 */
export function HistoryLightbox({
  item,
  toolLabel,
  modelLabel,
  canContinue,
  deleting,
  onClose,
  onDelete,
  onContinue,
}: {
  item: HistoryItem | null;
  toolLabel: string;
  /** The Sparkle-labelled model name, resolved by the caller — falls back to whatever the server sent. */
  modelLabel?: string | null;
  /** Whether this generation is the viewer's own, in a tool that can resume a thread. */
  canContinue?: boolean;
  deleting?: boolean;
  onClose: () => void;
  onDelete: (item: HistoryItem) => void;
  onContinue?: () => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [scale, setScale] = useState(1);
  // Pan, in screen pixels, of the image's centre away from the viewport centre.
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  // Each generation opens on its first image, at 100%. Reset during render
  // (React's documented pattern for "state that depends on a changed prop")
  // rather than an effect, so switching items never paints the old
  // index/scale for a frame before an effect catches up.
  const [openItemId, setOpenItemId] = useState(item?.id);
  if (item?.id !== openItemId) {
    setOpenItemId(item?.id);
    setActiveIndex(0);
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }

  useEffect(() => {
    if (!item) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [item, onClose]);

  // Registered by hand because React's onWheel is passive — it cannot
  // preventDefault, so the page (or the browser's own zoom) would scroll too.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !item) return;
    function onWheel(event: WheelEvent) {
      event.preventDefault();
      setScale((s) => {
        const next = clampScale(event.deltaY < 0 ? s * WHEEL_STEP : s / WHEEL_STEP);
        if (next === 1) setOffset({ x: 0, y: 0 });
        return next;
      });
    }
    frame.addEventListener("wheel", onWheel, { passive: false });
    return () => frame.removeEventListener("wheel", onWheel);
  }, [item]);

  if (!item) return null;

  const active = item.outputs[activeIndex];
  const timeLabel = timeAgo(item.createdAt);

  /**
   * One at a time, in order. Firing them together would open as many parallel
   * proxy streams of several megabytes each, and browsers throttle or drop
   * simultaneous downloads from one gesture anyway. `downloadImage` reports
   * failure by returning false rather than throwing, so one bad image can't
   * abandon the rest of the set.
   */
  async function downloadAll() {
    for (const [i, output] of item!.outputs.entries()) {
      await downloadImage(output.url, `${item!.tool}-${item!.id}-${i + 1}.jpg`);
    }
  }

  return (
    <div
      ref={frameRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3 backdrop-blur-xl md:p-6 lg:p-8"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="relative flex max-h-[90vh] max-w-[94vw] flex-col items-center"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-2 flex w-full flex-wrap items-center justify-between gap-2 md:mb-3 md:gap-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold md:px-2.5 md:py-1 md:text-[11px]">
              {toolLabel}
            </span>
            {(modelLabel || item.quality) && (
              <span className="flex-shrink-0 rounded-full border border-white/[0.10] bg-white/[0.05] px-2 py-0.5 text-[10px] font-medium text-faint md:px-2.5 md:py-1 md:text-[11px]">
                {[modelLabel, item.quality].filter(Boolean).join(" · ")}
              </span>
            )}
          </div>
          <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2 md:gap-3">
            <p className="whitespace-nowrap text-[10px] text-faint md:text-[11px]">
              {timeLabel} · by {item.userName}
              {item.outputs.length > 1 ? ` · ${activeIndex + 1}/${item.outputs.length}` : ""}
            </p>
            <div className="flex items-center gap-0.5 rounded-full border border-white/15 bg-white/[0.04] p-1 md:gap-1">
              {canContinue && (
                <button
                  type="button"
                  onClick={onContinue}
                  title="Continue this conversation"
                  className="flex h-7 items-center gap-1 rounded-full px-2 text-[10px] font-medium text-white/85 transition-colors hover:bg-white/[0.10] md:h-8"
                >
                  <MessageCircle size={13} /> 
                </button>
              )}
              {item.outputs.length > 1 && (
                <button
                  type="button"
                  onClick={downloadAll}
                  title="Download all"
                  className="flex h-7 items-center gap-1 rounded-full px-2 text-[10px] font-medium text-white/85 transition-colors hover:bg-white/[0.10] md:h-8"
                >
                  <Download size={13} /> All
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  active &&
                  downloadImage(active.url, `${item.tool}-${item.id}-${activeIndex + 1}.jpg`)
                }
                title="Download"
                className="flex h-7 w-7 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/[0.10] md:h-8 md:w-8"
              >
                <Download size={14} />
              </button>
              <button
                type="button"
                onClick={() => onDelete(item)}
                disabled={deleting}
                title="Delete"
                className="flex h-7 w-7 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/[0.10] disabled:cursor-not-allowed disabled:opacity-40 md:h-8 md:w-8"
              >
                {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              </button>
              <button
                type="button"
                onClick={onClose}
                title="Close"
                className="flex h-7 w-7 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/[0.10] md:h-8 md:w-8"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 items-stretch gap-3">
          {item.outputs.length > 1 && (
            <div className="flex flex-col gap-2 overflow-y-auto">
              {item.outputs.map((output, i) => (
                <button
                  key={output.assetId}
                  type="button"
                  onClick={() => {
                    setActiveIndex(i);
                    setScale(1);
                    setOffset({ x: 0, y: 0 });
                  }}
                  className={`h-16 w-16 shrink-0 overflow-hidden rounded-md border-2 transition-colors ${
                    i === activeIndex ? "border-gold" : "border-transparent hover:border-white/30"
                  }`}
                >
                  {/* The small copy — this strip is 64px tiles, and the pane
                      beside it is already loading the full-size original. */}
                  {/* eslint-disable-next-line @next/next/no-img-element -- fixed small thumbnail, next/image adds no value here */}
                  <img src={output.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}

          <div
            className="flex min-h-0 flex-1 items-center justify-center overflow-hidden"
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
              dragRef.current = null;
            }}
          >
            {active && (
              // eslint-disable-next-line @next/next/no-img-element -- transform-scaled, so next/image's fill sizing doesn't apply
              <img
                src={active.url}
                alt="Generated result"
                draggable={false}
                className="max-h-[70vh] max-w-[80vw] select-none rounded object-contain md:max-h-[76vh]"
                style={{
                  transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                  transition: dragRef.current ? "none" : "transform 120ms ease",
                  cursor: scale > 1 ? (dragRef.current ? "grabbing" : "grab") : "default",
                }}
                onDoubleClick={() => {
                  setScale((s) => (s > 1 ? 1 : 2));
                  setOffset({ x: 0, y: 0 });
                }}
              />
            )}
          </div>
        </div>

        <div className="mt-3 flex items-center gap-1 rounded-full border border-white/15 bg-black/60 px-1.5 py-1 backdrop-blur-sm">
          <button
            type="button"
            onClick={() => setScale((s) => Math.max(MIN_SCALE, s / STEP))}
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
            title="Reset to 100%"
            className="w-11 select-none rounded-full text-center text-[10px] font-medium tabular-nums text-white/70 transition-colors hover:bg-white/15 hover:text-white"
          >
            {Math.round(scale * 100)}%
          </button>
          <button
            type="button"
            onClick={() => setScale((s) => Math.min(MAX_SCALE, s * STEP))}
            disabled={scale >= MAX_SCALE}
            title="Zoom in"
            className="flex h-7 w-7 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ZoomIn size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Coarse "N units ago" — history doesn't need second-level precision. */
function timeAgo(iso: string) {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  const units: [string, number][] = [
    ["year", 31536000],
    ["month", 2592000],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [label, size] of units) {
    const value = Math.floor(seconds / size);
    if (value >= 1) return `${value} ${label}${value > 1 ? "s" : ""} ago`;
  }
  return "just now";
}
