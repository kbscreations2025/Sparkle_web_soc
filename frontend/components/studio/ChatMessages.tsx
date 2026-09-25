"use client";

import { useState } from "react";
import Image from "next/image";
import { Download, RotateCcw } from "lucide-react";
import type { ChatMsg } from "./chat";
import { downloadAllImages, downloadImage } from "@/lib/image";
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
  busyCount = 1,
  busyImages,
  selectedSrc,
  onSelectResult,
  onRetry,
  hints,
  hintsLabel = "Refine the result",
  onHint,
}: {
  history: ChatMsg[];
  busy?: boolean;
  /** How many results the in-flight turn will produce — one placeholder each. */
  busyCount?: number;
  /** Results of the in-flight turn that have already arrived, filling those placeholders in order. */
  busyImages?: string[];
  /** Which result is currently on the stage, so its thumbnail can be marked. */
  selectedSrc?: string | null;
  /** Called with a past assistant turn's image when its thumbnail is clicked. */
  onSelectResult: (src: string) => void;
  /** Omitted on a read-only thread, which hides the retry button. */
  onRetry?: (msg: ChatMsg) => void;
  /** Quick-start or refinement suggestions. Whether they still apply is the caller's call. */
  hints?: string[];
  hintsLabel?: string;
  onHint?: (hint: string) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-2.5">
      {history.map((msg) =>
        msg.role === "user" ? (
          <UserBubble key={msg.id} msg={msg} onOpen={onSelectResult} />
        ) : msg.retryInstruction !== undefined ? (
          <ErrorBubble key={msg.id} msg={msg} onRetry={onRetry} />
        ) : (
          <AssistantBubble key={msg.id} msg={msg} onOpen={onSelectResult} selectedSrc={selectedSrc} />
        )
      )}

      {busy && <SkeletonBubble count={busyCount} arrived={busyImages} onOpen={onSelectResult} />}

      {/* After the thread, not before it: these are what to say next. Whether
          they still apply is the caller's call — it passes none once they
          don't — so there is no second condition on the same thing here. */}
      {hints && hints.length > 0 && !busy && (
        <div className="space-y-1">
          <p className="mb-1 text-[9px] font-medium uppercase tracking-wide text-faint">{hintsLabel}</p>
          {hints.map((hint) => (
            <button
              key={hint}
              type="button"
              onClick={() => onHint?.(hint)}
              className="block w-full rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-left text-[11px] leading-snug text-gold transition-colors hover:bg-white/[0.07]"
            >
              {hint}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Sized by class rather than a pixel prop, so a tile can grow a step on wider
 * screens — the rail is the full width of a phone but a 300px column on a
 * desktop, and one fixed size cannot suit both.
 */
function Thumb({ src, className, sizes }: { src: string; className: string; sizes: string }) {
  return (
    <div className={cn("relative shrink-0 overflow-hidden rounded-md border border-white/10 bg-surface-float", className)}>
      <Image src={src} alt="" fill sizes={sizes} className="object-cover" />
    </div>
  );
}

/**
 * The one thumbnail size in a thread — what you sent, what came back, its
 * placeholder, a reference. One size, so a thread reads as a steady column
 * of pictures rather than a mix of large and small ones, and kept small
 * because the stage beside it is where an image is actually looked at.
 */
const TILE = "h-11 w-11 sm:h-12 sm:w-12";
const TILE_SIZES = "48px";

/**
 * One image in a thread: click to put it on the stage, hover for a download
 * button in its corner. The same control on both sides of the thread, so
 * what you sent can be saved exactly like what came back.
 */
function ThumbTile({
  src,
  filename,
  selected = false,
  onOpen,
}: {
  src: string;
  filename: string;
  selected?: boolean;
  onOpen: (src: string) => void;
}) {
  return (
    <div className="group/tile relative">
      <button
        type="button"
        onClick={() => onOpen(src)}
        className={cn(
          "block overflow-hidden rounded-md border transition-colors",
          selected ? "border-gold/60" : "border-transparent hover:border-gold/30"
        )}
      >
        <Thumb src={src} className={TILE} sizes={TILE_SIZES} />
      </button>
      <button
        type="button"
        onClick={() => downloadImage(src, filename)}
        title="Download"
        aria-label="Download"
        className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-white/[0.12] bg-surface-float text-faint opacity-0 transition-opacity hover:text-gold focus-visible:opacity-100 group-hover/tile:opacity-100"
      >
        <Download size={9} />
      </button>
    </div>
  );
}

function UserBubble({ msg, onOpen }: { msg: ChatMsg; onOpen: (src: string) => void }) {
  const images = [...(msg.image ? [msg.image] : []), ...(msg.refImages ?? [])];

  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] space-y-1.5 rounded-xl rounded-br-sm border border-gold/25 bg-gold/[0.08] px-2.5 py-1.5">
        {images.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1">
            {images.map((src, i) => (
              <ThumbTile
                key={i}
                src={src}
                filename={i === 0 && msg.image ? "input.jpg" : `reference-${i + (msg.image ? 0 : 1)}.jpg`}
                onOpen={onOpen}
              />
            ))}
          </div>
        )}
        <p className="whitespace-pre-wrap break-words text-right text-[11px] leading-snug text-cream">{msg.content}</p>
      </div>
    </div>
  );
}

/**
 * What the model produced for one turn. Usually a single image; Text to Image
 * asks for several variations at once, so every one of them is shown here and
 * clicking any picks it for the stage.
 */
function AssistantBubble({
  msg,
  onOpen,
  selectedSrc,
}: {
  msg: ChatMsg;
  onOpen: (src: string) => void;
  selectedSrc?: string | null;
}) {
  const [savingAll, setSavingAll] = useState(false);
  const images = msg.images?.length ? msg.images : msg.image ? [msg.image] : [];
  if (images.length === 0) return null;

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] space-y-1 rounded-xl rounded-bl-sm border border-white/10 bg-white/[0.04] p-1.5">
        <div className="flex flex-wrap gap-1">
          {images.map((src, index) => (
            <ThumbTile
              key={`${src}-${index}`}
              src={src}
              filename={`result-${index + 1}.jpg`}
              selected={src === selectedSrc}
              onOpen={onOpen}
            />
          ))}
        </div>

        {images.length > 1 && (
          <button
            type="button"
            disabled={savingAll}
            onClick={async () => {
              setSavingAll(true);
              try {
                await downloadAllImages(images, "generated");
              } finally {
                setSavingAll(false);
              }
            }}
            className="flex w-full items-center justify-center gap-1 rounded-md py-0.5 text-[10px] text-faint transition-colors hover:text-gold disabled:opacity-60"
          >
            <Download size={10} /> {savingAll ? "Saving…" : `Download all (${images.length})`}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The assistant slot while a turn is in flight: one tile per result, in the
 * same place and at the same size as the thumbnails that replace them — so a
 * run's size is visible from the moment it is queued, not only once it lands.
 *
 * Tiles fill in as the results arrive rather than all at the end. A run of
 * four is four separate provider calls, and there is no reason to hide the
 * first image until the fourth one is done; each `arrived` preview takes the
 * next placeholder, and the rest keep pulsing.
 */
function SkeletonBubble({
  count,
  arrived = [],
  onOpen,
}: {
  count: number;
  arrived?: string[];
  onOpen?: (src: string) => void;
}) {
  // A run can deliver more than it promised only if the caller's count is
  // stale; trust what actually arrived over the prediction.
  const tiles = Math.max(1, count, arrived.length);

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-xl rounded-bl-sm border border-white/10 bg-white/[0.04] p-1.5">
        <div className="flex flex-wrap gap-1">
          {Array.from({ length: tiles }, (_, index) => {
            const src = arrived[index];
            if (!src) return <div key={index} className={cn("animate-pulse rounded-md bg-white/[0.09]", TILE)} />;

            return (
              <button
                key={index}
                type="button"
                onClick={() => onOpen?.(src)}
                className="block overflow-hidden rounded-md border border-transparent transition-colors hover:border-gold/30"
              >
                <Thumb src={src} className={TILE} sizes={TILE_SIZES} />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ErrorBubble({ msg, onRetry }: { msg: ChatMsg; onRetry?: (msg: ChatMsg) => void }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] space-y-1.5 rounded-xl rounded-bl-sm border border-error/25 bg-error/[0.08] px-2.5 py-1.5">
        <p className="text-[11px] leading-snug text-error">{msg.content}</p>
        {onRetry && (
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
        )}
      </div>
    </div>
  );
}
