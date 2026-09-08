"use client";

import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * A centred dialog over a dimmed page. Portalled to <body> so it escapes the
 * table it is usually opened from — a <div> inside a <tbody> is invalid HTML
 * and React refuses to hydrate it.
 */
export function Modal({
  onClose,
  className = "max-w-lg",
  children,
}: {
  onClose: () => void;
  /** Width of the panel. Defaults to a narrow dialog. */
  className?: string;
  children: ReactNode;
}) {
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 px-4 py-10 sm:items-center"
      onClick={onClose}
    >
      {/* Clicks inside the panel must not reach the backdrop's close handler. */}
      <div
        className={`w-full rounded-xl bg-surface-deep shadow-2xl ${className}`}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
