"use client";

import { useRef, useState, type DragEvent } from "react";
import Image from "next/image";
import { ImagePlus, Maximize2, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLibraryPicker } from "@/lib/library";
import { Lightbox } from "@/components/studio/Lightbox";
import { LibraryPicker } from "@/components/studio/LibraryPicker";

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
  /** How many more photos it takes — unset when there's no limit. */
  const room = max === undefined ? undefined : Math.max(0, max - items.length);
  const inputRef = useRef<HTMLInputElement>(null);
  /*
   * A click offers the library as well as the disk — earlier uploads and
   * results, picked back as files — while a drop still uploads straight
   * away. Someone without the grant gets the file dialog, as before.
   */
  const library = useLibraryPicker(inputRef);
  const [dragging, setDragging] = useState(false);
  // Every uploaded photo can be opened full-size to check what was picked.
  // A page passing `onPreview` keeps its own viewer; otherwise this one opens.
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const preview = (item: UploadItem) =>
    onPreview ? onPreview(item) : setPreviewSrc(item.dataUrl);
  const lightbox = (
    <Lightbox src={previewSrc} onClose={() => setPreviewSrc(null)} />
  );

  /** Files off the disk, dropped, or picked from the library — all the same from here on. */
  function accept(files: File[]) {
    const images = files.filter((file) =>
      file.type.startsWith("image/"),
    );
    const take = room ?? images.length;
    if (images.length && take) onAdd(images.slice(0, take));
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (!disabled) accept([...event.dataTransfer.files]);
  }

  /** The drop target's handlers and state classes — the same on the compact "+" tile and the full dropzone. */
  const dropTarget = {
    onDrop: handleDrop,
    onDragOver: (event: DragEvent) => {
      event.preventDefault();
      if (!disabled) setDragging(true);
    },
    onDragLeave: () => setDragging(false),
    onClick: () => !disabled && library.show(),
  };
  const dropTargetClass = [
    dragging ? "border-gold/50 bg-gold/[0.06]" : "border-white/15 hover:border-gold/30 hover:bg-white/[0.03]",
    disabled && "pointer-events-none opacity-50",
  ];

  /*
   * Only for someone without the library — the dialog has its own. Kept out
   * of the drop target so its `click()` can't bubble back into the target's
   * onClick and ask for the dialog again.
   */
  const input = (
    <input
      ref={inputRef}
      type="file"
      accept="image/*"
      multiple={max !== 1}
      hidden
      onChange={(event) => {
        accept([...(event.target.files ?? [])]);
        // Cleared so picking the same file twice still fires onChange.
        event.target.value = "";
      }}
    />
  );
  const picker = (
    <LibraryPicker
      open={library.open}
      onClose={library.close}
      onFiles={accept}
      room={room}
    />
  );

  // The input and the dialog come first in both layouts. Neither takes up any
  // room, but a hidden last child would still count as `:last-child` and give
  // the photos above it a stray margin from the page's `space-y`.
  if (compact) {
    return (
      <>
        {input}
        {picker}
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
              {...dropTarget}
              title={library.available ? "Add a photo — upload one, or pick from your library" : "Add a photo"}
              className={cn(
                "flex h-16 w-16 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-dashed transition-colors",
                dropTargetClass,
              )}
            >
              <Plus size={18} className="text-faint" />
            </div>
          </li>}
        </ul>
        {lightbox}
      </>
    );
  }

  return (
    <div className="space-y-3">
      {input}
      {picker}
      {!full && <div
        {...dropTarget}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center transition-colors",
          dropTargetClass,
        )}
      >
        <ImagePlus size={22} className="text-faint" />
        <p className="text-[13px] text-cream">
          {library.available
            ? "Drop photos here, or click to upload or pick from your library"
            : "Drop photos here, or click to choose"}
        </p>
        <p className="text-[11px] text-faint">
          JPG or PNG. Large photos are resized to 2048px before upload.
        </p>
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
