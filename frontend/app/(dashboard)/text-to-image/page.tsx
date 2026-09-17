"use client";

import { useState } from "react";
import { Wand2 } from "lucide-react";
import { ImageCountSelector } from "@/components/studio/ImageCountSelector";
import { SpellCheckedTextarea } from "@/components/studio/SpellCheckedTextarea";
import { GenerationResults } from "@/components/studio/GenerationResults";
import { InlineModelSelect } from "@/components/studio/InlineModelSelect";
import { OptionChips } from "@/components/studio/OptionChips";
import { AspectChips } from "@/components/studio/AspectChips";
import { JewelryBuilder, JewelrySelectionChips, useJewelryBuilder } from "@/components/studio/JewelryBuilder";
import { ToolHeader } from "@/components/studio/ToolHeader";
import {
  textToImage,
  refineTextToImage,
  resolveModelId,
  SPARKLE_MODELS,
  DEFAULT_SPARKLE_MODEL,
  toModelOptions,
  type SparkleModelId,
} from "@/lib/api";
import {
  ASPECTS,
  STYLES,
  TEXT_COUNT_OPTIONS,
  DEFAULT_IMAGE_COUNT,
  type AspectId,
  type StyleId,
} from "@/lib/jewelryConfigurator";
import { useGenerationWorkspace } from "@/lib/useGenerationWorkspace";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/permissions";

const PERMISSION = "tool.text_to_image.run";
const MODEL_OPTIONS = toModelOptions(SPARKLE_MODELS);

const REFINE_HINTS = [
  "Change metal to rose gold",
  "Make the center stone larger",
  "Add a halo of diamonds",
  "Brighter studio lighting",
];

export default function TextToImagePage() {
  const { user } = useAuth();

  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState<StyleId>("product-studio");
  const [aspect, setAspect] = useState<AspectId>("square");
  const [model, setModel] = useState<SparkleModelId>(DEFAULT_SPARKLE_MODEL);
  const [count, setCount] = useState<number>(DEFAULT_IMAGE_COUNT);
  const [spellIssueCount, setSpellIssueCount] = useState(0);

  const builder = useJewelryBuilder();
  const workspace = useGenerationWorkspace({
    tool: "text_to_image",
    onRefine: (body) => refineTextToImage({ ...body, model }),
    // Reopening a thread puts the picker back on whatever it was last run on,
    // so a refinement continues on the same model rather than silently
    // switching to this page's default.
    onResume: ({ model: resumed }) => {
      const id = resolveModelId(SPARKLE_MODELS, resumed);
      if (id) setModel(id);
    },
  });

  // The builder and the free text are independent: either can be used alone,
  // and typing never clobbers a selection or the other way round.
  const finalDescription = [builder.text, prompt.trim()].filter(Boolean).join(", ");

  if (!can(user, PERMISSION)) {
    return (
      <div className="flex-1 overflow-y-auto px-6 py-8 sm:px-8">
        <p className="text-sm text-muted">
          Text to Image isn&apos;t enabled for your account. Ask an admin to grant you access.
        </p>
      </div>
    );
  }

  function handleGenerate() {
    workspace.generate(() => textToImage({ prompt: finalDescription, model, style, aspect, count }), {
      count,
      prompt: finalDescription,
    });
  }

  if (workspace.status !== "idle") {
    return (
      <GenerationResults
        workspace={workspace}
        modelOptions={MODEL_OPTIONS}
        modelValue={model}
        onModelChange={setModel}
        hints={REFINE_HINTS}
        busyLabel={`Generating ${count > 1 ? `${count} images` : "image"}…`}
        resetLabel="New image"
        downloadName="generated.png"
        modelLabel={SPARKLE_MODELS.find((entry) => entry.id === model)?.label}
      />
    );
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <ToolHeader />
      {workspace.error && (
        <p className="shrink-0 border-b border-error/20 bg-error/[0.08] px-5 py-2 text-xs text-error">
          {workspace.error}
        </p>
      )}

      <div className="flex flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
        <JewelryBuilder builder={builder} subtitle="Select to build description" onClear={() => setPrompt("")} />

        <div className="flex-1 space-y-5 px-4 py-5 sm:px-6 md:overflow-y-auto md:px-4">
          <OptionChips label="Visual Style" options={STYLES} value={style} onChange={setStyle} />
          <AspectChips options={ASPECTS} value={aspect} onChange={setAspect} />
          <JewelrySelectionChips builder={builder} />

          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-cream">Description</p>
              <div className="flex shrink-0 items-center gap-2">
                {spellIssueCount > 0 && (
                  <span className="text-[10px] text-red-400/70">
                    {spellIssueCount} spelling{spellIssueCount > 1 ? "s" : ""}
                  </span>
                )}
                <span className="text-[10px] text-faint">{prompt.length}/3000</span>
              </div>
            </div>

            <div className="rounded-xl border border-white/[0.08] bg-surface-raised transition-colors focus-within:border-gold/30">
              <SpellCheckedTextarea
                value={prompt}
                onChange={setPrompt}
                rows={4}
                maxLength={3000}
                // Phrased without a direction: the builder is to the left on a
                // desktop and above on a phone.
                placeholder="Pick options in the Jewelry Builder, or type freely…"
                onIssueCount={setSpellIssueCount}
              />

              <div className="flex flex-wrap items-center justify-between gap-2 rounded-b-xl border-t border-white/[0.06] bg-surface-raised/60 px-3 py-2.5">
                <ImageCountSelector count={count} onChange={setCount} options={TEXT_COUNT_OPTIONS} />
                <InlineModelSelect models={SPARKLE_MODELS} value={model} onChange={setModel} showQuality />
              </div>
            </div>

            <button
              type="button"
              onClick={handleGenerate}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-gold/30 bg-gold/15 px-4 text-xs font-semibold text-gold transition-colors hover:bg-gold/25"
            >
              <Wand2 size={14} />
              {count > 1 ? `Generate ${count} images` : "Generate image"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
