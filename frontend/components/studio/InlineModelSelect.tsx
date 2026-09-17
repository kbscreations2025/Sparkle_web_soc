"use client";

import { ChevronDown } from "lucide-react";

type Model = { id: string; label: string; quality: string };

/**
 * The compact model picker that sits in the footer of an input form.
 *
 * Distinct from `ModelSelector`, which is the full card grid used where
 * choosing a model is the point of the screen. This is the version for where
 * it is a setting rather than a decision — every generation tool had its own
 * identical copy of this markup.
 *
 * `showQuality` adds the read-only quality of whatever is selected beside it;
 * the quality is a property of the model, so there is nothing to choose.
 */
export function InlineModelSelect<TModel extends string>({
  models,
  value,
  onChange,
  showQuality = false,
}: {
  models: readonly (Model & { id: TModel })[];
  value: TModel;
  onChange: (id: TModel) => void;
  showQuality?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <label className="flex min-w-0 flex-col items-start gap-0.5 rounded-lg border border-white/[0.07] bg-white/[0.04] px-2 py-1 transition-colors focus-within:border-gold/30 hover:border-white/[0.14]">
        <span className="text-[8px] font-semibold uppercase leading-none tracking-wide text-faint">Model</span>
        <span className="flex items-center gap-1">
          <select
            value={value}
            onChange={(event) => onChange(event.target.value as TModel)}
            aria-label="Model"
            className="-ml-0.5 w-full max-w-[112px] cursor-pointer appearance-none truncate bg-transparent text-[10px] font-medium text-cream outline-none sm:max-w-[128px]"
          >
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>
          <ChevronDown size={10} className="shrink-0 text-faint" />
        </span>
      </label>

      {showQuality && (
        <div className="flex shrink-0 flex-col items-start gap-0.5 rounded-lg border border-white/[0.07] bg-white/[0.04] px-2 py-1">
          <span className="text-[8px] font-semibold uppercase leading-none tracking-wide text-faint">Quality</span>
          <span className="text-[10px] font-medium text-cream">
            {models.find((model) => model.id === value)?.quality}
          </span>
        </div>
      )}
    </div>
  );
}
