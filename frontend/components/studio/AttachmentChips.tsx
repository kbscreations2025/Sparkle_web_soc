"use client";

import Image from "next/image";
import { X } from "lucide-react";

export type Attachment = { id: string; src: string; label: string };

/**
 * The row of small thumbnails above a chat input — whatever is staged for
 * the next send. Each chip is just a labelled, removable, clickable image;
 * what the label means (a staged first photo vs. a reference) is entirely up
 * to the caller.
 */
export function AttachmentChips({
  attachments,
  onOpen,
  onRemove,
}: {
  attachments: Attachment[];
  onOpen: (attachment: Attachment) => void;
  onRemove: (attachment: Attachment) => void;
}) {
  if (attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
      {attachments.map((attachment) => (
        <div key={attachment.id} className="group relative">
          <button
            type="button"
            onClick={() => onOpen(attachment)}
            className="block h-12 w-12 overflow-hidden rounded-lg border border-white/10"
          >
            <Image src={attachment.src} alt={attachment.label} width={48} height={48} className="h-full w-full object-cover" />
          </button>
          <span className="absolute -top-1.5 left-0.5 rounded-full border border-white/10 bg-surface-deep px-1 py-0 text-[8px] font-semibold uppercase tracking-wide text-faint">
            {attachment.label}
          </span>
          <button
            type="button"
            onClick={() => onRemove(attachment)}
            title={`Remove ${attachment.label}`}
            className="absolute -right-1 -top-1 rounded-full bg-black/70 p-0.5 text-white/80 opacity-0 transition-opacity hover:text-white group-hover:opacity-100"
          >
            <X size={10} />
          </button>
        </div>
      ))}
    </div>
  );
}
