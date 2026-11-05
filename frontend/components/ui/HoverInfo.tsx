"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * An ⓘ that shows a longer explanation beside the cursor while hovered.
 *
 * For text that would otherwise wrap a table row onto three lines: the row
 * keeps its height and the detail is one hover away. The tooltip follows the
 * pointer, flips to its left or above near the screen's edge so it is never
 * cut off, and is portalled so a scrolling table can't clip it. Focusable,
 * and its text is the accessible label, so it isn't mouse-only.
 */
export function HoverInfo({ text, className }: { text: string; className?: string }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const wasOpenRef = useRef(false);

  const style = at
    ? {
        ...(at.x + 260 > window.innerWidth ? { right: window.innerWidth - at.x + 10 } : { left: at.x + 14 }),
        ...(at.y + 120 > window.innerHeight ? { bottom: window.innerHeight - at.y + 10 } : { top: at.y + 16 }),
      }
    : undefined;

  return (
    <>
      <span
        tabIndex={0}
        role="img"
        aria-label={text}
        onMouseMove={(event) => setAt({ x: event.clientX, y: event.clientY })}
        onMouseLeave={() => setAt(null)}
        onFocus={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          setAt({ x: box.right, y: box.bottom });
        }}
        onBlur={() => setAt(null)}
        // A tap on a touch screen toggles the tip — there is no hover to show
        // it and no mouse leaving to hide it. Whether it was open is read
        // before the tap's own focus opens it, or a second tap could never
        // close it. A mouse click is left to hover and focus as before.
        onPointerDown={(event) => {
          if (event.pointerType !== "mouse") wasOpenRef.current = at !== null;
        }}
        onClick={(event) => {
          if ((event.nativeEvent as PointerEvent).pointerType === "mouse") return;
          const box = event.currentTarget.getBoundingClientRect();
          setAt(wasOpenRef.current ? null : { x: box.right, y: box.bottom });
        }}
        className={cn(
          "inline-flex shrink-0 cursor-help items-center text-faint outline-none transition-colors hover:text-gold focus-visible:text-gold",
          className
        )}
      >
        <Info size={12} />
      </span>
      {at &&
        createPortal(
          <div
            role="tooltip"
            style={style}
            className="pointer-events-none fixed z-[100] w-max max-w-[240px] rounded-md border border-gold/20 bg-surface-raised px-2.5 py-1.5 text-[11px] leading-snug text-muted shadow-lg"
          >
            {text}
          </div>,
          document.body
        )}
    </>
  );
}
