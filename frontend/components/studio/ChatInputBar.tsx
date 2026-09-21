"use client";

import { useRef, type ClipboardEvent } from "react";
import { ImagePlus, Send, Loader2 } from "lucide-react";
import { AttachmentChips, type Attachment } from "./AttachmentChips";
import { SpellCheckedTextarea } from "./SpellCheckedTextarea";
import { InlineDropdown } from "./InlineDropdown";
import { cn } from "@/lib/utils";

/**
 * The composer for a chat-style edit tool — a growing textarea, whatever is
 * staged above it as chips, an attach button for reference images, a model
 * picker, and send. Shared across any tool built as a chat, the same way
 * `ChatMessages` is; a route decides what "attach" produces (references
 * only, today) and what the model options are.
 */
export function ChatInputBar<TModel extends string>({
  value,
  onChange,
  onSend,
  busy,
  attachments,
  onOpenAttachment,
  onRemoveAttachment,
  onAttachFiles,
  onPasteImage,
  modelOptions,
  modelValue,
  onModelChange,
  qualityValue,
  onQualityChange,
  placeholder = "Describe a change… or paste/attach reference images",
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  busy?: boolean;
  attachments: Attachment[];
  onOpenAttachment: (attachment: Attachment) => void;
  onRemoveAttachment: (attachment: Attachment) => void;
  /** Files picked via the attach button — always treated as reference images. */
  onAttachFiles: (files: File[]) => void;
  /** An image pasted straight into the textarea. */
  onPasteImage: (file: File) => void;
  modelOptions: readonly {
    value: TModel;
    label: string;
    quality?: string;
    qualities?: readonly string[];
  }[];
  modelValue: TModel;
  onModelChange: (value: TModel) => void;
  /**
   * The chosen output size. Omitting `onQualityChange` keeps the slot
   * read-only, which is what cleaning's refinement bar wants — that tool
   * always runs at the model's best and offers no choice.
   */
  qualityValue?: string;
  onQualityChange?: (quality: string) => void;
  placeholder?: string;
}) {
  const selected = modelOptions.find((option) => option.value === modelValue);
  const qualityOptions = selected?.qualities ?? [];
  const quality = qualityValue ?? selected?.quality;
  const qualitySelectable = Boolean(onQualityChange) && qualityOptions.length > 1;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canSend = (value.trim() !== "" || attachments.length > 0) && !busy;

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const imageItem = [...event.clipboardData.items].find((item) => item.type.startsWith("image/"));
    if (!imageItem) return; // let normal text paste through
    const file = imageItem.getAsFile();
    if (file) {
      event.preventDefault();
      onPasteImage(file);
    }
  }

  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] transition-colors focus-within:border-gold/30">
      <AttachmentChips attachments={attachments} onOpen={onOpenAttachment} onRemove={onRemoveAttachment} />

      <SpellCheckedTextarea
        value={value}
        onChange={onChange}
        onPaste={handlePaste}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            if (canSend) onSend();
          }
        }}
        rows={2}
        autoGrowMaxHeight={160}
        placeholder={placeholder}
        disabled={busy}
        textClassName="w-full px-3 pb-1 pt-2.5 text-xs leading-relaxed whitespace-pre-wrap break-words"
      />

      <div className="flex items-end justify-between gap-1.5 px-2 pb-2 pt-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            title="Attach a reference image"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-faint transition-colors hover:border-white/[0.08] hover:bg-white/[0.06] hover:text-cream disabled:opacity-40"
          >
            <ImagePlus size={15} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => {
              const files = event.target.files ? [...event.target.files] : [];
              if (files.length) onAttachFiles(files);
              event.target.value = "";
            }}
          />

          <InlineDropdown
            label="Model"
            value={modelValue}
            onChange={onModelChange}
            disabled={busy}
            options={modelOptions.map((option) => ({ value: option.value, label: option.label }))}
            triggerClassName="max-w-[150px] sm:max-w-[170px]"
            panelClassName="w-[190px]"
          />

          {qualitySelectable ? (
            <InlineDropdown
              label="Quality"
              value={quality ?? ""}
              onChange={(next) => onQualityChange?.(next)}
              disabled={busy}
              options={qualityOptions.map((option) => ({ value: option, label: option }))}
              panelClassName="w-[92px]"
            />
          ) : (
            quality && (
              <div className="flex shrink-0 flex-col items-start gap-0.5 rounded-lg border border-white/[0.07] bg-white/[0.04] px-2 py-1">
                <span className="text-[8px] font-semibold uppercase leading-none tracking-wide text-faint">Quality</span>
                <span className="text-[10px] font-medium text-cream">{quality}</span>
              </div>
            )
          )}
        </div>

        <button
          type="button"
          onClick={onSend}
          disabled={!canSend}
          title="Send"
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors",
            canSend ? "bg-gold/15 text-gold hover:bg-gold/25" : "cursor-not-allowed text-faint/60"
          )}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        </button>
      </div>
    </div>
  );
}
