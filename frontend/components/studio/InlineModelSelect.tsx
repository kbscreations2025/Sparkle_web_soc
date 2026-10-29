"use client";

import { InlineDropdown } from "@/components/studio/InlineDropdown";

type Model = {
  id: string;
  label: string;
  quality: string;
  qualities?: readonly string[];
  /** Shown as the option's second line — see `InlineDropdown`. */
  description?: string;
  /** Which provider serves this model — see `InlineDropdown`'s `group`. */
  provider?: string;
  /** A short tag beside the label, e.g. "Recommended" — see `InlineDropdown`. */
  badge?: string;
};

/**
 * The compact model picker that sits in the footer of an input form.
 *
 * For where the model is a setting rather than a decision — every generation
 * tool had its own identical copy of this markup.
 *
 * `showQuality` adds the output size beside the model. It renders as a
 * dropdown when the selected model offers more than one size and as plain
 * text when it offers only one, so 2.5 Flash (1K only) shows a fact rather
 * than a one-option menu that looks like a choice.
 *
 * `quality`/`onQualityChange` are optional: without them the size is
 * read-only, which is what the tools that don't yet carry a quality in their
 * request still want.
 */
export function InlineModelSelect<TModel extends string>({
  models,
  value,
  onChange,
  showQuality = false,
  quality,
  onQualityChange,
  align = "left",
}: {
  models: readonly (Model & { id: TModel })[];
  value: TModel;
  onChange: (id: TModel) => void;
  showQuality?: boolean;
  quality?: string;
  onQualityChange?: (quality: string) => void;
  /** Which edge of the trigger the model list lines up with: "right" where the picker sits at the end of a bar, so the list opens inward. */
  align?: "left" | "right";
}) {
  const selected = models.find((model) => model.id === value);
  const options = selected?.qualities ?? [];
  // Falls back to the model's own default so the slot never renders empty
  // during the render between a model change and the parent resetting its
  // quality state.
  const current = quality ?? selected?.quality ?? "";
  const selectable = Boolean(onQualityChange) && options.length > 1;

  return (
    <div className="flex min-w-0 items-center gap-2">
      <InlineDropdown
        label="Model"
        value={value}
        onChange={onChange}
        options={models.map((model) => ({
          value: model.id,
          label: model.label,
          hint: model.description,
          group: model.provider,
          badge: model.badge,
        }))}
        align={align}
        triggerClassName="max-w-[150px] sm:max-w-[170px]"
        // Wider only when a badge shares the row, so the label isn't cut off.
        panelClassName={models.some((model) => model.badge) ? "w-[250px]" : "w-[210px]"}
      />

      {showQuality &&
        (selectable ? (
          <InlineDropdown
            label="Quality"
            value={current}
            onChange={(next) => onQualityChange?.(next)}
            options={options.map((option) => ({ value: option, label: option }))}
            // Right-aligned: it is the last control in the bar, so a
            // left-aligned panel would hang off the composer's edge.
            align="right"
            panelClassName="w-[92px]"
          />
        ) : (
          <div className="flex shrink-0 flex-col items-start gap-0.5 rounded-lg border border-white/[0.07] bg-white/[0.04] px-2 py-1">
            <span className="text-[8px] font-semibold uppercase leading-none tracking-wide text-faint">Quality</span>
            <span className="text-[10px] font-medium text-cream">{current}</span>
          </div>
        ))}
    </div>
  );
}
