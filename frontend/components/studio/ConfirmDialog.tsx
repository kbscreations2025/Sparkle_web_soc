"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";
import { useEscapeKey } from "@/lib/useEscapeKey";
import { cn } from "@/lib/utils";

/**
 * "Are you sure?" for an action that cannot be taken back.
 *
 * Its own component rather than `window.confirm`: the native dialog is
 * unstyled, blocks the whole tab, and on a destructive action gives the
 * primary position to OK — so the fastest thing to do is the irreversible
 * thing.
 *
 * Everything here leans the other way. Cancel is what the dialog opens
 * focused on, so Enter and Escape both mean "no" and only a deliberate move
 * to the other button means "yes". The confirm button carries the danger
 * colour, and the thing being destroyed is named in the body rather than
 * described as "this item" — a grid of near-identical tiles is exactly
 * where the wrong one gets deleted.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  busy = false,
  destructive = true,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Keeps the dialog up, and both buttons inert, while the action runs. */
  busy?: boolean;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Not while the action is running: closing then would leave the caller
  // waiting on a request whose dialog has already gone.
  useEscapeKey(onCancel, open && !busy);

  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={() => !busy && onCancel()}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-sm overflow-hidden rounded-2xl border border-white/[0.08] bg-surface-deep shadow-2xl"
      >
        <div className="space-y-2 px-5 pb-4 pt-5">
          <h2 className="text-sm font-semibold text-cream">{title}</h2>
          <div className="text-xs leading-relaxed text-muted">{message}</div>
        </div>

        <div className="flex justify-end gap-2 border-t border-white/[0.06] px-5 py-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="min-h-8 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-cream transition-colors hover:border-white/[0.16] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={cn(
              "flex min-h-8 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
              destructive
                ? "bg-error/80 text-white hover:bg-error"
                : "border border-gold/30 bg-gold/10 text-gold hover:bg-gold/15"
            )}
          >
            {busy && <Loader2 size={12} className="animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
