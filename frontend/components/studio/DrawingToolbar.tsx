"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ArrowUpRight, Check, Circle, Eraser, GripVertical, Minus, MousePointer2, Pencil, Redo2, Square, Trash2, Type, Undo2, X } from "lucide-react";
import type { ShapeKind } from "@/lib/annotationShapes";
import { cn } from "@/lib/utils";

/**
 * The controls above a drawing surface: what to draw with, in what colour and
 * how thick, and what to do with the result.
 *
 * Pure presentation — it owns no drawing state and touches no canvas. Split
 * out of `AnnotationOverlay` because that file had grown to hold a drawing
 * engine and its chrome at once, and only one of the two is worth reading when
 * changing a button.
 */

export type Tool = "select" | "pen" | "eraser" | ShapeKind | "text";

export const TOOLS: { id: Tool; label: string; icon: typeof Pencil }[] = [
  { id: "select", label: "Select — move and resize shapes", icon: MousePointer2 },
  { id: "pen", label: "Pen", icon: Pencil },
  { id: "eraser", label: "Eraser", icon: Eraser },
  { id: "rect", label: "Rectangle", icon: Square },
  { id: "circle", label: "Circle", icon: Circle },
  { id: "line", label: "Line", icon: Minus },
  { id: "arrow", label: "Arrow", icon: ArrowUpRight },
  { id: "text", label: "Text", icon: Type },
];

const SHAPE_TOOLS: Tool[] = ["rect", "circle", "line", "arrow"];
export const isShapeTool = (tool: Tool): tool is ShapeKind => SHAPE_TOOLS.includes(tool);

/**
 * Every stroke width the slider can produce, in order. The handle steps
 * through this list one stop at a time, so the track is a list of sizes rather
 * than a continuous range.
 *
 * The spacing is the point. 1–8px is where nearly all drawing happens, so
 * those are single pixels and each step of the handle is visible. Past that
 * the steps widen, because the difference between a 33px and a 34px line is
 * not worth a stop of its own — while 40 to 48 plainly is.
 *
 * A list rather than a curve for two reasons: the fine end is defined outright
 * instead of falling out of an exponent, and the value round-trips exactly, so
 * the handle stays wherever it is dropped. An earlier eased curve failed on
 * both counts — its midpoint drew a hairline, and rounding to whole pixels and
 * back nudged the handle a step each time.
 */
export const WIDTHS = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40, 48] as const;

/** The stop a width sits at — the nearest one, for a width set from elsewhere. */
function widthToStop(width: number) {
  let nearest = 0;
  for (let index = 1; index < WIDTHS.length; index += 1) {
    if (Math.abs(WIDTHS[index] - width) < Math.abs(WIDTHS[nearest] - width)) nearest = index;
  }
  return nearest;
}

type Corner = "tl" | "tr" | "bl" | "br";
const CORNER_CLASS: Record<Corner, string> = {
  tl: "left-3 top-3",
  tr: "right-3 top-3",
  bl: "left-3 bottom-3",
  br: "right-3 bottom-3",
};

/**
 * Lets the toolbar be dragged by its grip and, on release, snaps it to
 * whichever corner of the drawing area is nearest — so it can be moved off
 * the part of the piece being drawn on, but never left half over it.
 */
function useCornerDrag() {
  const [corner, setCorner] = useState<Corner>("tr");
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  function end() {
    const el = ref.current;
    const area = el?.offsetParent?.getBoundingClientRect();
    if (el && area && start.current) {
      const box = el.getBoundingClientRect();
      const top = box.top + box.height / 2 < area.top + area.height / 2;
      const left = box.left + box.width / 2 < area.left + area.width / 2;
      setCorner(`${top ? "t" : "b"}${left ? "l" : "r"}`);
    }
    start.current = null;
    setOffset(null);
  }

  const gripProps = {
    onPointerDown(event: ReactPointerEvent<HTMLElement>) {
      event.currentTarget.setPointerCapture(event.pointerId);
      start.current = { x: event.clientX, y: event.clientY };
      setOffset({ x: 0, y: 0 });
    },
    onPointerMove(event: ReactPointerEvent<HTMLElement>) {
      if (start.current) setOffset({ x: event.clientX - start.current.x, y: event.clientY - start.current.y });
    },
    onPointerUp: end,
    onPointerCancel: end,
  };

  return {
    ref,
    positionClass: CORNER_CLASS[corner],
    style: offset ? { transform: `translate(${offset.x}px, ${offset.y}px)` } : undefined,
    gripProps,
  };
}

function DragGrip(props: ReturnType<typeof useCornerDrag>["gripProps"]) {
  return (
    <span
      {...props}
      title="Drag to move — it snaps to the nearest corner"
      aria-label="Move toolbar"
      className="flex h-7 w-4 shrink-0 cursor-grab touch-none items-center justify-center text-faint hover:text-muted active:cursor-grabbing"
    >
      <GripVertical size={13} />
    </span>
  );
}

