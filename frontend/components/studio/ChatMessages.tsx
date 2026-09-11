"use client";

import Image from "next/image";
import { Download, RotateCcw } from "lucide-react";
import type { ChatMsg } from "./chat";
import { downloadImage } from "@/lib/image";
import { cn } from "@/lib/utils";

/**
 * The message thread every chat-style tool shares. A user turn sits on the
 * right with whatever image(s) went with it; the model's result sits on the
 * left as a clickable thumbnail — clicking one swaps the big preview
 * elsewhere on the page to that historical result without losing the current
 * one.
 *
 * While a turn is in flight the assistant side shows a skeleton in the same
 * shape as a result, so the thread never jumps when the image lands.
 *
 * A failed turn is its own row (red-tinted) with "Edit & retry" rather than
 * vanishing into a toast — the user's original input is never lost.
 */
export function ChatMessages({
  history,
  busy,
  onSelectResult,
  onRetry,
  hints,
  hintsLabel = "Refine the result",
  onHint,
}: {
  history: ChatMsg[];
  busy?: boolean;
  /** Called with a past assistant turn's image when its thumbnail is clicked. */
  onSelectResult: (src: string) => void;
  onRetry: (msg: ChatMsg) => void;
  /** Shown only before the first message — quick-start suggestions. */
  hints?: string[];
  hintsLabel?: string;
  onHint?: (hint: string) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
      {history.length === 0 && hints && hints.length > 0 && (
        <div className="space-y-1.5">
          <p className="mb-1.5 text-[10px] font-medium text-faint">{hintsLabel}</p>
          {hints.map((hint) => (
            <button
              key={hint}
              type="button"
              onClick={() => onHint?.(hint)}
              className="block w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-left text-[12px] text-gold transition-colors hover:bg-white/[0.07]"
            >
              {hint}
            </button>
          ))}
        </div>
      )}

      {history.map((msg) =>
        msg.role === "user" ? (
          <UserBubble key={msg.id} msg={msg} onOpen={onSelectResult} />
        ) : msg.retryInstruction !== undefined ? (
          <ErrorBubble key={msg.id} msg={msg} onRetry={onRetry} />
        ) : (
          <AssistantBubble key={msg.id} msg={msg} onOpen={onSelectResult} />
        )
      )}

      {busy && <SkeletonBubble />}
    </div>
  );
}

function Thumb({ src, size = 44 }: { src: string; size?: number }) {
  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-md border border-white/10 bg-surface-float"
      style={{ width: size, height: size }}
    >
      <Image src={src} alt="" fill sizes={`${size}px`} className="object-cover" />
    </div>
  );
}

function UserBubble({ msg, onOpen }: { msg: ChatMsg; onOpen: (src: string) => void }) {
  const images = [...(msg.image ? [msg.image] : []), ...(msg.refImages ?? [])];

  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] space-y-2 rounded-xl rounded-br-sm border border-gold/25 bg-gold/[0.08] px-2.5 py-2">
        {images.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1.5">
            {images.map((src, i) => (
              <button key={i} type="button" onClick={() => onOpen(src)}>
                <Thumb src={src} size={i === 0 && msg.image ? 44 : 32} />
              </button>
            ))}
          </div>
        )}
        <p className="text-right text-[12px] leading-relaxed text-cream">{msg.content}</p>
      </div>
    </div>
  );
}

function AssistantBubble({ msg, onOpen }: { msg: ChatMsg; onOpen: (src: string) => void }) {
  if (!msg.image) return null;
  const image = msg.image;

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] space-y-1.5 rounded-xl rounded-bl-sm border border-white/10 bg-white/[0.04] p-1.5">
        <button type="button" onClick={() => onOpen(image)} className="block transition-opacity hover:opacity-90">
          <Thumb src={image} size={72} />
        </button>
        <button
          type="button"
          onClick={() => downloadImage(image, "result.jpg")}
          className="flex w-full items-center justify-center gap-1 rounded-md py-0.5 text-[10px] text-faint transition-colors hover:text-gold"
        >
          <Download size={10} /> Download
        </button>
      </div>
    </div>
  );
}

/** Placeholder in the assistant slot, sized like the result that replaces it. */
function SkeletonBubble() {
  return (
    <div className="flex justify-start">
      <div className="rounded-xl rounded-bl-sm border border-white/10 bg-white/[0.04] p-1.5">
        <div className="h-28 w-28 animate-pulse rounded-md bg-white/[0.09]" />
      </div>
    </div>
  );
}

function ErrorBubble({ msg, onRetry }: { msg: ChatMsg; onRetry: (msg: ChatMsg) => void }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] space-y-1.5 rounded-xl rounded-bl-sm border border-error/25 bg-error/[0.08] px-3 py-2">
        <p className="text-[12px] text-error">{msg.content}</p>
        <button
          type="button"
          onClick={() => onRetry(msg)}
          className={cn(
            "flex items-center gap-1.5 rounded-md border border-error/30 px-2 py-1 text-[10px] font-semibold text-error transition-colors",
            "hover:bg-error/10"
          )}
        >
          <RotateCcw size={10} /> Edit & retry
        </button>
      </div>
    </div>
  );
}
