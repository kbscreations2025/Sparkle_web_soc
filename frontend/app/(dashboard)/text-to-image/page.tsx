"use client";

import { useState } from "react";
import { Wand2 } from "lucide-react";
import { ImageCountSelector } from "@/components/studio/ImageCountSelector";
import { PromptCard } from "@/components/studio/PromptCard";
import { ErrorBanner, RunButton } from "@/components/studio/ToolChrome";
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
import { ToolAccessNotice } from "@/components/studio/ToolAccessNotice";

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
    return <ToolAccessNotice tool="Text to Image" />;
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
      <ErrorBanner message={workspace.error} />

      <div className="flex flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
        <JewelryBuilder builder={builder} subtitle="Select to build description" onClear={() => setPrompt("")} />

        <div className="flex-1 space-y-5 px-4 py-5 sm:px-6 md:overflow-y-auto md:px-4">
          <OptionChips label="Visual Style" options={STYLES} value={style} onChange={setStyle} />
          <AspectChips options={ASPECTS} value={aspect} onChange={setAspect} />
          <JewelrySelectionChips builder={builder} />

          <div className="space-y-1">
            <PromptCard
              label="Description"
              value={prompt}
              onChange={setPrompt}
              rows={4}
              // Phrased without a direction: the builder is to the left on a
              // desktop and above on a phone.
              placeholder="Pick options in the Jewelry Builder, or type freely…"
              onIssueCount={setSpellIssueCount}
              aside={
                spellIssueCount > 0 && (
                  <span className="shrink-0 text-[10px] text-red-400/70">
                    {spellIssueCount} spelling{spellIssueCount > 1 ? "s" : ""}
                  </span>
                )
              }
              footerStart={<ImageCountSelector count={count} onChange={setCount} options={TEXT_COUNT_OPTIONS} />}
              footerEnd={<InlineModelSelect models={SPARKLE_MODELS} value={model} onChange={setModel} showQuality />}
            />

            <RunButton onClick={handleGenerate} icon={<Wand2 size={14} />}>
              {count > 1 ? `Generate ${count} images` : "Generate image"}
            </RunButton>
          </div>
        </div>
      </div>
    </div>
  );
}
