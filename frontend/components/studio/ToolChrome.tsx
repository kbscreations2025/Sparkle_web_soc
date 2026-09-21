"use client";

import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useEscapeKey } from "@/lib/useEscapeKey";
import { cn } from "@/lib/utils";

/**
 * The furniture every tool page is built from.
 *
 * Each of these was copied into ten or more pages as a class string, which
 * is how they drifted apart — three paddings for the same banner, two
 * heights for the same button. They are one implementation here, so a change
 * to how a tool page looks is a change in one place.
 */

/** The strip a tool shows when a run fails. Renders nothing without a message. */
export function ErrorBanner({ message }: { message?: string | null }) {
  if (!message) return null;

  return (
    <p className="shrink-0 border-b border-error/20 bg-error/[0.08] px-4 py-2 text-xs text-error sm:px-5">{message}</p>
  );
}

/**
 * A tool's primary action — the full-width gold button at the foot of its
 * options.
 *
 * `min-h-11` rather than a vertical padding: 44px is the touch target a
 * phone needs, and a padding that happens to add up to it on one page and
 * not another is what the copies were doing.
 */
export function RunButton({
  onClick,
  disabled,
  icon,
  children,
  className,
}: {
  onClick: () => void;
  disabled?: boolean;
  /** Shown before the label — a spinner while busy, otherwise the tool's own. */
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-gold/30 bg-gold/15 px-4",
        "text-xs font-semibold text-gold transition-colors hover:bg-gold/25 disabled:opacity-50",
        className
      )}
    >
      {icon}
      {children}
    </button>
  );
}

/**
 * A yes/no over the page, for a choice that is awkward to undo.
 *
 * Portalled to <body> so a page's scroll containers can neither clip it nor
 * scroll it away; closes on Escape or the backdrop, and the confirming
 * button takes focus so Enter answers it.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  /** Colours the confirming button as a destructive action. */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEscapeKey(onCancel);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-sm space-y-3 rounded-xl border border-white/[0.08] bg-surface-deep p-4 shadow-2xl"
      >
        <p className="text-sm font-semibold text-cream">{title}</p>
        <p className="text-[12px] leading-relaxed text-faint">{body}</p>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-9 rounded-lg border border-white/[0.08] px-3 text-xs font-medium text-muted transition-colors hover:border-white/[0.16] hover:text-cream"
          >
            Cancel
          </button>
          <button
            autoFocus
            type="button"
            onClick={onConfirm}
            className={cn(
              "min-h-9 rounded-lg border px-3 text-xs font-semibold transition-colors",
              danger
                ? "border-error/40 bg-error/15 text-error hover:bg-error/25"
                : "border-gold/30 bg-gold/15 text-gold hover:bg-gold/25"
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
