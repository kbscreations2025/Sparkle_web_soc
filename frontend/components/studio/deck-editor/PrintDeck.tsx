"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { AffinityPiece } from "@/lib/affinity";
import type { DeckDesign } from "@/lib/deckDesign";
import { SlideView } from "./SlideView";

/**
 * The PDF: every page drawn exactly as the editor draws it, one page to a
 * sheet, handed to the browser's print dialog ("Save as PDF").
 *
 * Rendered straight into <body> rather than inside the app: the app is a
 * fixed-height, overflow-clipped layout, and anything printed from inside it
 * is cut to one screen. The print stylesheet (globals.css) hides everything
 * else on the page while this is there. Printing waits until every picture
 * has loaded, so none comes out blank.
 */
export function PrintDeck({ design, pieces, onDone }: { design: DeckDesign; pieces: AffinityPiece[]; onDone: () => void }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const finish = () => onDone();
    window.addEventListener("afterprint", finish, { once: true });

    const images = [...(root.current?.querySelectorAll("img") ?? [])];
    Promise.all(
      images.map((img) =>
        img.complete && img.naturalWidth ? Promise.resolve() : img.decode().catch(() => undefined)
      )
    )
      .then(() => document.fonts?.ready)
      .then(() => {
        if (!cancelled) window.print();
      });

    return () => {
      cancelled = true;
      window.removeEventListener("afterprint", finish);
    };
  }, [onDone]);

  return createPortal(
    <div id="deck-print-root" ref={root}>
      <style>{"@page { size: 13.333in 7.5in; margin: 0; }"}</style>
      {design.slides.map((slide) => (
        <div key={slide.id} className="deck-print-page">
          <SlideView slide={slide} pieces={pieces} scale={1} />
        </div>
      ))}
    </div>,
    document.body
  );
}
