"use client";

import type { ReactNode } from "react";
import { ArrowUpRight, Check, Circle, Eraser, Minus, MousePointer2, Pencil, Redo2, Square, Trash2, Type, Undo2, X } from "lucide-react";
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
}) {
  const sizeLabel = tool === "eraser" ? "Eraser size" : "Stroke size";

  return (
    // Wraps rather than scrolls: on a phone the row is wider than the screen,
    // and a toolbar that has to be scrolled sideways hides half its tools.
    <div className="absolute right-3 top-3 flex max-w-[92%] flex-wrap items-center justify-end gap-1.5 rounded-2xl border border-white/10 bg-black px-2 py-1.5">
      <div className="flex items-center gap-0.5">
        {TOOLS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            title={label}
            aria-pressed={tool === id}
            onClick={() => onToolChange(id)}
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors",
              tool === id ? "bg-gold/30 text-gold" : "text-white/80 hover:bg-white/15"
            )}
          >
            <Icon size={14} />
          </button>
        ))}
      </div>

      <Divider />

      <label title="Colour" className="relative h-6 w-6 shrink-0 overflow-hidden rounded-full border border-white/25">
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
      <label className="flex items-center gap-1.5 px-1" title={sizeLabel}>
        <span
          className="shrink-0 rounded-full bg-white"
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
          className="h-1 w-20 cursor-pointer accent-gold"
        />
        {/* The preview dot stops growing at 14px so it can't push the toolbar
            around, which would otherwise make every size above that look
            identical. The number keeps the change readable all the way up. */}
        <span className="w-6 shrink-0 text-right text-[10px] tabular-nums text-white/60">{strokeWidth}</span>
      </label>

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

      <Divider />

      <button
        type="button"
        onClick={onConfirm}
        className="flex h-7 items-center gap-1 rounded-full bg-gold/20 px-2.5 text-[11px] font-medium text-gold transition-colors hover:bg-gold/30"
      >
        <Check size={13} /> {confirmLabel}
      </button>
      <ToolbarAction label="Close" onClick={onClose}>
        <X size={14} />
      </ToolbarAction>
    </div>
  );
}

const Divider = () => <span className="mx-0.5 h-5 w-px bg-white/15" />;

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
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/15 disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
