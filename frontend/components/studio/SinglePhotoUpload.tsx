"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { LibraryPicker } from "@/components/studio/LibraryPicker";
import { useLibraryPicker } from "@/lib/library";
import { cn } from "@/lib/utils";

/**
 * Where a box that takes one photo gets it from: the library for whoever has
 * it, the file dialog for everyone else — see `useLibraryPicker`. Every
 * one-photo box had its own copy of the hidden input and the dialog behind it.
 *
 * `onFile` gets the first file chosen, if any. Render `inputs` once, beside
 * the box that calls `show` rather than inside it, so neither the input's
 * `click()` nor an event bubbling up from the portalled dialog can reach the
 * box's own handlers.
 */
export function usePhotoPicker(onFile: (file: File | undefined) => void) {
  const input = useRef<HTMLInputElement>(null);
  // Earlier uploads and results as well as the disk — see UploadZone.
  const library = useLibraryPicker(input);

  const inputs = (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          onFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <LibraryPicker open={library.open} onClose={library.close} onFiles={(files) => onFile(files[0])} room={1} />
    </>
  );

  return { show: library.show, available: library.available, inputs };
}

/**
 * The empty box a one-photo tool opens with: click to upload or pick from the
 * library, or drop a photo on it. What it shows once the photo is in differs
 * from tool to tool, so that stays with the page.
 */
export function SinglePhotoUpload({
  subject = "a photo",
  hint,
  onFile,
}: {
  /** What to drop, as the box asks for it — "a product photo". */
  subject?: string;
  /** The line under the request — what the tool does with the photo. */
  hint: string;
  onFile: (file: File | undefined) => void;
}) {
  const picker = usePhotoPicker(onFile);
  const [dragging, setDragging] = useState(false);

  return (
    <>
      {picker.inputs}
      <button
        type="button"
        onClick={picker.show}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          onFile(event.dataTransfer.files?.[0]);
        }}
        className={cn(
          "flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-12 transition-colors",
          dragging ? "border-gold/40 bg-gold/[0.06]" : "border-white/[0.12] bg-white/[0.02] hover:border-white/25"
        )}
      >
        <Upload size={20} className="text-faint" />
        <p className="text-sm font-medium text-cream">
          {`Drop ${subject} here, or click to ${picker.available ? "upload or pick from your library" : "choose"}`}
        </p>
        <p className="text-[11px] text-faint">{hint}</p>
      </button>
    </>
  );
}
