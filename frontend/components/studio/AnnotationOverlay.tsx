"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {  draw as drawShape,  handlesFor,  hit,  isBox,  isTooSmall,  moved,  resized,  type Handle,  type HandleId,  type Shape} from "@/lib/annotationShapes";
import { DrawingToolbar, isShapeTool, type Tool } from "./DrawingToolbar";
import { urlToDataUrl } from "@/lib/image";
import { cn } from "@/lib/utils";

/** Handle square and grab radius, in CSS pixels — scaled to canvas pixels per canvas. */
const HANDLE_SCREEN_SIZE = 9;

/**
 * Longest edge of the drawing surface.
 *
 * A stored original can be 5000px or more on a side, which means two canvases
 * of ~17 megapixels each, a `getImageData` of that size on every pointer down,
 * and an exported JPEG far larger than anything downstream wants. Capping here
 * matches what the app already does to uploads — they are resized to 2048
 * before being sent — so the marked-up copy is no coarser than a photo the
 * user could have supplied in the first place.
 */
const MAX_SURFACE = 2048;

/** The size to draw at: the image's own, unless it is larger than the cap. */
function surfaceSize(width: number, height: number) {
  const longest = Math.max(width, height);
  if (longest <= MAX_SURFACE) return { width, height };

  const ratio = MAX_SURFACE / longest;
  return { width: Math.round(width * ratio), height: Math.round(height * ratio) };
}

/** A measured, canvas-safe image, tagged with the src it was resolved from. */
type Loaded = { src: string; source: string; width: number; height: number };

/** Both halves of the drawing, as one undoable step. */
type Snapshot = { raster: string; shapes: Shape[] };

/** What a pointer drag is doing, decided once on pointerdown. */
type Gesture =
  | { mode: "freehand" }
  | { mode: "create"; id: string }
  | { mode: "move"; id: string; from: { x: number; y: number }; origin: Shape }
  | { mode: "resize"; id: string; handle: HandleId };

