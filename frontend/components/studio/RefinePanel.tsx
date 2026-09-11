"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import { Download, Paperclip, Send, Loader2 } from "lucide-react";
import { downloadImage } from "@/lib/image";
import { cn } from "@/lib/utils";

/**
 * The "chat to edit" sidebar every results screen shares: the original that
 * was sent in, one-click suggestions for common fixes, and a box to type a
 * change of your own — all feeding the same refine call.
 *
 * Nothing here is Image Cleaning-specific: a route supplies its own
 * `suggestions` and `modelOptions`, and this renders whatever it's given. A
 * tool with no useful suggestions can just pass `[]`.
 */
export function RefinePanel<TModel extends string>({
  original,
  suggestions,
  onSuggestion,
  value,
  onChange,
  onSubmit,
  busy,
  placeholder = "Describe a change…",
  modelOptions,
  modelValue,
  onModelChange,
  onAttach,
}: {
  original: { src: string; label?: string };
  /** One-click fixes, tried most often for this tool — clicking one submits immediately. */
  suggestions: string[];
  onSuggestion: (text: string) => void;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  busy?: boolean;
  placeholder?: string;
  modelOptions: readonly { value: TModel; label: string }[];
  modelValue: TModel;
  onModelChange: (value: TModel) => void;
  /** Omit to hide the attach button — not every tool accepts reference images. */
  onAttach?: () => void;
}) {
  const canSubmit = value.trim() !== "" && !busy;

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-faint">Original</h2>
          {original.label && (
            <span className="rounded-full border border-gold/25 bg-gold/10 px-2 py-0.5 text-[9px] font-semibold text-gold">
              {original.label}
            </span>
          )}
        </div>
        <div className="group relative h-16 w-16 overflow-hidden rounded-lg border border-white/10 bg-surface-raised">
          <Image src={original.src} alt="Original" fill sizes="64px" className="object-cover" />
          <button
            type="button"
            onClick={() => downloadImage(original.src, "original.jpg")}
            title="Download the original"
            className="absolute bottom-0.5 right-0.5 rounded-full bg-black/60 p-1 text-white/80 opacity-0 transition-opacity hover:text-white group-hover:opacity-100"
          >
            <Download size={11} />
          </button>
        </div>
      </div>

      {suggestions.length > 0 && (
        <div className="space-y-1.5">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-faint">Refine the result</h2>
          <div className="space-y-1.5">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => onSuggestion(suggestion)}
                disabled={busy}
                className="block w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-left text-[12px] text-gold transition-colors hover:bg-white/[0.07] disabled:opacity-50"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Pinned to the bottom of the column rather than following the content,
          so it stays reachable however long the suggestion list gets. */}
      <div className="mt-auto">
        <RefineComposer
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          busy={busy}
          canSubmit={canSubmit}
          placeholder={placeholder}
          modelOptions={modelOptions}
          modelValue={modelValue}
          onModelChange={onModelChange}
          onAttach={onAttach}
        />
      </div>
    </div>
  );
}

function RefineComposer<TModel extends string>({
  value,
  onChange,
  onSubmit,
  busy,
  canSubmit,
  placeholder,
  modelOptions,
  modelValue,
  onModelChange,
  onAttach,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  busy?: boolean;
  canSubmit: boolean;
  placeholder: string;
  modelOptions: readonly { value: TModel; label: string }[];
  modelValue: TModel;
  onModelChange: (value: TModel) => void;
  onAttach?: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Grows with the text rather than scrolling inside a fixed box. Capped so a
  // long paste can't push the model row off the bottom of the panel.
  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 160)}px`;
  }, [value]);

  return (
    <div className="rounded-xl border border-white/10 bg-surface-raised">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            if (canSubmit) onSubmit();
          }
        }}
        rows={2}
        placeholder={placeholder}
        disabled={busy}
        className="w-full resize-none bg-transparent px-3 pt-2.5 text-[12px] leading-relaxed text-cream placeholder:text-faint outline-none disabled:opacity-50"
      />

      <div className="flex items-center justify-between gap-2 px-2 pb-2 pt-1">
        <div className="flex items-center gap-1.5">
          {onAttach && (
            <button
              type="button"
              onClick={onAttach}
              disabled={busy}
              title="Attach a reference image"
              className="rounded-md p-1.5 text-faint transition-colors hover:bg-white/[0.07] hover:text-cream disabled:opacity-50"
            >
              <Paperclip size={13} />
            </button>
          )}

          <label className="flex items-center gap-1.5">
            <span className="text-[9px] font-semibold uppercase tracking-wider text-faint">Model</span>
            <select
              value={modelValue}
              onChange={(event) => onModelChange(event.target.value as TModel)}
              disabled={busy}
              className="rounded-md border border-white/10 bg-white/[0.06] px-1.5 py-1 text-[11px] text-cream outline-none transition-colors focus:border-gold/40 disabled:opacity-50"
            >
              {modelOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit}
          title="Send"
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors",
            canSubmit ? "bg-gold/20 text-gold hover:bg-gold/30" : "cursor-not-allowed bg-white/[0.04] text-faint"
          )}
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
        </button>
      </div>
    </div>
  );
}
