"use client";

import { CLEANING_MODELS, type CleaningModelId } from "@/lib/api";
import { cn } from "@/lib/utils";

export function ModelSelector({
  value,
  onChange,
  disabled,
}: {
  value: CleaningModelId;
  onChange: (id: CleaningModelId) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {CLEANING_MODELS.map((model) => {
        const active = model.id === value;
        return (
          <button
            key={model.id}
            type="button"
            onClick={() => onChange(model.id)}
            disabled={disabled}
            aria-pressed={active}
            className={cn(
              "rounded-xl border p-3 text-left transition-colors disabled:opacity-50",
              active
                ? "border-gold/40 bg-gold/[0.08]"
                : "border-white/10 hover:border-gold/25 hover:bg-white/[0.03]"
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className={cn("text-[12px] font-semibold", active ? "text-gold" : "text-cream")}>
                {model.label}
              </span>
              <span className="shrink-0 rounded border border-white/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-faint">
                {model.quality}
              </span>
            </div>
            <p className="mt-1 text-[10px] text-faint">{model.description}</p>
            <p className="mt-1.5 text-[9px] font-semibold uppercase tracking-wider text-gold/70">
              {model.badge}
            </p>
          </button>
        );
      })}
    </div>
  );
}
