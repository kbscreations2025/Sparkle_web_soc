"use client";

import { useMemo, useState } from "react";
import { AnnotationOverlay } from "./AnnotationOverlay";
import { cn } from "@/lib/utils";

/**
 * A blank sheet to draw a design on, for when there is no sketch to upload.
 *
 * Deliberately not a second drawing engine: marking up a result and drawing
 * from scratch are the same act on a different surface, so this hands a blank
 * white sheet to `AnnotationOverlay` and gets its pen, eraser, shapes, text,
 * undo/redo and flattened export for free. The only thing that is new here is
 * the sheet itself.
 */

/**
 * Sheet sizes, in the proportions a piece is actually drawn in — a ring on a
 * square, a pendant or earring down a portrait, a bracelet across a landscape.
 *
 * 1280 on the long edge: big enough that a line drawn thin still reads as a
 * line once the model sees it, and small enough that the flattened PNG stays
 * a sane thing to send.
 */
const SHEETS = [
  { id: "square", label: "Square", width: 1280, height: 1280 },
  { id: "portrait", label: "Portrait", width: 1024, height: 1280 },
  { id: "landscape", label: "Landscape", width: 1280, height: 1024 },
] as const;

type SheetId = (typeof SHEETS)[number]["id"];

/** Graphite rather than black — a pencil line, and softer against white. */
const PENCIL = "#1F2937";

/** A blank white sheet as a data URI, which is all the overlay needs to open on. */
function blankSheet(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, width, height);
  }
  return canvas.toDataURL("image/png");
}

export function SketchPad({
  onDone,
  onClose,
}: {
  /** The finished drawing, flattened onto its white sheet, as a data URI. */
  onDone: (dataUrl: string) => void;
  onClose: () => void;
}) {
  const [sheet, setSheet] = useState<SheetId>("square");

  // Rebuilt only when the shape changes. Changing it starts a fresh sheet,
  // which is also what resets the drawing — there is no half-finished state
  // worth carrying between two different canvas sizes.
  const src = useMemo(() => {
    const chosen = SHEETS.find((entry) => entry.id === sheet) ?? SHEETS[0];
    return blankSheet(chosen.width, chosen.height);
  }, [sheet]);

  return (
    <>
      <AnnotationOverlay
        // Keyed by sheet so switching shape mounts a clean canvas rather than
        // leaving the previous drawing stretched across the new proportions.
        key={sheet}
        fullscreen
        src={src}
        defaultColor={PENCIL}
        attachLabel="Use sketch"
        onAttach={onDone}
        onClose={onClose}
      />

      {/* Sits above the overlay, clear of its toolbar along the top. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4">
        <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-white/15 bg-black/70 p-1 backdrop-blur-sm">
          <span className="px-2 text-[10px] font-medium uppercase tracking-wide text-white/50">Sheet</span>
          {SHEETS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setSheet(entry.id)}
              aria-pressed={entry.id === sheet}
              className={cn(
                "rounded-full px-3 py-1 text-[11px] font-medium transition-colors",
                entry.id === sheet ? "bg-gold/25 text-gold" : "text-white/75 hover:bg-white/10 hover:text-white"
              )}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
