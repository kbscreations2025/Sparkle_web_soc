"use client";

import { ChatMessages } from "./ChatMessages";
import { ErrorBanner } from "./ToolChrome";
import { ChatInputBar } from "./ChatInputBar";
import { GenerationStage } from "./GenerationStage";
import { StudioSplitLayout } from "./StudioSplitLayout";
import { AnnotationOverlay } from "./AnnotationOverlay";
import { AnnotationLayer } from "./AnnotationLayer";
import { ToolHeader } from "./ToolHeader";
import { ReadOnlyChatNotice } from "./ReadOnlyChatNotice";
import type { useGenerationWorkspace } from "@/lib/useGenerationWorkspace";

/**
 * The screen every generate-then-refine tool shows once it has run: the result
 * on the stage, and the conversation that produced it beside it.
 *
 * Identical across the tools — only the words differ — so it is assembled once
 * here from the same pieces each page used to wire up for itself.
 */
export function GenerationResults<TModel extends string>({
  workspace,
  modelOptions,
  modelValue,
  onModelChange,
  qualityValue,
  onQualityChange,
  hints,
  busyLabel,
  resetLabel = "Start over",
  downloadName = "generated.png",
  modelLabel,
}: {
  workspace: ReturnType<typeof useGenerationWorkspace>;
  modelOptions: readonly {
    value: TModel;
    label: string;
    quality?: string;
    qualities?: readonly string[];
  }[];
  modelValue: TModel;
  onModelChange: (value: TModel) => void;
  /** The output size for a refinement — see ChatInputBar. */
  qualityValue?: string;
  onQualityChange?: (quality: string) => void;
  /** Suggestions offered until the first refinement comes back. */
  hints?: string[];
  busyLabel: string;
  resetLabel?: string;
  downloadName?: string;
  /** Shown as a badge beside the result count. */
  modelLabel?: string;
}) {
  const {
    images,
    liveImages,
    deliveredCount,
    displayImg,
    tileCount,
    isGenerating,
    error,
    history,
    chatInput,
    setChatInput,
    refining,
    lightboxSrc,
    setLightboxSrc,
    setSelectedView,
    attach,
    refine,
    reset,
    retry,
    readOnly,
  } = workspace;

  const { annotating, setAnnotating } = attach;

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <ToolHeader onReset={reset} resetLabel={resetLabel} />
      <ErrorBanner message={error} />

      <StudioSplitLayout
        chatRail={
          <>
            <div className="flex shrink-0 items-center justify-between gap-2 px-3 pb-0.5 pt-3">
              <p className="text-[10px] font-medium uppercase tracking-widest text-faint">
                Generated{" "}
                {tileCount > 0 && (
                  <span className="normal-case tracking-normal text-faint/60">
                    {/* While running this counts what has actually come back,
                        not what has been stored — so it agrees with the tiles
                        on screen rather than staying at 0 until the end. */}
                    ({Math.max(images.length, liveImages.length, deliveredCount)}/{tileCount}
                    {isGenerating ? " · generating…" : ""})
                  </span>
                )}
              </p>
              {modelLabel && (
                <span className="shrink-0 rounded-full border border-gold/[0.18] bg-gold/[0.08] px-2 py-0.5 text-[9px] font-semibold leading-none text-gold/80">
                  {modelLabel}
                </span>
              )}
            </div>

            {/* The request opens the thread and the results answer it, so the
                whole exchange reads top to bottom in one place. */}
            <ChatMessages
              history={history}
              busy={refining || isGenerating}
              busyCount={isGenerating ? tileCount : 1}
              busyImages={liveImages}
              selectedSrc={displayImg}
              onSelectResult={setSelectedView}
              // A colleague's thread is for reading: nothing here may send a turn.
              onRetry={readOnly ? undefined : retry}
              hints={!readOnly && displayImg && !history.some((msg) => msg.role === "assistant") ? hints : undefined}
              onHint={(hint) => refine(hint)}
            />

            <div className="shrink-0 border-t border-white/[0.06] p-3">
              {readOnly ? (
                <ReadOnlyChatNotice ownerName={readOnly.ownerName} />
              ) : (
              <ChatInputBar
                value={chatInput}
                onChange={setChatInput}
                onSend={() => refine(chatInput)}
                busy={refining || !displayImg}
                attachments={attach.attachments}
                onOpenAttachment={attach.setPreviewAttachment}
                onRemoveAttachment={attach.removeAttachment}
                onAttachFiles={attach.addReferenceImages}
                onPasteImage={(file) => attach.addReferenceImages([file])}
                modelOptions={modelOptions}
                modelValue={modelValue}
                onModelChange={onModelChange}
                qualityValue={qualityValue}
                onQualityChange={onQualityChange}
                placeholder={displayImg ? "Describe a change…" : "Waiting for the first result…"}
              />
              )}
            </div>
          </>
        }
        stage={
          <>
            <GenerationStage
              src={displayImg}
              // Only "busy" until the first image lands. After that the stage
              // has something real to show, and dimming it behind a spinner
              // would hide the very thing the user has been waiting for — the
              // rail's "(1/4 · generating…)" carries on saying the rest is
              // still coming.
              busy={isGenerating && liveImages.length === 0}
              busyLabel={busyLabel}
              emptyLabel="Nothing yet"
              downloadName={downloadName}
              onExpand={annotating ? undefined : setLightboxSrc}
              // Marking up an image only makes sense as the start of a turn.
              onAnnotate={readOnly || annotating || !displayImg ? undefined : (src) => setAnnotating({ src, target: "stage" })}
            />

            {annotating && annotating.target === "stage" && (
              <AnnotationOverlay
                src={annotating.src}
                onAttach={attach.saveAnnotation}
                onClose={() => setAnnotating(null)}
              />
            )}
          </>
        }
      />

      <AnnotationLayer attachments={attach} lightboxSrc={lightboxSrc} onCloseLightbox={() => setLightboxSrc(null)} />
    </div>
  );
}