/** Enough headroom to undo a session's worth of marks without hoarding bitmaps. */
const HISTORY_LIMIT = 30;

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
  attachLabel = "Attach",
  defaultColor = "#F43F5E",
}: {
  src: string;
  /** The image with its annotations burned in, as a data URI. */
  onAttach: (dataUrl: string) => void;
  onClose: () => void;
  /** Covers the whole viewport like the Lightbox it replaces, instead of just the stage. */
  fullscreen?: boolean;
  /** Wording of the confirm button — "Attach" when marking up, "Use sketch" when drawing one. */
  attachLabel?: string;
  /**
   * Starting ink. Marks on a photo default to a colour that can't be mistaken
   * for part of it; a drawing on a blank sheet wants graphite instead.
   */
  defaultColor?: string;
}) {
  /** Freehand strokes, the eraser and text. Painted, and painted over. */
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** Shapes and their selection handles, above the raster and taking the pointer. */
  const shapeCanvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState(defaultColor);
  const [strokeWidth, setStrokeWidth] = useState(6);

  /**
   * Shapes stay as objects so they can be picked up and resized later; only
   * the freehand half is flattened into a bitmap as it is drawn.
   */
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /**
   * A snapshot is both halves together, because one action can change either —
   * and undoing an eraser stroke has to restore pixels a replayable list can't
   * express, while undoing a move has to restore a shape's position.
   */
  const [undoStack, setUndoStack] = useState<Snapshot[]>([]);
  const [redoStack, setRedoStack] = useState<Snapshot[]>([]);

  // Where a drag began, plus the canvas as it looked then — every pointermove
  // repaints the freehand preview from that snapshot.
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const dragBase = useRef<ImageData | null>(null);
  /** What the current pointer drag is doing, once it has been decided on pointerdown. */
  const gesture = useRef<Gesture | null>(null);

  const [textAt, setTextAt] = useState<{ x: number; y: number } | null>(null);
  const [textValue, setTextValue] = useState("");

  const selected = shapes.find((shape) => shape.id === selectedId) ?? null;

  /**
   * The image actually drawn on, which is not always the one passed in.
   *
   * A stored result is a url on the asset host, and that host serves no CORS
   * headers — so loading it with `crossOrigin` set (which the canvas needs, or
   * exporting throws on a tainted canvas) simply fails, and the whole surface
   * never renders. Fetching it through the app's own backend instead returns
   * the same image as a data URI: no CORS to satisfy, and nothing to taint.
   */
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<{ src: string; message: string } | null>(null);

  // Both are tagged with the src they describe and compared here rather than
  // cleared when `src` changes. Deriving means a new image can never show the
  // previous one's dimensions for a frame on its way in.
  const ready = loaded?.src === src ? loaded : null;
  const source = ready?.source ?? null;
  const errorMessage = loadError?.src === src ? loadError.message : "";
  const size = ready ? { width: ready.width, height: ready.height } : null;

  useEffect(() => {
    let cancelled = false;

    /** Resolves `usable`, then measures it — the size is what gates rendering. */
    const open = (usable: string, crossOrigin: boolean) =>
      new Promise<void>((resolve, reject) => {
        const image = new window.Image();
        if (crossOrigin) image.crossOrigin = "anonymous";
        image.onload = () => {
          if (cancelled) return resolve();
          imageRef.current = image;
          const surface = surfaceSize(image.naturalWidth, image.naturalHeight);
          setLoaded({ src, source: usable, ...surface });
          resolve();
        };
        image.onerror = () => reject(new Error("could not load the image"));
        image.src = usable;
      });

    const failed = (message: string) => {
      if (!cancelled) setLoadError({ src, message });
    };

    (async () => {
      if (src.startsWith("data:")) {
        return open(src, false).catch(() => failed("Could not load this image"));
      }

      try {
        await open(await urlToDataUrl(src), false);
      } catch {
        // The proxy is the reliable path, not the only one: a direct load still
        // works wherever the host does send CORS headers.
        try {
          await open(src, true);
        } catch {
          failed("Could not load this image to draw on");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [src]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // Never while typing into the text box, where Escape and Backspace mean
      // something else entirely.
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if (typing) return;

      if (event.key === "Escape") {
        // One Escape drops the selection, the next closes — otherwise there is
        // no way to deselect without clicking blank canvas.
        if (selectedId) return setSelectedId(null);
        return onClose();
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedId) {
        event.preventDefault();
        deleteSelected();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deleteSelected reads current state on each call; re-binding per render would churn the listener
  }, [onClose, selectedId]);

  /**
   * Repaints the shape layer whenever anything it shows changes.
   *
   * Every shape is redrawn from scratch each time rather than patched, which
   * is what keeps a move or a resize from leaving a trail of its old position
   * behind — and it costs nothing at these counts.
   */
  useEffect(() => {
    const canvas = shapeCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    shapes.forEach((shape) => drawShape(ctx, shape));

    const active = shapes.find((shape) => shape.id === selectedId);
    if (!active) return;

    const scale = canvas.getBoundingClientRect().width > 0 ? canvas.width / canvas.getBoundingClientRect().width : 1;
    const handleSize = HANDLE_SCREEN_SIZE * scale;

    // A dashed outline around a box, so a shape mid-resize still reads as the
    // thing being changed even when its own stroke is hairline-thin.
    if (isBox(active)) {
      ctx.save();
      ctx.strokeStyle = "#60A5FA";
      ctx.lineWidth = Math.max(1, scale);
      ctx.setLineDash([6 * scale, 4 * scale]);
      ctx.strokeRect(
        Math.min(active.x1, active.x2),
        Math.min(active.y1, active.y2),
        Math.abs(active.x2 - active.x1),
        Math.abs(active.y2 - active.y1)
      );
      ctx.restore();
    }

    handlesFor(active).forEach((handle) => {
      ctx.save();
      ctx.fillStyle = "#FFFFFF";
      ctx.strokeStyle = "#60A5FA";
      ctx.lineWidth = Math.max(1, 1.5 * scale);
      ctx.beginPath();
      ctx.rect(handle.x - handleSize / 2, handle.y - handleSize / 2, handleSize, handleSize);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    });
  }, [shapes, selectedId, ready]);

  /**
   * Changing a control while a shape is selected edits that shape.
   *
   * Applied where the change happens rather than in an effect on `color`: an
   * effect would also fire when the *selection* changes, which would repaint
   * whatever you just clicked on with the toolbar's current colour instead of
   * showing you its own.
   */
  function restyleSelected(patch: Partial<Pick<Shape, "color" | "width">>) {
    if (!selectedId) return;
    pushHistory();
    setShapes((current) => current.map((shape) => (shape.id === selectedId ? { ...shape, ...patch } : shape)));
  }

  function changeColor(next: string) {
    setColor(next);
    restyleSelected({ color: next });
  }

  function changeWidth(next: number) {
    setStrokeWidth(next);
    restyleSelected({ width: next });
  }

  function context() {
    return canvasRef.current?.getContext("2d") ?? null;
  }

  function snapshot(): Snapshot | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return { raster: canvas.toDataURL(), shapes };
  }

  /** Call before mutating either layer, so the change can be undone. */
  function pushHistory() {
    const taken = snapshot();
    if (!taken) return;
    setUndoStack((current) => [...current, taken].slice(-HISTORY_LIMIT));
    setRedoStack([]);
  }

  function paint(raster: string | null) {
    const canvas = canvasRef.current;
    const ctx = context();
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!raster) return;
    const image = new window.Image();
    image.onload = () => ctx.drawImage(image, 0, 0);
    image.src = raster;
  }

  function restore(step: Snapshot) {
    paint(step.raster);
    setShapes(step.shapes);
    // The shape it pointed at may not exist in the restored state.
    setSelectedId((current) => (step.shapes.some((shape) => shape.id === current) ? current : null));
  }

  function undo() {
    const taken = snapshot();
    if (!taken || undoStack.length === 0) return;
    setRedoStack((current) => [...current, taken]);
    setUndoStack((current) => current.slice(0, -1));
    restore(undoStack[undoStack.length - 1]);
  }

  function redo() {
    const taken = snapshot();
    if (!taken || redoStack.length === 0) return;
    setUndoStack((current) => [...current, taken]);
    setRedoStack((current) => current.slice(0, -1));
    restore(redoStack[redoStack.length - 1]);
  }

  function clearAll() {
    if (undoStack.length === 0 && shapes.length === 0 && !hasMarks()) return;
    pushHistory();
    paint(null);
    setShapes([]);
    setSelectedId(null);
  }

  function deleteSelected() {
    if (!selectedId) return;
    pushHistory();
    setShapes((current) => current.filter((shape) => shape.id !== selectedId));
    setSelectedId(null);
  }

  function hasMarks() {
    const canvas = canvasRef.current;
    const ctx = context();
    if (!canvas || !ctx) return false;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return true;
    return false;
  }

  /** Canvas pixels per CSS pixel, so handles stay one size on screen at any zoom. */
  function canvasScale() {
    const canvas = shapeCanvasRef.current;
    if (!canvas) return 1;
    const rect = canvas.getBoundingClientRect();
    return rect.width > 0 ? canvas.width / rect.width : 1;
  }

  /**
   * Client coordinates → canvas pixels, since the canvas is displayed scaled.
   *
   * Null when the canvas has gone: a pointer released or dragged off as the
   * overlay closes still delivers its event, and an assertion here threw on
   * the way out rather than simply ignoring it.
   */
  function toCanvas(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = shapeCanvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

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

  /** The handle of the selected shape under `point`, if the pointer is on one. */
  function handleAt(point: { x: number; y: number }): HandleId | null {
    if (!selected) return null;
    const grab = (HANDLE_SCREEN_SIZE * canvasScale()) / 2 + 2 * canvasScale();

    const found = handlesFor(selected).find(
      (handle: Handle) => Math.abs(handle.x - point.x) <= grab && Math.abs(handle.y - point.y) <= grab
    );
    return found?.id ?? null;
  }

  /** Topmost shape under `point` — last drawn wins, matching what is on top. */
  function shapeAt(point: { x: number; y: number }) {
    const tolerance = 6 * canvasScale();
    for (let index = shapes.length - 1; index >= 0; index -= 1) {
      if (hit(shapes[index], point, tolerance)) return shapes[index];
    }
    return null;
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    const surface = shapeCanvasRef.current;
    const canvas = canvasRef.current;
    const ctx = context();
    if (!surface || !canvas || !ctx) return;

    const point = toCanvas(event);
    if (!point) return;

    if (tool === "text") {
      setTextAt(point);
      setTextValue("");
      return;
    }

    surface.setPointerCapture(event.pointerId);

    // ── select: resize the selected shape, move whatever is under the pointer,
    //    or clear the selection when nothing is.
    if (tool === "select") {
      const grabbed = handleAt(point);
      if (grabbed && selected) {
        pushHistory();
        gesture.current = { mode: "resize", id: selected.id, handle: grabbed };
        return;
      }

      const target = shapeAt(point);
      setSelectedId(target?.id ?? null);
      if (target) {
        pushHistory();
        gesture.current = { mode: "move", id: target.id, from: point, origin: target };
      }
      return;
    }

    pushHistory();

    // ── a new shape starts selected, so it can be adjusted straight away.
    if (isShapeTool(tool)) {
      const created: Shape = {
        id: crypto.randomUUID(),
        kind: tool,
        x1: point.x,
        y1: point.y,
        x2: point.x,
        y2: point.y,
        color,
        width: strokeWidth,
      };
      setShapes((current) => [...current, created]);
      setSelectedId(created.id);
      gesture.current = { mode: "create", id: created.id };
      return;
    }

    // ── freehand and eraser, straight onto the raster layer.
    gesture.current = { mode: "freehand" };
    dragStart.current = point;
    dragBase.current = ctx.getImageData(0, 0, canvas.width, canvas.height);

    applyStroke(ctx);
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
    // A tap with no drag should still leave a dot.
    ctx.lineTo(point.x + 0.01, point.y);
    ctx.stroke();
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const active = gesture.current;
    if (!active) return;

    const point = toCanvas(event);
    if (!point) return;

    if (active.mode === "freehand") {
      const ctx = context();
      if (!ctx) return;
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
      return;
    }

    if (active.mode === "create" || active.mode === "resize") {
      const handle: HandleId = active.mode === "create" ? "se" : active.handle;
      setShapes((current) =>
        current.map((shape) => (shape.id === active.id ? resized(shape, handle, point) : shape))
      );
      return;
    }

    const dx = point.x - active.from.x;
    const dy = point.y - active.from.y;
    setShapes((current) => current.map((shape) => (shape.id === active.id ? moved(active.origin, dx, dy) : shape)));
  }

  function handlePointerUp() {
    const active = gesture.current;
    const ctx = context();
    if (ctx) ctx.globalCompositeOperation = "source-over";

    // A click with a shape tool is not a shape — drop it rather than leaving a
    // speck behind, and take its history entry with it.
    if (active?.mode === "create") {
      setShapes((current) => {
        const created = current.find((shape) => shape.id === active.id);
        if (!created || !isTooSmall(created)) return current;
        setUndoStack((stack) => stack.slice(0, -1));
        setSelectedId(null);
        return current.filter((shape) => shape.id !== active.id);
      });
    }

    gesture.current = null;
    dragStart.current = null;
    dragBase.current = null;
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

  /** Flattens the photo, the freehand marks and the shapes into one image. */
  function attach() {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image) return;

    const merged = document.createElement("canvas");
    merged.width = canvas.width;
    merged.height = canvas.height;
    const ctx = merged.getContext("2d");
    if (!ctx) return;

    // Scaled to the surface, which may be smaller than the original.
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    ctx.drawImage(canvas, 0, 0);
    // Re-rendered rather than copied off the shape canvas, which is carrying
    // selection handles that must not end up in the image.
    shapes.forEach((shape) => drawShape(ctx, shape));

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
      {/* Until the image is measured there is nothing to draw on. Say so,
          rather than leaving a toolbar floating over an empty surface. */}
      {!size && (
        <p className="rounded-lg border border-white/10 bg-black/70 px-3 py-2 text-[12px] text-white/70">
          {errorMessage || "Loading image…"}
        </p>
      )}

      {size && (
        <div className="relative max-h-full max-w-full" style={{ aspectRatio: `${size.width} / ${size.height}` }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- the canvas must sit on an element whose box exactly matches the bitmap. */}
          <img src={source ?? src} alt="" className="pointer-events-none h-full w-full select-none object-fill" />

          {/* Freehand marks sit under the shapes, and take no pointer events of
              their own — the shape layer above is the single input surface. */}
          <canvas
            ref={canvasRef}
            width={size.width}
            height={size.height}
            className="pointer-events-none absolute inset-0 h-full w-full"
          />

          <canvas
            ref={shapeCanvasRef}
            width={size.width}
            height={size.height}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            className={cn(
              "absolute inset-0 h-full w-full touch-none",
              tool === "select" ? "cursor-default" : "cursor-crosshair"
            )}
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

      <DrawingToolbar
        tool={tool}
        onToolChange={setTool}
        color={color}
        onColorChange={changeColor}
        strokeWidth={strokeWidth}
        onWidthChange={changeWidth}
        onUndo={undo}
        onRedo={redo}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        onDelete={selected ? deleteSelected : clearAll}
        deleteLabel={selected ? 'Delete shape' : 'Clear all'}
        onConfirm={attach}
        confirmLabel={attachLabel}
        onClose={onClose}
      />
    </div>
  );
}
