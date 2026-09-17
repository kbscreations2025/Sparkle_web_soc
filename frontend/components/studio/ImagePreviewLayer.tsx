"use client";

import { useState } from "react";
import { AnnotationOverlay } from "./AnnotationOverlay";
import { Lightbox } from "./Lightbox";

/** An image opened for a closer look, and the slot a marked-up copy goes back to. */
export type PreviewImage = { src: string; key: string };

/**
 * Preview and mark up an image a tool has been *given*, before it is generated
 * from — a reference photo, an uploaded sketch, the photo to redraw.
 *
 * The same two surfaces `AnnotationLayer` puts behind the chat rail, but driven
 * by a page's own input state rather than the staged attachments: annotating
 * replaces the image in the slot it was opened from, so the run starts from what
 * the user marked.
 */
export function ImagePreviewLayer({
  preview,
  onClose,
  onSave,
  downloadName = "image.jpg",
}: {
  preview: PreviewImage | null;
  onClose: () => void;
  /** Writes the marked-up copy back into the slot `key` identifies. */
  onSave: (marked: string, key: string) => void;
  downloadName?: string;
}) {
  // Held as the source being marked up rather than a flag, so closing one
  // preview can never leave the editor armed for whichever is opened next.
  const [annotatingSrc, setAnnotatingSrc] = useState<string | null>(null);
  const annotating = Boolean(preview) && annotatingSrc === preview?.src;

  if (!preview) return null;

  if (annotating) {
    return (
      <AnnotationOverlay
        fullscreen
        src={preview.src}
        onAttach={(marked) => {
          onSave(marked, preview.key);
          setAnnotatingSrc(null);
          onClose();
        }}
        onClose={() => setAnnotatingSrc(null)}
      />
    );
  }

  return (
    <Lightbox
      src={preview.src}
      onClose={onClose}
      downloadName={downloadName}
      onAnnotate={() => setAnnotatingSrc(preview.src)}
    />
  );
}
