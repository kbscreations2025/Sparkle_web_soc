"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  ArrowUpRight,
  Check,
  Circle,
  Eraser,
  Minus,
  Pencil,
  Redo2,
  Square,
  Trash2,
  Type,
  Undo2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Tool = "pen" | "eraser" | "rect" | "circle" | "line" | "arrow" | "text";

const TOOLS: { id: Tool; label: string; icon: typeof Pencil }[] = [
  { id: "pen", label: "Pen", icon: Pencil },
  { id: "eraser", label: "Eraser", icon: Eraser },
  { id: "rect", label: "Rectangle", icon: Square },
  { id: "circle", label: "Circle", icon: Circle },
  { id: "line", label: "Line", icon: Minus },
  { id: "arrow", label: "Arrow", icon: ArrowUpRight },
  { id: "text", label: "Text", icon: Type },
];

/** Enough headroom to undo a session's worth of marks without hoarding bitmaps. */
const HISTORY_LIMIT = 30;

const MIN_WIDTH = 2;
const MAX_WIDTH = 48;
/**
 * Curve of the size slider. Fine work needs single-pixel control, so most of
 * the travel stays in the thin range (~12px at two thirds along) and the last
 * stretch ramps up to the marker-thick end.
 */
const WIDTH_CURVE = 3.5;

function sliderToWidth(position: number) {
  const eased = Math.pow(position / 100, WIDTH_CURVE);
  return Math.round(MIN_WIDTH + (MAX_WIDTH - MIN_WIDTH) * eased);
}

function widthToSlider(width: number) {
  const ratio = (width - MIN_WIDTH) / (MAX_WIDTH - MIN_WIDTH);
  return Math.round(Math.pow(Math.max(ratio, 0), 1 / WIDTH_CURVE) * 100);
}

/**
 * Draw over a result to point out what should change, then attach the marked
 * up copy to the next message.
 *
 * Marks live on their own transparent canvas at the image's native
 * resolution, so the annotation is as sharp as the photo and the original
 * pixels are never touched until `onAttach` flattens the two together.
 */
