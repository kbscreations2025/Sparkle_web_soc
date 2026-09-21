"use client";

import { useCallback, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown } from "lucide-react";
import { useDismissable } from "@/lib/useEscapeKey";
import { cn } from "@/lib/utils";

export type InlineOption<T extends string> = {
  value: T;
  label: string;
  /** A second line under the label — what the option is for. */
  hint?: string;
};

/**
 * The labelled pill in a composer footer that opens a panel of options.
 *
 * Replaces the native `<select>` these controls used to be. A native select
 * cannot be styled past its box: the menu it opens is drawn by the operating
 * system, so it arrived in the OS's own colours and typography in the middle
 * of a dark composer bar, and it had nowhere to put the per-option
 * description that makes "3.1 Flash" mean something. This draws the panel
 * itself, so the options match the app and can carry a hint line.
 *
 * Kept generic over the value because both pickers in a footer use it — the
 * model (long labels, hints) and the quality (three short ones).
 */
export function InlineDropdown<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  align = "left",
  triggerClassName,
  panelClassName,
}: {
  label: string;
  value: T;
  options: readonly InlineOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  /** Which edge the panel lines up with, so it can't overflow the bar. */
  align?: "left" | "right";
  triggerClassName?: string;
  panelClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);
  useDismissable(rootRef, open, close);

  const selected = options.find((option) => option.value === value);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        className={cn(
          "flex w-full min-w-0 flex-col items-start gap-0.5 rounded-lg border px-2 py-1 text-left transition-colors disabled:opacity-40",
          open ? "border-gold/30 bg-white/[0.06]" : "border-white/[0.07] bg-white/[0.04] hover:border-white/[0.14]",
          triggerClassName
        )}
      >
        <span className="text-[8px] font-semibold uppercase leading-none tracking-wide text-faint">{label}</span>
        <span className="flex w-full items-center gap-1">
          <span className="min-w-0 flex-1 truncate text-[10px] font-medium text-cream">
            {selected?.label ?? value}
          </span>
          <ChevronDown
            size={10}
            className={cn("shrink-0 text-faint transition-transform", open && "rotate-180")}
          />
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.ul
            role="listbox"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.13, ease: [0.22, 1, 0.36, 1] }}
            /*
             * Opens upward: every one of these sits in a composer footer at
             * the bottom of the viewport, where a downward panel would be
             * clipped. Solid rather than glass, for the reason given in
             * AccountMenu — a nested backdrop-filter composites unreliably.
             */
            className={cn(
              "absolute bottom-full z-30 mb-1.5 min-w-full overflow-hidden rounded-lg border border-white/10 bg-surface-raised py-1 shadow-lg",
              align === "right" ? "right-0" : "left-0",
              panelClassName
            )}
          >
            {options.map((option) => {
              const isSelected = option.value === value;
              return (
                <li key={option.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      onChange(option.value);
                      close();
                    }}
                    className={cn(
                      "flex w-full items-start gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-white/[0.06]",
                      isSelected && "bg-gold/[0.08]"
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "block truncate text-[11px] font-medium",
                          isSelected ? "text-gold" : "text-cream"
                        )}
                      >
                        {option.label}
                      </span>
                      {option.hint && (
                        <span className="mt-0.5 block text-[9px] leading-tight text-faint">{option.hint}</span>
                      )}
                    </span>
                    {/* Reserved whether or not it shows, so the labels of the
                        selected and unselected rows line up. */}
                    <Check
                      size={11}
                      className={cn("mt-0.5 shrink-0 text-gold", !isSelected && "invisible")}
                    />
                  </button>
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
