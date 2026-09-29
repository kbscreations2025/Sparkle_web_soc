"use client";

import type { ClipboardEvent, ReactNode } from "react";
import { SpellCheckedTextarea } from "./SpellCheckedTextarea";

/**
 * The box a tool's prompt is written into: a heading, a spell-checked
 * textarea, and a footer holding whatever settings belong to the run.
 *
 * Six pages had their own copy of this markup, which is why one of them was
 * still a plain textarea with no spell check long after the others had one.
 * The footer is a slot rather than fixed controls because that is the only
 * part that genuinely differs — an image count here, a model select there,
 * nothing at all on the video page, whose settings live in a card of their
 * own.
 */
export function PromptCard({
  label,
  value,
  onChange,
  placeholder,
  rows = 3,
  aside,
  footerStart,
  footerEnd,
  onIssueCount,
  onPasteImage,
}: {
  /** The heading above the box. A node, so a page can grey out "(optional)". */
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  /** Sits opposite the heading — e.g. Text to Image's spelling count. */
  aside?: ReactNode;
  /**
   * The row under the textarea: `footerStart` sits left, `footerEnd` right.
   * Omit both for a box with no settings of its own.
   */
  footerStart?: ReactNode;
  footerEnd?: ReactNode;
  onIssueCount?: (count: number) => void;
  /**
   * Diverts a pasted image away from the text entirely, to wherever the
   * caller wants it instead — e.g. Lifestyle's jewellery slot, so pasting a
   * photo here doesn't silently drop an unrenderable image into the prompt
   * text. Left unset, a pasted image behaves as plain paste always has:
   * nothing captured, browser default.
   */
  onPasteImage?: (file: File) => void;
}) {
  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    if (!onPasteImage) return;
    const imageItem = [...event.clipboardData.items].find((item) => item.type.startsWith("image/"));
    if (!imageItem) return; // let normal text paste through
    const file = imageItem.getAsFile();
    if (file) {
      event.preventDefault();
      onPasteImage(file);
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-cream">{label}</p>
        {aside}
      </div>

      <div className="rounded-xl border border-white/[0.08] bg-surface-raised transition-colors focus-within:border-gold/30">
        <SpellCheckedTextarea
          value={value}
          onChange={onChange}
          rows={rows}
          placeholder={placeholder}
          onIssueCount={onIssueCount}
          onPaste={onPasteImage ? handlePaste : undefined}
        />

        {(footerStart || footerEnd) && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-b-xl border-t border-white/[0.06] bg-surface-raised/60 px-3 py-2.5">
            {/* An empty span holds the left end, so a footer with only a
                model select still finds its right edge. */}
            {footerStart ?? <span />}
            {footerEnd}
          </div>
        )}
      </div>
    </div>
  );
}
