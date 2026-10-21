"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { ImagePlus, Pencil, Plus, X } from "lucide-react";
import { ImagePreviewLayer, type PreviewImage } from "@/components/studio/ImagePreviewLayer";
import { compressImage } from "@/lib/image";

/** Reference photos per run — several views of a piece, or pieces to combine. */
export const MAX_REFERENCE_PHOTOS = 4;

/**
 * The optional "start from photos" field the generate-from-text tools share
 * (Text to Image, Text to Sketch): pick one or more photos, see them as
 * thumbnails, open one to preview or mark it up, or remove it. One component
 * so both tools behave identically.
 *
 * `useReferencePhoto` holds the value and the file reader, so a page can also
 * accept a pasted photo into the same list. `photo` is the first one, for a
 * page that only needs to know whether there is any.
 */
export function useReferencePhoto(onError: (message: string) => void) {
  const [photos, setPhotos] = useState<string[]>([]);

  async function pick(file: File) {
    try {
      const photo = await compressImage(file);
      setPhotos((current) => {
        if (current.length >= MAX_REFERENCE_PHOTOS) {
          onError(`Up to ${MAX_REFERENCE_PHOTOS} reference photos — remove one to add another.`);
          return current;
        }
        return [...current, photo];
      });
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not read that file");
    }
  }

  return { photos, photo: photos[0] ?? null, setPhotos, pick };
}

export function ReferencePhotoField({
  photos,
  onPick,
  onChange,
}: {
  photos: string[];
  onPick: (file: File) => void;
  /** Replaces the list — with a marked-up copy of one, or with one removed. */
  onChange: (photos: string[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<PreviewImage | null>(null);
  const full = photos.length >= MAX_REFERENCE_PHOTOS;

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-cream">
        Reference Photos{" "}
        <span className="font-normal normal-case text-faint">
          (optional{photos.length > 0 ? ` · ${photos.length}/${MAX_REFERENCE_PHOTOS}` : `, up to ${MAX_REFERENCE_PHOTOS}`})
        </span>
      </p>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          Array.from(event.target.files ?? []).forEach((file) => onPick(file));
          event.target.value = "";
        }}
      />
      {photos.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {photos.map((photo, index) => (
            <div key={index} className="relative inline-block">
              {/* Opens the same preview-and-annotate surface the results use, so
                  a reference can be marked up before it is worked from. */}
              <button
                type="button"
                onClick={() => setPreview({ src: photo, key: String(index) })}
                title="Preview or annotate this reference"
                className="group relative block h-16 w-16 overflow-hidden rounded-lg border border-white/10 transition-colors hover:border-gold/40"
              >
                <Image src={photo} alt={`Reference ${index + 1}`} fill sizes="64px" className="object-cover" />
                <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
                  <Pencil size={13} className="text-white" />
                </span>
              </button>
              <button
                type="button"
                onClick={() => onChange(photos.filter((_, i) => i !== index))}
                aria-label={`Remove reference ${index + 1}`}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-white/10 bg-surface-float text-faint transition-colors hover:text-cream"
              >
                <X size={10} />
              </button>
            </div>
          ))}
          {!full && (
            <button
              type="button"
              onClick={() => input.current?.click()}
              title="Add another reference photo"
              aria-label="Add another reference photo"
              className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed border-white/[0.14] text-faint transition-colors hover:border-gold/40 hover:text-gold"
            >
              <Plus size={16} />
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2 text-[11px] text-muted transition-colors hover:border-white/[0.14] hover:text-cream"
        >
          <ImagePlus size={13} /> Start from photos
        </button>
      )}

      <ImagePreviewLayer
        preview={preview}
        onClose={() => setPreview(null)}
        onSave={(marked, key) => onChange(photos.map((photo, index) => (String(index) === key ? marked : photo)))}
        downloadName="reference.jpg"
      />
    </div>
  );
}
