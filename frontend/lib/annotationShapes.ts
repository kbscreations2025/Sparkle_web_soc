/**
 * The geometry behind editable shapes on a drawing canvas.
 *
 * Shapes are kept as objects rather than being painted into the bitmap the
 * moment they are drawn, which is what makes them movable and resizable after
 * the fact. Freehand pen strokes, the eraser and text stay raster — they have
 * no handles to offer and no shape to preserve.
 *
 * Pure functions on plain data: no canvas state, no React, so the drawing
 * surface can render them and a flattening pass can render them again without
 * the two disagreeing.
 */

export type ShapeKind = "rect" | "circle" | "line" | "arrow";

export type Shape = {
  id: string;
  kind: ShapeKind;
  /** Corners of the bounding box, or the two ends of a line. Not normalised: dragging a handle past its opposite is allowed to invert it. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
};

export type Point = { x: number; y: number };

/** Corners for a box, endpoints for a line. */
export type HandleId = "nw" | "ne" | "se" | "sw" | "start" | "end";
export type Handle = { id: HandleId; x: number; y: number };

const BOX_KINDS: ShapeKind[] = ["rect", "circle"];

export function isBox(shape: Shape) {
  return BOX_KINDS.includes(shape.kind);
}

export function draw(ctx: CanvasRenderingContext2D, shape: Shape) {
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = shape.width;
  ctx.strokeStyle = shape.color;
  ctx.beginPath();

  if (shape.kind === "rect") {
    ctx.rect(shape.x1, shape.y1, shape.x2 - shape.x1, shape.y2 - shape.y1);
    ctx.stroke();
  } else if (shape.kind === "circle") {
    ctx.ellipse(
      (shape.x1 + shape.x2) / 2,
      (shape.y1 + shape.y2) / 2,
      Math.abs(shape.x2 - shape.x1) / 2,
      Math.abs(shape.y2 - shape.y1) / 2,
      0,
      0,
      Math.PI * 2
    );
    ctx.stroke();
  } else {
    ctx.moveTo(shape.x1, shape.y1);
    ctx.lineTo(shape.x2, shape.y2);
    ctx.stroke();

    if (shape.kind === "arrow") {
      const head = Math.max(shape.width * 3, 14);
      const angle = Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1);
      ctx.beginPath();
      ctx.moveTo(shape.x2, shape.y2);
      ctx.lineTo(shape.x2 - head * Math.cos(angle - Math.PI / 6), shape.y2 - head * Math.sin(angle - Math.PI / 6));
      ctx.moveTo(shape.x2, shape.y2);
      ctx.lineTo(shape.x2 - head * Math.cos(angle + Math.PI / 6), shape.y2 - head * Math.sin(angle + Math.PI / 6));
      ctx.stroke();
    }
  }

  ctx.restore();
}

export function handlesFor(shape: Shape): Handle[] {
  if (!isBox(shape)) {
    return [
      { id: "start", x: shape.x1, y: shape.y1 },
      { id: "end", x: shape.x2, y: shape.y2 },
    ];
  }

  return [
    { id: "nw", x: shape.x1, y: shape.y1 },
    { id: "ne", x: shape.x2, y: shape.y1 },
    { id: "se", x: shape.x2, y: shape.y2 },
    { id: "sw", x: shape.x1, y: shape.y2 },
  ];
}

/** Distance from `point` to the segment a–b, for hit-testing a line. */
function distanceToSegment(point: Point, a: Point, b: Point) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;

  // A zero-length line is a dot; fall back to the distance from that dot.
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/**
 * Whether `point` should count as landing on `shape`.
 *
 * A box is hit anywhere inside it, not only on its outline: grabbing a
 * rectangle by its middle is what anyone expects, and chasing a 2px stroke to
 * move something is miserable on a trackpad and impossible on a phone.
 */
export function hit(shape: Shape, point: Point, tolerance: number) {
  if (isBox(shape)) {
    const left = Math.min(shape.x1, shape.x2) - tolerance;
    const right = Math.max(shape.x1, shape.x2) + tolerance;
    const top = Math.min(shape.y1, shape.y2) - tolerance;
    const bottom = Math.max(shape.y1, shape.y2) + tolerance;
    return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
  }

  const reach = Math.max(tolerance, shape.width);
  return distanceToSegment(point, { x: shape.x1, y: shape.y1 }, { x: shape.x2, y: shape.y2 }) <= reach;
}

export function moved(shape: Shape, dx: number, dy: number): Shape {
  return { ...shape, x1: shape.x1 + dx, y1: shape.y1 + dy, x2: shape.x2 + dx, y2: shape.y2 + dy };
}

/** The shape with `handle` dragged to `point`; the opposite corner stays put. */
export function resized(shape: Shape, handle: HandleId, point: Point): Shape {
  switch (handle) {
    case "nw":
      return { ...shape, x1: point.x, y1: point.y };
    case "ne":
      return { ...shape, x2: point.x, y1: point.y };
    case "se":
      return { ...shape, x2: point.x, y2: point.y };
    case "sw":
      return { ...shape, x1: point.x, y2: point.y };
    case "start":
      return { ...shape, x1: point.x, y1: point.y };
    case "end":
      return { ...shape, x2: point.x, y2: point.y };
  }
}

/** Anything smaller than this in both directions was a stray click, not a shape. */
export const MIN_SHAPE_SIZE = 4;

export function isTooSmall(shape: Shape) {
  return Math.abs(shape.x2 - shape.x1) < MIN_SHAPE_SIZE && Math.abs(shape.y2 - shape.y1) < MIN_SHAPE_SIZE;
}
