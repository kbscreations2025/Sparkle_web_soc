"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, Info } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * The builder's form controls, drawn in Sparkle's own colours (they sit in
 * the app, not on the page being built) and compact enough for a side panel.
 */

export function Section({ title, children, defaultOpen = true, aside }: { title: string; children: ReactNode; defaultOpen?: boolean; aside?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-white/[0.06] last:border-b-0">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <button type="button" onClick={() => setOpen((value) => !value)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          <ChevronDown size={13} className={cn("shrink-0 text-faint transition-transform", !open && "-rotate-90")} />
          <span className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">{title}</span>
        </button>
        {aside}
      </div>
      {open && <div className="space-y-2.5 px-3 pb-3">{children}</div>}
    </section>
  );
}

/** A small "i" that says in a tooltip what a setting does, so the panel itself stays short. */
export function Hint({ text }: { text: string }) {
  return (
    <span title={text} aria-label={text} tabIndex={0} className="inline-flex shrink-0 cursor-help text-faint outline-none hover:text-gold focus-visible:text-gold">
      <Info size={11} />
    </span>
  );
}

export function Field({ label, hint, children, inline = false }: { label: string; hint?: string; children: ReactNode; inline?: boolean }) {
  return (
    <div className={cn(inline ? "flex items-center justify-between gap-2" : "space-y-1")}>
      <div className={cn("flex min-w-0 items-center gap-1", inline && "flex-1")}>
        <p className="truncate text-[11px] font-medium text-cream">{label}</p>
        {hint && <Hint text={hint} />}
      </div>
      {children}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  columns,
}: {
  value: T;
  options: { id: T; label: ReactNode; title?: string }[];
  onChange: (value: T) => void;
  /** Wraps into a grid of this many columns instead of one row. */
  columns?: number;
}) {
  return (
    <div
      className={cn("gap-1 rounded-lg border border-white/[0.08] bg-white/[0.03] p-0.5", columns ? "grid" : "flex")}
      style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
      role="radiogroup"
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={value === option.id}
          title={option.title}
          onClick={() => onChange(option.id)}
          className={cn(
            "flex min-h-6 flex-1 items-center justify-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium transition-colors",
            value === option.id ? "bg-gold/15 text-gold shadow-[inset_0_0_0_1px_rgba(196,168,106,0.35)]" : "text-muted hover:text-cream"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Range({
  value,
  min,
  max,
  step = 1,
  onChange,
  format = (n) => String(n),
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="slim-range min-w-0 flex-1"
        style={{ ["--fill" as string]: `${Math.min(100, Math.max(0, fill))}%` }}
      />
      <span className="w-10 shrink-0 text-right text-[10px] tabular-nums text-muted">{format(value)}</span>
    </div>
  );
}

const HEX = /^#[0-9a-f]{6}$/i;

/** A colour: a swatch that opens the system picker, the hex value to type, and quick picks. */
export function ColorField({ value, onChange, swatches: offered = [], allowClear, clearLabel = "Default" }: { value: string | null; onChange: (value: string | null) => void; swatches?: string[]; allowClear?: boolean; clearLabel?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value ?? "";
  // Each colour once: a theme's background is often plain white, and its titles and accent can match.
  const swatches = [...new Map(offered.map((swatch) => [swatch.toUpperCase(), swatch])).values()];
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="relative h-7 w-7 shrink-0 cursor-pointer overflow-hidden rounded-md border border-white/15" style={{ background: value ?? "transparent" }}>
          {!value && <span className="absolute inset-0 bg-[linear-gradient(135deg,transparent_45%,rgba(220,60,60,0.7)_47%,rgba(220,60,60,0.7)_53%,transparent_55%)]" />}
          <input
            type="color"
            value={value && HEX.test(value) ? value : "#000000"}
            onChange={(event) => onChange(event.target.value.toUpperCase())}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
        <input
          type="text"
          value={shown}
          placeholder={allowClear ? clearLabel : "#000000"}
          spellCheck={false}
          onChange={(event) => {
            const text = event.target.value.trim();
            setDraft(text);
            if (HEX.test(text)) onChange(text.toUpperCase());
          }}
          onBlur={() => setDraft(null)}
          className="h-7 min-w-0 flex-1 rounded-md border border-white/[0.08] bg-white/[0.03] px-2 font-mono text-[11px] uppercase text-cream outline-none focus:border-gold/40"
        />
        {allowClear && value && (
          <button type="button" onClick={() => onChange(null)} className="shrink-0 text-[11px] text-faint hover:text-cream">
            Reset
          </button>
        )}
      </div>
      {swatches.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {swatches.map((swatch) => (
            <button
              key={swatch}
              type="button"
              title={swatch}
              onClick={() => onChange(swatch)}
              className={cn("h-4 w-4 rounded-full border border-black/15 transition-transform hover:scale-110", value?.toUpperCase() === swatch.toUpperCase() && "ring-2 ring-gold/70 ring-offset-1 ring-offset-surface-raised")}
              style={{ background: swatch }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", checked ? "bg-gold" : "bg-white/15")}
    >
      <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform", checked ? "translate-x-[18px]" : "translate-x-0.5")} />
    </button>
  );
}

export function TextInput({ value, onChange, placeholder, type = "text", prefix }: { value: string; onChange: (value: string) => void; placeholder?: string; type?: string; prefix?: ReactNode }) {
  return (
    <div className="flex h-7 items-center rounded-md border border-white/[0.08] bg-white/[0.03] focus-within:border-gold/40">
      {prefix && <span className="pl-2 text-[12px] text-faint">{prefix}</span>}
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-full min-w-0 flex-1 bg-transparent px-2 text-[11.5px] text-cream outline-none placeholder:text-faint"
      />
    </div>
  );
}

export function TextArea({ value, onChange, placeholder, rows = 3 }: { value: string; onChange: (value: string) => void; placeholder?: string; rows?: number }) {
  return (
    <textarea
      value={value}
      rows={rows}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className="w-full resize-y rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[11.5px] leading-relaxed text-cream outline-none placeholder:text-faint focus:border-gold/40"
    />
  );
}

export function Select<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (value: T) => void }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
      className="h-7 w-full rounded-md border border-white/[0.08] bg-surface-raised px-2 text-[11.5px] text-cream outline-none focus:border-gold/40"
    >
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
