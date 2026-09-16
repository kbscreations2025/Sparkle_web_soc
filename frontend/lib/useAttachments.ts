"use client";

import { useCallback, useState } from "react";
import type { Attachment } from "@/components/studio/AttachmentChips";
import { compressImage } from "@/lib/image";

/**
 * The images staged alongside the next message, and the marking-up of them.
 *
 * Every chat-style tool needs the identical set: a marked-up copy of the
 * result, any number of reference images, the chip preview that opens one, and
 * the annotation editor that writes a copy back into whichever slot it came
 * from. This owns all of it so the tools don't each keep their own copy of the
 * same six pieces of state and the same four handlers.
 *
 * What stays with the caller is only what genuinely differs: which image is
 * being edited, and what a tool does with an annotated *photo* (Chat to Edit
 * has a "not sent yet" slot that the others don't).
 */

/** Where an annotated copy is written back to once the user hits Attach. */
export type AnnotationTarget = "stage" | "photo" | { ref: number };

export type Annotating = { src: string; target: AnnotationTarget };

export function useAttachments({
  extra,
  onRemoveExtra,
  onSavePhoto,
  onError,
}: {
  /** A tool-specific chip shown before the rest, e.g. a photo staged but not yet sent. */
  extra?: Attachment | null;
  /** Called when that tool-specific chip's remove button is pressed. */
  onRemoveExtra?: () => void;
  /** Overrides where an annotated photo is written. Defaults to the annotated-photo slot. */
  onSavePhoto?: (marked: string) => void;
  onError?: (message: string) => void;
} = {}) {
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  // A marked-up copy of the current result — annotating again replaces this one
  // slot instead of piling up new chips.
  const [annotatedPhoto, setAnnotatedPhoto] = useState<string | null>(null);
  // Set instead of a plain lightbox source when a chip is opened, so the
  // lightbox knows which slot to offer Annotate for.
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null);
  const [annotating, setAnnotating] = useState<Annotating | null>(null);

  const attachments: Attachment[] = [
    ...(extra ? [extra] : []),
    ...(annotatedPhoto ? [{ id: "photo", src: annotatedPhoto, label: "Photo" }] : []),
    ...referenceImages.map((src, index) => ({ id: `ref-${index}`, src, label: "Ref" })),
  ];

  const addReferenceImages = useCallback(
    async (files: File[]) => {
      try {
        const compressed = await Promise.all(files.map(compressImage));
        setReferenceImages((current) => [...current, ...compressed]);
      } catch (err) {
        onError?.(err instanceof Error ? err.message : "Could not read those files");
      }
    },
    [onError]
  );

  const removeAttachment = useCallback(
    (attachment: Attachment) => {
      if (extra && attachment.id === extra.id) return onRemoveExtra?.();
      if (attachment.id === "photo") return setAnnotatedPhoto(null);
      const index = Number(attachment.id.replace("ref-", ""));
      setReferenceImages((current) => current.filter((_, i) => i !== index));
    },
    [extra, onRemoveExtra]
  );

  /** Maps a chip back to the slot its annotated copy should be written into. */
  const targetForAttachment = useCallback(
    (attachment: Attachment): AnnotationTarget =>
      attachment.id === "photo" || (extra && attachment.id === extra.id)
        ? "photo"
        : { ref: Number(attachment.id.replace("ref-", "")) },
    [extra]
  );

  /** Opens the annotation editor on whichever chip was previewed. */
  const annotatePreview = useCallback(() => {
    if (!previewAttachment) return;
    setAnnotating({ src: previewAttachment.src, target: targetForAttachment(previewAttachment) });
    setPreviewAttachment(null);
  }, [previewAttachment, targetForAttachment]);

  /** Writes a marked-up copy back into the slot it was opened from. */
  const saveAnnotation = useCallback(
    (marked: string) => {
      const target = annotating?.target;
      if (target === "photo") {
        if (onSavePhoto) onSavePhoto(marked);
        else setAnnotatedPhoto(marked);
      } else if (target && target !== "stage") {
        setReferenceImages((current) => current.map((src, i) => (i === target.ref ? marked : src)));
      }
      setAnnotating(null);
    },
    [annotating, onSavePhoto]
  );

  const reset = useCallback(() => {
    setReferenceImages([]);
    setAnnotatedPhoto(null);
    setPreviewAttachment(null);
    setAnnotating(null);
  }, []);

  return {
    attachments,
    referenceImages,
    setReferenceImages,
    annotatedPhoto,
    setAnnotatedPhoto,
    previewAttachment,
    setPreviewAttachment,
    annotating,
    setAnnotating,
    addReferenceImages,
    removeAttachment,
    annotatePreview,
    saveAnnotation,
    reset,
  };
}

export type AttachmentsController = ReturnType<typeof useAttachments>;
