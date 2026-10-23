"use client";

import { useRef, useState, type DragEvent } from "react";
import Image from "next/image";
import { ImagePlus, Maximize2, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Lightbox } from "@/components/studio/Lightbox";

export type UploadItem = {
  id: string;
  name: string;
  /** Compressed data URI — what actually gets sent. */
  dataUrl: string;
};

export function UploadZone({
  items,
  onAdd,
  onRemove,
  disabled,
  compact,
  onPreview,
  max,
}: {
  items: UploadItem[];
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
  disabled?: boolean;
  /**
   * A small thumbnail-row layout instead of the full dashed dropzone — the
   * one already used for a single reference photo, extended here to hold
   * several. The full dropzone's help text ("Drop photos here…", the format
   * and resize note) doesn't fit a 64px tile, so once there's at least one
   * photo it steps aside for a same-size "+" tile instead. Only where a page
   * asks for it — the plain dropzone stays the default everywhere else.
   */
  compact?: boolean;
  /**
   * Opens a closer look at one compact thumbnail — the tile itself becomes a
   * button rather than a static image. Left unset, the tile is inert and
   * only the remove corner does anything, same as before this existed.
   */
  onPreview?: (item: UploadItem) => void;
  /**
   * The most photos it takes. Once reached, the drop target steps aside and
   * only the photos show — removing one brings it back. Unset is unlimited.
   */
  max?: number;
}) {
  const full = max !== undefined && items.length >= max;
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  // Every uploaded photo can be opened full-size to check what was picked.
  // A page passing `onPreview` keeps its own viewer; otherwise this one opens.
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const preview = (item: UploadItem) =>
    onPreview ? onPreview(item) : setPreviewSrc(item.dataUrl);
  const lightbox = (
    <Lightbox src={previewSrc} onClose={() => setPreviewSrc(null)} />
  );

  function accept(fileList: FileList | null) {
    if (!fileList) return;
    const images = [...fileList].filter((file) =>
      file.type.startsWith("image/"),
    );
    const room = max === undefined ? images.length : Math.max(0, max - items.length);
    if (images.length && room) onAdd(images.slice(0, room));
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (!disabled) accept(event.dataTransfer.files);
  }

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept="image/*"
      multiple={max !== 1}
      hidden
      onChange={(event) => {
        accept(event.target.files);
        // Cleared so picking the same file twice still fires onChange.
        event.target.value = "";
      }}
    />
  );

  if (compact) {
    return (
      <>
        <ul className="flex flex-wrap gap-2">
          {items.map((item) => (
            <li key={item.id} className="group relative h-16 w-16 shrink-0">
              <button
                type="button"
                onClick={() => preview(item)}
                title={`Preview ${item.name}`}
                className="block h-full w-full cursor-zoom-in overflow-hidden rounded-lg border border-white/10 bg-surface-raised"
              >
                <Image
                  src={item.dataUrl}
                  alt={item.name}
                  fill
                  sizes="64px"
                  className="object-cover"
                />
              </button>
              <button
                onClick={() => onRemove(item.id)}
                title={`Remove ${item.name}`}
                aria-label={`Remove ${item.name}`}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-white/10 bg-surface-float text-faint transition-colors hover:text-cream"
              >
                <X size={10} />
              </button>
            </li>
          ))}

          {!full && <li>
            <div
              onDrop={handleDrop}
              onDragOver={(event) => {
                event.preventDefault();
                if (!disabled) setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onClick={() => !disabled && inputRef.current?.click()}
              title="Add a photo"
              className={cn(
                "flex h-16 w-16 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-dashed transition-colors",
                dragging
                  ? "border-gold/50 bg-gold/[0.06]"
                  : "border-white/15 hover:border-gold/30 hover:bg-white/[0.03]",
                disabled && "pointer-events-none opacity-50",
              )}
            >
              <Plus size={18} className="text-faint" />
              {input}
            </div>
          </li>}
        </ul>
        {lightbox}
      </>
    );
  }

  return (
    <div className="space-y-3">
      {!full && <div
        onDrop={handleDrop}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onClick={() => !disabled && inputRef.current?.click()}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center transition-colors",
          dragging
            ? "border-gold/50 bg-gold/[0.06]"
            : "border-white/15 hover:border-gold/30 hover:bg-white/[0.03]",
          disabled && "pointer-events-none opacity-50",
        )}
      >
        <ImagePlus size={22} className="text-faint" />
        <p className="text-[13px] text-cream">
          Drop photos here, or click to choose
        </p>
        <p className="text-[11px] text-faint">
          JPG or PNG. Large photos are resized to 2048px before upload.
        </p>

        {input}
      </div>}

      {items.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {items.map((item) => (
            <li
              key={item.id}
              className="group relative aspect-square overflow-hidden rounded-lg border border-white/10 bg-surface-raised"
            >
              <button
                type="button"
                onClick={() => preview(item)}
                title={`Preview ${item.name}`}
                className="absolute inset-0 cursor-zoom-in"
              >
                <Image
                  src={item.dataUrl}
                  alt={item.name}
                  fill
                  sizes="120px"
                  className="object-cover"
                />
              </button>
              <button
                type="button"
                onClick={() => preview(item)}
                title={`Expand ${item.name}`}
                aria-label={`Expand ${item.name}`}
                className="absolute left-1 top-1 rounded-full bg-black/60 p-1 text-white/80 opacity-0 transition-opacity hover:text-white group-hover:opacity-100"
              >
                <Maximize2 size={12} />
              </button>
              <button
                onClick={() => onRemove(item.id)}
                title={`Remove ${item.name}`}
                aria-label={`Remove ${item.name}`}
                className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white/80 opacity-0 transition-opacity hover:text-white group-hover:opacity-100"
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {lightbox}
    </div>
  );
}
