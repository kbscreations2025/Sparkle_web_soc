"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";
import { createLookbook } from "@/lib/api";
import { publicUrl, slugify } from "@/lib/lookbook/slug";
import { blankDesign } from "@/lib/lookbook/blank";
import type { LookbookDesign } from "@/lib/lookbook/types";
import { useEscapeKey } from "@/lib/useEscapeKey";

/** What a new lookbook starts from: the blank page. */
export type LookbookStart = {
  /** Said in the dialog, e.g. "A clean page with one hero card." */
  describe: string;
  /** The lookbook's name, and so its link, when none is typed. */
  fallbackTitle: string;
  /** The page, given the name exactly as typed (empty when none was). */
  build: (typed: string) => LookbookDesign;
};

export const BLANK_START: LookbookStart = {
  describe: "A clean page with one hero card.",
  fallbackTitle: "Untitled lookbook",
  // The name typed becomes the hero's title, so the page opens already theirs.
  build: (typed) => blankDesign(typed),
};

/**
 * Naming a new lookbook (the name becomes its link), then opening it in the
 * builder. Used from the Live Lookbook page and from inside the builder.
 */
export function CreateLookbookDialog({
  start,
  onClose,
  heading = "Name your lookbook",
  note,
  beforeCreate,
  footer,
}: {
  start: LookbookStart;
  onClose: () => void;
  heading?: string;
  /** A line under the field. */
  note?: ReactNode;
  /**
   * Runs first; creating goes ahead only if it resolves true. The builder
   * saves the open lookbook here, so leaving it never loses an edit.
   */
  beforeCreate?: () => Promise<boolean>;
  /** Below the button, e.g. a link to somewhere else. */
  footer?: ReactNode;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEscapeKey(onClose, !busy);
  useEffect(() => input.current?.focus(), []);

  const title = name.trim() || start.fallbackTitle;
  const slug = slugify(title);

  async function create() {
    setBusy(true);
    setError("");
    if (beforeCreate && !(await beforeCreate())) {
      setBusy(false);
      setError("Couldn't save the lookbook you're editing, so nothing new was made. Check your connection and try again.");
      return;
    }
    const result = await createLookbook({ title, design: start.build(name) });
    if (result.status === "success" && result.lookbook) {
      router.push(`/live-lookbook/${result.lookbook.id}`);
      return;
    }
    setBusy(false);
    setError(result.message || "Couldn't create the lookbook. Try again.");
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[55] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-6" onClick={() => !busy && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={heading}
        onClick={(event) => event.stopPropagation()}
        className="animate-drawer-up w-full overflow-hidden rounded-t-2xl border border-white/[0.08] bg-surface-raised shadow-2xl sm:max-w-md sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5">
          <div>
            <p className="text-[15px] font-semibold text-cream">{heading}</p>
            <p className="mt-0.5 text-[12px] text-faint">{start.describe} The name becomes the link, and you can change both later.</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="text-faint hover:text-cream">
            <X size={16} />
          </button>
        </div>
        <form
          className="space-y-3 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <input
            ref={input}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={start.fallbackTitle}
            maxLength={120}
            aria-label="Lookbook name"
            className="h-11 w-full rounded-lg border border-white/[0.1] bg-white/[0.03] px-3 text-[14px] text-cream outline-none placeholder:text-faint focus:border-gold/50"
          />
          <p className="truncate text-[12px] text-muted">
            Link: <span className="text-cream">{publicUrl(slug || "lookbook")}</span>
          </p>
          {note && <p className="text-[12px] leading-relaxed text-faint">{note}</p>}
          {error && <p className="text-[12px] text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-gold text-[13px] font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
            Create and start editing
          </button>
          {footer}
        </form>
      </div>
    </div>,
    document.body
  );
}
