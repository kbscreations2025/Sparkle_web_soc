"use client";

import { useState, type CSSProperties } from "react";
import { Download, Loader2, MessageCircle, Trash2, X, ZoomIn, ZoomOut } from "lucide-react";
import type { HistoryItem, HistoryOutput } from "@/lib/api";
import { downloadImage } from "@/lib/image";
import { useEscapeKey } from "@/lib/useEscapeKey";
import { useImageZoom } from "@/lib/useImageZoom";
import { toolBadgeStyle } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { AssetThumb } from "./AssetThumb";
import { BrandStoryResult } from "./BrandStoryResult";
import { looksLikeBrandStory } from "@/lib/brandStory";

/**
 * The detail view for one History tile: every output image of that
 * generation as a thumbnail strip, plus the run's metadata (tool, model,
 * quality, when, who). Distinct from the plain `Lightbox` used mid-tool —
 * that one shows a single in-progress result, this one is a read-only look
 * back at a finished run.
 */
export function HistoryLightbox({
  item,
  toolLabel,
  modelLabel,
  canContinue,
  deleting,
  onClose,
  onDelete,
  onContinue,
}: {
  item: HistoryItem | null;
  toolLabel: string;
  /** The Sparkle-labelled model name, resolved by the caller — falls back to whatever the server sent. */
  modelLabel?: string | null;
  /** Whether this generation is the viewer's own, in a tool that can resume a thread. */
  canContinue?: boolean;
  deleting?: boolean;
  onClose: () => void;
  onDelete: (item: HistoryItem) => void;
  onContinue?: () => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  /**
   * Which asset's full-size original has finished decoding.
   *
   * Tracked by asset id rather than a boolean: stepping through the strip
   * swaps the picture without remounting anything, and a flag would still
   * read "loaded" for a moment while showing the next image's placeholder.
   */
  const [loadedAssetId, setLoadedAssetId] = useState<string | null>(null);
  // Narrower range than the mid-tool Lightbox: this is a read-only look at a
  // stored result, so it never zooms out below the fitted size.
  const zoom = useImageZoom({ min: 1, max: 4, buttonStep: 1.25, resetKey: item?.id });
  const { scale, frameRef } = zoom;

  // Each generation opens on its first image. Reset during render (React's
  // documented pattern for "state that depends on a changed prop") rather than
  // an effect, so switching items never paints the old index for a frame
  // before an effect catches up. The zoom resets itself off the same key.
  const [openItemId, setOpenItemId] = useState(item?.id);
  if (item?.id !== openItemId) {
    setOpenItemId(item?.id);
    setActiveIndex(0);
  }

  useEscapeKey(onClose, Boolean(item));

  if (!item) return null;

  const active = item.outputs[activeIndex];
  const timeLabel = timeAgo(item.createdAt);
  const fullSizeShown = Boolean(active && loadedAssetId === active.assetId);

  /**
   * One at a time, in order. Firing them together would open as many parallel
   * proxy streams of several megabytes each, and browsers throttle or drop
   * simultaneous downloads from one gesture anyway. `downloadImage` reports
   * failure by returning false rather than throwing, so one bad image can't
   * abandon the rest of the set.
   */
  async function downloadAll() {
    for (const [i, output] of item!.outputs.entries()) {
      await downloadImage(output.url, `${item!.tool}-${item!.id}-${i + 1}.jpg`);
    }
  }

  return (
    <div
      ref={frameRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3 backdrop-blur-xl md:p-6 lg:p-8"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="relative flex max-h-[90vh] max-w-[94vw] flex-col items-center"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-2 flex w-full flex-wrap items-center justify-between gap-2 md:mb-3 md:gap-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {/* The same colour the tile carried, so the badge doesn't
                change identity between the grid and the view it opens. */}
            <span
              className="flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold md:px-2.5 md:py-1 md:text-[11px]"
              style={toolBadgeStyle(item.tool)}
            >
              {toolLabel}
            </span>
            {(modelLabel || item.quality) && (
              <span className="flex-shrink-0 rounded-full border border-white/[0.10] bg-white/[0.05] px-2 py-0.5 text-[10px] font-medium text-faint md:px-2.5 md:py-1 md:text-[11px]">
                {[modelLabel, item.quality].filter(Boolean).join(" · ")}
              </span>
            )}
          </div>
          <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2 md:gap-3">
            <p className="whitespace-nowrap text-[10px] text-faint md:text-[11px]">
              {timeLabel} · by {item.userName}
              {item.outputs.length > 1 ? ` · ${activeIndex + 1}/${item.outputs.length}` : ""}
            </p>
            <div className="flex items-center gap-0.5 rounded-full border border-white/15 bg-white/[0.04] p-1 md:gap-1">
              {canContinue && (
                <button
                  type="button"
                  onClick={onContinue}
                  title="Continue this conversation"
                  className="flex h-7 items-center gap-1 rounded-full px-2 text-[10px] font-medium text-white/85 transition-colors hover:bg-white/[0.10] md:h-8"
                >
                  <MessageCircle size={13} /> 
                </button>
              )}
              {item.outputs.length > 1 && (
                <button
                  type="button"
                  onClick={downloadAll}
                  title="Download all"
                  className="flex h-7 items-center gap-1 rounded-full px-2 text-[10px] font-medium text-white/85 transition-colors hover:bg-white/[0.10] md:h-8"
                >
                  <Download size={13} /> All
                </button>
              )}
              {/* Absent rather than inert on a text result — there is no
                  file to save, and a button that does nothing when pressed
                  reads as broken. */}
              {active && (
                <button
                  type="button"
                  onClick={() => downloadImage(active.url, `${item.tool}-${item.id}-${activeIndex + 1}.jpg`)}
                  title="Download"
                  className="flex h-7 w-7 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/[0.10] md:h-8 md:w-8"
                >
                  <Download size={14} />
                </button>
              )}
              <button
                type="button"
                onClick={() => onDelete(item)}
                disabled={deleting}
                title="Delete"
                className="flex h-7 w-7 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/[0.10] disabled:cursor-not-allowed disabled:opacity-40 md:h-8 md:w-8"
              >
                {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              </button>
              <button
                type="button"
                onClick={onClose}
                title="Close"
                className="flex h-7 w-7 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/[0.10] md:h-8 md:w-8"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 items-stretch gap-3">
          {item.outputs.length > 1 && (
            <div className="flex flex-col gap-2 overflow-y-auto">
              {item.outputs.map((output, i) => (
                <button
                  key={output.assetId}
                  type="button"
                  onClick={() => {
                    setActiveIndex(i);
                    zoom.reset();
                  }}
                  className={`h-16 w-16 shrink-0 overflow-hidden rounded-md border-2 transition-colors ${
                    i === activeIndex ? "border-gold" : "border-transparent hover:border-white/30"
                  }`}
                >
                  {/* The small copy — this strip is 64px tiles, and the pane
                      beside it is already loading the full-size original. */}
                  <AssetThumb output={output} />
                </button>
              ))}
            </div>
          )}

          <div
            className="flex min-h-0 flex-1 items-center justify-center overflow-hidden"
            {...zoom.panHandlers}
          >
            {active ? (
              active.type === "video" ? (
                /* A clip plays here rather than being zoomed — the zoom
                   controls below are for a still, and dragging a scaled
                   video would fight its own scrubber. */
                <video
                  src={active.url}
                  poster={active.thumbnailUrl ?? undefined}
                  controls
                  playsInline
                  className="max-h-[70vh] max-w-[80vw] rounded md:max-h-[76vh]"
                />
              ) : (
                /*
                 * The box is sized before the picture arrives, from the
                 * dimensions the asset already carries — so the dialog opens
                 * at its final size instead of springing open around the
                 * image a moment later.
                 *
                 * What fills it meanwhile is the thumbnail, not a grey
                 * rectangle: the grid this was opened from has already
                 * fetched it, so it paints from cache on the same frame the
                 * dialog appears, and the full-size original fades in over
                 * the top of it.
                 */
                <div className="relative select-none overflow-hidden rounded" style={fittedBox(active)}>
                  {!fullSizeShown && active.thumbnailUrl && (
                    // eslint-disable-next-line @next/next/no-img-element -- placeholder layer, sized by its container
                    <img
                      src={active.thumbnailUrl}
                      alt=""
                      aria-hidden
                      draggable={false}
                      // Scaled up very slightly so the blur doesn't leave a
                      // soft edge inside the frame.
                      className="absolute inset-0 h-full w-full scale-[1.03] object-contain blur-[3px]"
                    />
                  )}
                  {!fullSizeShown && <span aria-hidden className="absolute inset-0 animate-pulse bg-white/[0.06]" />}

                  {/* eslint-disable-next-line @next/next/no-img-element -- transform-scaled, so next/image's fill sizing doesn't apply */}
                  <img
                    src={active.url}
                    alt="Generated result"
                    draggable={false}
                    onLoad={() => setLoadedAssetId(active.assetId)}
                    className={cn(
                      "absolute inset-0 h-full w-full object-contain",
                      fullSizeShown ? "opacity-100" : "opacity-0"
                    )}
                    style={{
                      ...zoom.imageStyle,
                      // The fade is the only thing that should animate while
                      // dragging — a transition on the transform would make
                      // the pan lag behind the cursor.
                      transition: zoom.dragging
                        ? "opacity 200ms ease"
                        : "transform 120ms ease, opacity 200ms ease",
                    }}
                    // Double-click toggles between fitted and 2x.
                    onDoubleClick={() => (scale > 1 ? zoom.reset() : zoom.zoomBy(2))}
                  />
                </div>
              )
            ) : (
              /* A run that produced words. The full text, scrollable and
                 selectable — this is the only place it can be read in full,
                 since the tile shows an excerpt.

                 Styled to match the tile it was opened from — same
                 `text-muted` on the same pale ground — so the excerpt and
                 the full text read as one thing seen at two sizes.

                 The one deviation is the background. The tile uses a 4%
                 white tint, which works there because it sits on the page's
                 own surface; here it would sit on the black scrim and stay
                 black, with dark `text-muted` vanishing into it. So the
                 panel brings its own ground: `bg-surface-raised` is the
                 same colour the tile's tint resolves to, and it flips with
                 the theme exactly as the text token does.

                 A Brand Story is the exception: it gets the same editorial
                 layout it has in the tool, from the same component, so a
                 narrative read here and one reopened in Marketing Kit a
                 month later are the same thing. Recognised by its own
                 headings rather than by the tool key — History carries the
                 text but not which Marketing Kit surface wrote it, and
                 Affinity's stored output is JSON, which finds no headings
                 and correctly falls through to the plain panel. */
              <div className="max-h-[70vh] w-[min(80vw,64rem)] overflow-y-auto md:max-h-[76vh]">
                {looksLikeBrandStory(item.text) ? (
                  <BrandStoryResult text={item.text} />
                ) : item.kitId ? (
                  /* A catalog deck. Its pictures live on the kit, not on the
                     generation, so this points at the deck rather than
                     rendering the model's JSON — which is what the stored
                     text actually is for an Affinity run. */
                  <div className="rounded-lg border border-white/15 bg-surface-raised p-5 text-center">
                    <p className="mb-3 text-[13px] text-muted">
                      This run produced a catalog deck. Open it to read, edit and export it.
                    </p>
                    <a
                      href={`/marketing-kit/affinity?kitId=${item.kitId}`}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-gold/30 bg-gold/15 px-3 text-xs font-semibold text-gold transition-colors hover:bg-gold/25"
                    >
                      Open the deck
                    </a>
                  </div>
                ) : (
                  <div className="rounded-lg border border-white/15 bg-surface-raised p-4 md:p-5">
                    <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-muted">
                      {item.text?.trim() || "No text was recorded for this run."}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

      {/* Zoom is for a still. A video has its own controls and text has
          nothing to magnify, so the bar is absent rather than inert. */}
      {active?.type !== "video" && active && (
        <div className="mt-3 flex items-center gap-1 rounded-full border border-white/15 bg-black/60 px-1.5 py-1 backdrop-blur-sm">
          <button
            type="button"
            onClick={zoom.zoomOut}
            disabled={zoom.atMin}
            title="Zoom out"
            className="flex h-7 w-7 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ZoomOut size={14} />
          </button>
          <button
            type="button"
            onClick={zoom.reset}
            title="Reset to 100%"
            className="w-11 select-none rounded-full text-center text-[10px] font-medium tabular-nums text-white/70 transition-colors hover:bg-white/15 hover:text-white"
          >
            {Math.round(scale * 100)}%
          </button>
          <button
            type="button"
            onClick={zoom.zoomIn}
            disabled={zoom.atMax}
            title="Zoom in"
            className="flex h-7 w-7 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ZoomIn size={14} />
          </button>
        </div>
      )}
      </div>
    </div>
  );
}

/**
 * The size the picture will end up at, computed before it has loaded.
 *
 * The same box the browser would settle on for `max-h/max-w` plus
 * `object-contain`, worked out from the stored dimensions instead of from
 * the bytes: width is whichever of the two limits binds first, and height
 * follows from the aspect ratio, so it can never exceed the height cap.
 *
 * A row from before dimensions were recorded has none, and falls back to
 * 4:3. That is a guess, and a wrongly-shaped box still resizes once — but
 * only those rows, and only by the difference.
 */
function fittedBox(asset: HistoryOutput): CSSProperties {
  const ratio = asset.width && asset.height ? asset.width / asset.height : 4 / 3;

  return {
    aspectRatio: String(ratio),
    width: `min(80vw, ${(70 * ratio).toFixed(3)}vh)`,
    maxWidth: "80vw",
    maxHeight: "70vh",
  };
}

/** Coarse "N units ago" — history doesn't need second-level precision. */
function timeAgo(iso: string) {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  const units: [string, number][] = [
    ["year", 31536000],
    ["month", 2592000],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [label, size] of units) {
    const value = Math.floor(seconds / size);
    if (value >= 1) return `${value} ${label}${value > 1 ? "s" : ""} ago`;
  }
  return "just now";
}