export function AnnotationOverlay({
  src,
  onAttach,
  onClose,
  fullscreen,
}: {
  src: string;
  /** The image with its annotations burned in, as a data URI. */
  onAttach: (dataUrl: string) => void;
  onClose: () => void;
  /** Covers the whole viewport like the Lightbox it replaces, instead of just the stage. */
  fullscreen?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState("#F43F5E");
  const [strokeWidth, setStrokeWidth] = useState(6);

  // Bitmap snapshots rather than a list of shapes: undo has to restore what
  // the eraser removed too, which a replayable shape list can't express.
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);

  // Where a shape drag began, plus the canvas as it looked then — every
  // pointermove repaints the preview from that snapshot.
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const dragBase = useRef<ImageData | null>(null);

  const [textAt, setTextAt] = useState<{ x: number; y: number } | null>(null);
  const [textValue, setTextValue] = useState("");

  useEffect(() => {
    const image = new window.Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      imageRef.current = image;
      setSize({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.src = src;
  }, [src]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function context() {
    return canvasRef.current?.getContext("2d") ?? null;
  }

  /** Call before mutating the canvas, so the change can be undone. */
  function pushHistory() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setUndoStack((current) => [...current, canvas.toDataURL()].slice(-HISTORY_LIMIT));
    setRedoStack([]);
  }

  function paint(dataUrl: string | null) {
    const canvas = canvasRef.current;
    const ctx = context();
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!dataUrl) return;
    const snapshot = new window.Image();
    snapshot.onload = () => ctx.drawImage(snapshot, 0, 0);
    snapshot.src = dataUrl;
  }

  function undo() {
    const canvas = canvasRef.current;
    if (!canvas || undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setRedoStack((current) => [...current, canvas.toDataURL()]);
    setUndoStack((current) => current.slice(0, -1));
    paint(previous);
  }

  function redo() {
    const canvas = canvasRef.current;
    if (!canvas || redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack((current) => [...current, canvas.toDataURL()]);
    setRedoStack((current) => current.slice(0, -1));
    paint(next);
  }

  function clearAll() {
    if (undoStack.length === 0 && !hasMarks()) return;
    pushHistory();
    paint(null);
  }

  function hasMarks() {
    const canvas = canvasRef.current;
    const ctx = context();
    if (!canvas || !ctx) return false;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return true;
    return false;
  }

  /** Client coordinates → canvas pixels, since the canvas is displayed scaled. */
  function toCanvas(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function applyStroke(ctx: CanvasRenderingContext2D) {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const ctx = context();
    if (!canvas || !ctx) return;

    const point = toCanvas(event);

    if (tool === "text") {
      setTextAt(point);
      setTextValue("");
      return;
    }

    canvas.setPointerCapture(event.pointerId);
    pushHistory();
    dragStart.current = point;
    dragBase.current = ctx.getImageData(0, 0, canvas.width, canvas.height);

    if (tool === "pen" || tool === "eraser") {
      applyStroke(ctx);
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      // A tap with no drag should still leave a dot.
      ctx.lineTo(point.x + 0.01, point.y);
      ctx.stroke();
    }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const ctx = context();
    const start = dragStart.current;
    if (!ctx || !start) return;

    const point = toCanvas(event);

    if (tool === "pen" || tool === "eraser") {
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
      return;
    }

    if (dragBase.current) ctx.putImageData(dragBase.current, 0, 0);
    applyStroke(ctx);
    drawShape(ctx, start, point);
  }

  function handlePointerUp() {
    const ctx = context();
    if (ctx) ctx.globalCompositeOperation = "source-over";
    dragStart.current = null;
    dragBase.current = null;
  }

  function drawShape(ctx: CanvasRenderingContext2D, from: { x: number; y: number }, to: { x: number; y: number }) {
    ctx.beginPath();

    if (tool === "rect") {
      ctx.rect(from.x, from.y, to.x - from.x, to.y - from.y);
      ctx.stroke();
      return;
    }

    if (tool === "circle") {
      ctx.ellipse(
        (from.x + to.x) / 2,
        (from.y + to.y) / 2,
        Math.abs(to.x - from.x) / 2,
        Math.abs(to.y - from.y) / 2,
        0,
        0,
        Math.PI * 2
      );
      ctx.stroke();
      return;
    }

    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();

    if (tool === "arrow") {
      const head = Math.max(strokeWidth * 3, 14);
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      ctx.beginPath();
      ctx.moveTo(to.x, to.y);
      ctx.lineTo(to.x - head * Math.cos(angle - Math.PI / 6), to.y - head * Math.sin(angle - Math.PI / 6));
      ctx.moveTo(to.x, to.y);
      ctx.lineTo(to.x - head * Math.cos(angle + Math.PI / 6), to.y - head * Math.sin(angle + Math.PI / 6));
      ctx.stroke();
    }
  }

  function commitText() {
    const ctx = context();
    if (!ctx || !textAt || !textValue.trim()) return setTextAt(null);

    pushHistory();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = color;
    ctx.font = `600 ${Math.max(strokeWidth * 4, 20)}px var(--font-sans, sans-serif)`;
    ctx.textBaseline = "top";
    ctx.fillText(textValue, textAt.x, textAt.y);
    setTextAt(null);
    setTextValue("");
  }

  /** Flattens the photo and the marks into one image for the next request. */
  function attach() {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image) return;

    const merged = document.createElement("canvas");
    merged.width = canvas.width;
    merged.height = canvas.height;
    const ctx = merged.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(image, 0, 0);
    ctx.drawImage(canvas, 0, 0);
    onAttach(merged.toDataURL("image/jpeg", 0.92));
  }

  return (
    // No backdrop: the marks go on the result where it already sits, rather
    // than reopening it in a modal the user has to dismiss.
    <div
      className={cn(
        "flex items-center justify-center",
        fullscreen ? "fixed inset-0 z-50 bg-black/85 p-6" : "absolute inset-0 z-20"
      )}
    >
      {size && (
        <div className="relative max-h-full max-w-full" style={{ aspectRatio: `${size.width} / ${size.height}` }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- the canvas must sit on an element whose box exactly matches the bitmap. */}
          <img src={src} alt="" className="pointer-events-none h-full w-full select-none object-fill" />

          <canvas
            ref={canvasRef}
            width={size.width}
            height={size.height}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
          />

          {textAt && (
            <input
              autoFocus
              value={textValue}
              onChange={(event) => setTextValue(event.target.value)}
              onBlur={commitText}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitText();
                if (event.key === "Escape") setTextAt(null);
              }}
              placeholder="Type, then Enter"
              style={{
                left: `${(textAt.x / size.width) * 100}%`,
                top: `${(textAt.y / size.height) * 100}%`,
              }}
              className="absolute w-40 rounded-md border border-white/25 bg-black/70 px-1.5 py-1 text-[12px] text-white outline-none"
            />
          )}
        </div>
      )}

      {/* Takes the top-right slot the stage's own controls vacate while drawing. */}
      <div className="absolute right-3 top-3 flex max-w-[92%] flex-wrap items-center justify-end gap-1.5 rounded-2xl border border-white/10 bg-black px-2 py-1.5">
        <div className="flex items-center gap-0.5">
          {TOOLS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              title={label}
              onClick={() => setTool(id)}
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors",
                tool === id ? "bg-gold/30 text-gold" : "text-white/80 hover:bg-white/15"
              )}
            >
              <Icon size={14} />
            </button>
          ))}
        </div>

        <span className="mx-0.5 h-5 w-px bg-white/15" />

        <label title="Colour" className="relative h-6 w-6 shrink-0 overflow-hidden rounded-full border border-white/25">
          <span className="block h-full w-full" style={{ background: color }} />
          <input
            type="color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>

        {/* One slider for both: the eraser needs a size as much as the pen does. */}
        <label className="flex items-center gap-1.5 px-1" title={tool === "eraser" ? "Eraser size" : "Stroke size"}>
          <span
            className="shrink-0 rounded-full bg-white"
            style={{ width: Math.min(strokeWidth, 14), height: Math.min(strokeWidth, 14) }}
          />
          <input
            type="range"
            min={0}
            max={100}
            value={widthToSlider(strokeWidth)}
            onChange={(event) => setStrokeWidth(sliderToWidth(Number(event.target.value)))}
            className="h-1 w-20 cursor-pointer accent-gold"
          />
        </label>

        <span className="mx-0.5 h-5 w-px bg-white/15" />

        <ToolbarAction label="Undo" onClick={undo} disabled={undoStack.length === 0}>
          <Undo2 size={14} />
        </ToolbarAction>
        <ToolbarAction label="Redo" onClick={redo} disabled={redoStack.length === 0}>
          <Redo2 size={14} />
        </ToolbarAction>
        <ToolbarAction label="Clear all" onClick={clearAll}>
          <Trash2 size={14} />
        </ToolbarAction>

        <span className="mx-0.5 h-5 w-px bg-white/15" />

        <button
          type="button"
          onClick={attach}
          className="flex h-7 items-center gap-1 rounded-full bg-gold/20 px-2.5 text-[11px] font-medium text-gold transition-colors hover:bg-gold/30"
        >
          <Check size={13} /> Attach
        </button>
        <ToolbarAction label="Close" onClick={onClose}>
          <X size={14} />
        </ToolbarAction>
      </div>
    </div>
  );
}

function ToolbarAction({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/15 disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
