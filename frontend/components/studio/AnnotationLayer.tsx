"use client";

import { AnnotationOverlay } from "./AnnotationOverlay";
import { Lightbox } from "./Lightbox";
import type { AttachmentsController } from "@/lib/useAttachments";

/**
 * The two full-screen surfaces every chat-style tool puts at the end of its
 * tree: the annotation editor for a staged chip, and the lightbox that opens a
 * preview.
 *
 * Annotating a *reference* replaces the preview it was opened from, so it stays
 * full-screen rather than jumping to the stage — the stage's own overlay is
 * rendered by the page, since only the page knows where its stage is.
 */
export function AnnotationLayer({
  attachments,
  lightboxSrc,
  onCloseLightbox,
}: {
  attachments: AttachmentsController;
  /** A source opened straight into the lightbox, e.g. the stage's expand button. */
  lightboxSrc?: string | null;
  onCloseLightbox?: () => void;
}) {
  const { annotating, setAnnotating, saveAnnotation, previewAttachment, setPreviewAttachment, annotatePreview } =
    attachments;

  return (
    <>
      {annotating && annotating.target !== "stage" && (
        <AnnotationOverlay
          fullscreen
          src={annotating.src}
          onAttach={saveAnnotation}
          onClose={() => setAnnotating(null)}
        />
      )}

      <Lightbox
        src={previewAttachment?.src ?? lightboxSrc ?? null}
        onClose={() => {
          setPreviewAttachment(null);
          onCloseLightbox?.();
        }}
        downloadName={previewAttachment ? `${previewAttachment.label.toLowerCase()}.jpg` : undefined}
        onAnnotate={previewAttachment ? annotatePreview : undefined}
      />
    </>
  );
}
