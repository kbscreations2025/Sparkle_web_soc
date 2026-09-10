"use client";

import { useRef, useState, type DragEvent } from "react";
import Image from "next/image";
import { ImagePlus, X } from "lucide-react";
import { cn } from "@/lib/utils";

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
}: {
  items: UploadItem[];
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function accept(fileList: FileList | null) {
    if (!fileList) return;
    const images = [...fileList].filter((file) => file.type.startsWith("image/"));
    if (images.length) onAdd(images);
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (!disabled) accept(event.dataTransfer.files);
  }

  return (
    <div className="space-y-3">
      <div
        onDrop={handleDrop}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onClick={() => !disabled && inputRef.current?.click()}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center transition-colors",
          dragging ? "border-gold/50 bg-gold/[0.06]" : "border-white/15 hover:border-gold/30 hover:bg-white/[0.03]",
          disabled && "pointer-events-none opacity-50"
        )}
      >
        <ImagePlus size={22} className="text-faint" />
        <p className="text-[13px] text-cream">Drop photos here, or click to choose</p>
        <p className="text-[11px] text-faint">
          JPG or PNG. Large photos are resized to 2048px before upload.
        </p>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => {
            accept(event.target.files);
            // Cleared so picking the same file twice still fires onChange.
            event.target.value = "";
          }}
        />
      </div>

      {items.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {items.map((item) => (
            <li
              key={item.id}
              className="group relative aspect-square overflow-hidden rounded-lg border border-white/10 bg-surface-raised"
            >
              <Image src={item.dataUrl} alt={item.name} fill sizes="120px" className="object-cover" />
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
    </div>
  );
}