export function DrawingToolbar({
  tool,
  onToolChange,
  color,
  onColorChange,
  strokeWidth,
  onWidthChange,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onDelete,
  deleteLabel,
  onConfirm,
  confirmLabel,
  onClose,
  collapsed = false,
  onExpand,
}: {
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  color: string;
  onColorChange: (color: string) => void;
  strokeWidth: number;
  onWidthChange: (width: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Removes the selected shape, or clears everything when nothing is selected. */
  onDelete: () => void;
  deleteLabel: string;
  onConfirm: () => void;
  confirmLabel: string;
  onClose: () => void;
  /** Folded down to the current tool, Attach and Close — out of the way while drawing. */
  collapsed?: boolean;
  onExpand?: () => void;
}) {
  const sizeLabel = tool === "eraser" ? "Eraser size" : "Stroke size";
  const { ref: dragRef, positionClass, style: dragStyle, gripProps } = useCornerDrag();

  const confirmButton = (
    <button
      type="button"
      onClick={onConfirm}
      className="flex h-7 items-center gap-1 rounded-full border border-gold/30 bg-gold/[0.12] px-3 text-[11px] font-semibold text-gold transition-colors hover:border-gold/50 hover:bg-gold/20"
    >
      <Check size={13} /> {confirmLabel}
    </button>
  );
  const closeButton = (
    <ToolbarAction label="Close" onClick={onClose}>
      <X size={14} />
    </ToolbarAction>
  );

  if (collapsed) {
    // The active tool stands in for the whole row: it shows what a stroke
    // will draw, and tapping it brings the full toolbar back.
    const ActiveIcon = (TOOLS.find((entry) => entry.id === tool) ?? TOOLS[1]).icon;
    return (
      <div
        ref={dragRef}
        style={dragStyle}
        className={cn(
          "absolute z-10 flex items-center gap-1.5 rounded-md border border-gold/20 bg-surface-raised/95 py-1.5 pl-0.5 pr-1.5 shadow-[0_6px_24px_rgba(74,52,16,0.14)] backdrop-blur-md",
          positionClass
        )}
      >
        <DragGrip {...gripProps} />
        <button
          type="button"
          onClick={onExpand}
          title="Show drawing tools"
          aria-label="Show drawing tools"
          className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold transition-colors hover:bg-gold/25"
        >
          <ActiveIcon size={14} />
          <span
            className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface-raised"
            style={{ background: color }}
          />
        </button>
        {/* Undo and redo stay out while drawing — they are the two most
            used controls after a stroke, and opening the full toolbar for
            them would defeat folding it away. */}
        <ToolbarAction label="Undo" onClick={onUndo} disabled={!canUndo}>
          <Undo2 size={14} />
        </ToolbarAction>
        <ToolbarAction label="Redo" onClick={onRedo} disabled={!canRedo}>
          <Redo2 size={14} />
        </ToolbarAction>
        {confirmButton}
        {closeButton}
      </div>
    );
  }

  return (
    // Two fixed rows rather than one that wraps wherever it runs out of room:
    // what to draw with (and undo it) on top, how it looks underneath, so
    // each control is always in the same place.
    <div
      ref={dragRef}
      style={dragStyle}
      className={cn(
        "absolute z-10 flex max-w-[92%] flex-col gap-1 rounded-md border border-gold/20 bg-surface-raised/95 py-1.5 pl-0.5 pr-2 shadow-[0_6px_24px_rgba(74,52,16,0.14)] backdrop-blur-md",
        positionClass
      )}
    >
      <div className="flex items-center gap-1.5">
        <DragGrip {...gripProps} />
        <div className="flex flex-wrap items-center gap-0.5">
          {TOOLS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              title={label}
              aria-pressed={tool === id}
              onClick={() => onToolChange(id)}
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors",
                tool === id ? "bg-gold/15 text-gold" : "text-muted hover:bg-gold/[0.08] hover:text-cream"
              )}
            >
              <Icon size={14} />
            </button>
          ))}
        </div>

        <Divider />

        <ToolbarAction label="Undo" onClick={onUndo} disabled={!canUndo}>
          <Undo2 size={14} />
        </ToolbarAction>
        <ToolbarAction label="Redo" onClick={onRedo} disabled={!canRedo}>
          <Redo2 size={14} />
        </ToolbarAction>
        <ToolbarAction label={deleteLabel} onClick={onDelete}>
          <Trash2 size={14} />
        </ToolbarAction>
        {closeButton}
      </div>

      <div className="flex items-center gap-2 border-t border-gold/15 pl-1.5 pt-1">
        <label title="Colour" className="relative h-6 w-6 shrink-0 overflow-hidden rounded-full border border-gold/30 shadow-sm">
          <span className="block h-full w-full" style={{ background: color }} />
          <input
            type="color"
            value={color}
            onChange={(event) => onColorChange(event.target.value)}
            aria-label="Colour"
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>

        {/* One slider for both: the eraser needs a size as much as the pen does. */}
        <label className="flex min-w-0 flex-1 items-center gap-1.5 px-1" title={sizeLabel}>
          <span
            className="shrink-0 rounded-full bg-cream"
            style={{ width: Math.min(strokeWidth, 14), height: Math.min(strokeWidth, 14) }}
          />
          <input
            type="range"
            min={0}
            max={WIDTHS.length - 1}
            step={1}
            value={widthToStop(strokeWidth)}
            onChange={(event) => onWidthChange(WIDTHS[Number(event.target.value)])}
            aria-label={sizeLabel}
            className="h-1 min-w-16 flex-1 cursor-pointer accent-gold"
          />
          {/* The preview dot stops growing at 14px so it can't push the toolbar
              around, which would otherwise make every size above that look
              identical. The number keeps the change readable all the way up. */}
          <span className="w-6 shrink-0 text-right text-[10px] tabular-nums text-faint">{strokeWidth}</span>
        </label>

        {confirmButton}
      </div>
    </div>
  );
}

const Divider = () => <span className="mx-0.5 h-5 w-px bg-gold/20" />;

function ToolbarAction({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-gold/[0.08] hover:text-cream disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
