"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { ImagePlus, Pencil, X } from "lucide-react";
import { ImagePreviewLayer, type PreviewImage } from "@/components/studio/ImagePreviewLayer";
import { compressImage } from "@/lib/image";

/**
 * The optional "start from a photo" field the generate-from-text tools share
 * (Text to Image, Text to Sketch): pick a photo, see it as a thumbnail, open
 * it to preview or mark it up, or remove it. One component so both tools
 * behave identically.
 *
 * `useReferencePhoto` holds the value and the file reader, so a page can also
 * accept a pasted photo into the same slot.
 */
export function useReferencePhoto(onError: (message: string) => void) {
  const [photo, setPhoto] = useState<string | null>(null);

  async function pick(file: File) {
    try {
      setPhoto(await compressImage(file));
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not read that file");
    }
  }

  return { photo, setPhoto, pick };
}

export function ReferencePhotoField({
  photo,
  onPick,
  onChange,
}: {
  photo: string | null;
  onPick: (file: File) => void;
  /** Replaces the photo — with a marked-up copy, or null to remove it. */
  onChange: (photo: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<PreviewImage | null>(null);

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-cream">
        Reference Photo <span className="font-normal normal-case text-faint">(optional)</span>
      </p>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onPick(file);
          event.target.value = "";
        }}
      />
      {photo ? (
        <div className="relative inline-block">
          {/* Opens the same preview-and-annotate surface the results use, so
              a reference can be marked up before it is worked from. */}
          <button
            type="button"
            onClick={() => setPreview({ src: photo, key: "reference" })}
            title="Preview or annotate this reference"
            className="group relative block h-16 w-16 overflow-hidden rounded-lg border border-white/10 transition-colors hover:border-gold/40"
          >
            <Image src={photo} alt="Reference" fill sizes="64px" className="object-cover" />
            <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
              <Pencil size={13} className="text-white" />
            </span>
          </button>
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label="Remove reference"
            className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-white/10 bg-surface-float text-faint transition-colors hover:text-cream"
          >
            <X size={10} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2 text-[11px] text-muted transition-colors hover:border-white/[0.14] hover:text-cream"
        >
          <ImagePlus size={13} /> Start from a photo
        </button>
      )}

      <ImagePreviewLayer
        preview={preview}
        onClose={() => setPreview(null)}
        onSave={(marked) => onChange(marked)}
        downloadName="reference.jpg"
      />
    </div>
  );
}
