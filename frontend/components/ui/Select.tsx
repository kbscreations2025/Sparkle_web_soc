"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";
import { useDismissable } from "@/lib/useEscapeKey";
import { cn } from "@/lib/utils";

export type SelectOption = {
  value: string;
  label: ReactNode;
  /** Plain text to search on when `label` isn't a string. */
  text?: string;
  /** Renders a section header above the first option of each group. */
  group?: string;
};

/**
 * The app's one dropdown, in place of native `<select>`s — whose menus are
 * drawn by the OS, so they arrived in system colours and fonts on every page
 * that used one.
 *
 * The trigger takes whatever field styling the caller already had
 * (`className`), so it drops into a form or a table cell unchanged. The
 * panel is portalled to `<body>` and positioned from the trigger, because
 * these sit inside scrolling tables and animated modals that would clip or
 * offset an absolutely positioned one. A search box appears once the list
 * is long enough to need one.
 */
export function Select({
  value,
  options,
  onChange,
  disabled = false,
  className,
  panelClassName,
  ariaLabel,
  title,
  searchable,
  searchPlaceholder = "Search…",
}: {
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Trigger styling — the caller's existing field classes. */
  className?: string;
  panelClassName?: string;
  ariaLabel?: string;
  title?: string;
  /** Defaults to on for lists longer than eight. */
  searchable?: boolean;
  searchPlaceholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const withSearch = searchable ?? options.length > 8;
  const close = useCallback(() => setOpen(false), []);
  useDismissable(triggerRef, open, close, panelRef);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    if (withSearch) inputRef.current?.focus();
    // A fixed panel would be left behind by a scroll; closing is simpler and
    // matches how native selects behave. Scrolls inside the panel don't count.
    const onScroll = (event: Event) => {
      if (!panelRef.current?.contains(event.target as Node)) close();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open, withSearch, close]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    // Spaces also match underscores, so "new york" finds America/New_York.
    const alt = needle.replace(/\s+/g, "_");
    return options.filter((option) => {
      const hay = (option.text ?? (typeof option.label === "string" ? option.label : option.value)).toLowerCase();
      return hay.includes(needle) || hay.includes(alt);
    });
  }, [options, query]);

  const selected = options.find((option) => option.value === value);

  function toggle() {
    if (disabled) return;
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const width = Math.max(rect.width, 160);
      const left = Math.min(rect.left, window.innerWidth - width - 8);
      // Opens downward unless there isn't room for a reasonable panel.
      const below = window.innerHeight - rect.bottom > 260 || rect.top < 260;
      setPos(below ? { left, top: rect.bottom + 4, width } : { left, bottom: window.innerHeight - rect.top + 4, width });
    }
    setOpen((wasOpen) => !wasOpen);
  }

  function pick(next: string) {
    setOpen(false);
    if (next !== value) onChange(next);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={title}
        className={cn("flex items-center justify-between gap-1.5 text-left disabled:cursor-not-allowed", className)}
      >
        <span className="min-w-0 truncate">{selected?.label ?? value}</span>
        <ChevronDown size={12} className={cn("shrink-0 opacity-60 transition-transform", open && "rotate-180")} />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            style={{ left: pos.left, top: pos.top, bottom: pos.bottom, minWidth: pos.width }}
            className={cn(
              "fixed z-[100] flex max-h-[300px] max-w-[320px] flex-col overflow-hidden rounded-lg border border-white/10 bg-surface-raised text-cream shadow-lg",
              panelClassName
            )}
          >
            {withSearch && (
              <div className="flex items-center gap-1.5 border-b border-white/[0.06] px-2.5 py-1.5">
                <Search size={12} className="shrink-0 text-faint" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && filtered[0]) pick(filtered[0].value);
                  }}
                  placeholder={searchPlaceholder}
                  className="w-full bg-transparent text-xs text-cream outline-none placeholder:text-faint"
                />
              </div>
            )}
            <ul role="listbox" className="flex-1 overflow-y-auto py-1">
              {filtered.length === 0 && <li className="px-2.5 py-1.5 text-xs text-faint">No matches</li>}
              {filtered.map((option, index) => {
                const isSelected = option.value === value;
                const showGroup = option.group && option.group !== filtered[index - 1]?.group;
                return (
                  <li key={option.value}>
                    {showGroup && (
                      <p className="px-2.5 pb-1 pt-2 text-[9px] font-semibold uppercase tracking-wider text-faint">
                        {option.group}
                      </p>
                    )}
                    <button
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => pick(option.value)}
                      className={cn(
                        "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-white/[0.06]",
                        isSelected ? "bg-gold/[0.08] text-gold" : "text-cream"
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{option.label}</span>
                      <Check size={11} className={cn("shrink-0 text-gold", !isSelected && "invisible")} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>,
          document.body
        )}
    </>
  );
}
