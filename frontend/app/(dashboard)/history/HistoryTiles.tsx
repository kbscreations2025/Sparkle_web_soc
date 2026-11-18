"use client";

import { memo } from "react";
import Link from "next/link";
import { Copy, Download, Eye, MessageCircle, Newspaper, Trash2 } from "lucide-react";
import type { HistoryItem, MarketingKitSummary } from "@/lib/api";
import { downloadImage, downloadName } from "@/lib/image";
import { TOOL_SHORT_LABELS, toolBadgeStyle } from "@/lib/nav";
import { describeKit, kitBadgeStyle, kitHref } from "@/lib/marketingKits";
import { cn } from "@/lib/utils";
import { AssetThumb } from "@/components/studio/AssetThumb";
import { TileActionsMenu, firstName } from "@/components/studio/TileActionsMenu";

/*
 * The History page's grid tiles — one generation, one saved kit — and the
 * skeleton that stands in for them while they load.
 *
 * Kept to the least chrome that still tells tiles apart: the tool badge top
 * left; the size and one ⋮ menu top right (chat, download, delete — the
 * lightbox has the same, full size, one tap away); who made it, by first name,
 * bottom left. The same on every screen — a phone's tile is as small as a
 * desktop's at ten to a row.
 */

/** Row gap between tiles, kept as one constant since both the CSS grid and the row-height estimate must agree. */
export const GRID_GAP = 10;

/**
 * The narrowest a tile may get — what its chrome needs across the top (a
 * clipped tool badge, the size, the ⋮) with a little picture between. The
 * size slider stops short of it: on a narrower grid, fewer to a row.
 */
export const MIN_TILE_WIDTH = 96;

/** The small dark chips over a picture — size, name, count. */
const TILE_CHIP =
  "rounded-full bg-black/55 px-1.5 py-0.5 text-[7px] font-medium text-white/85 backdrop-blur-sm md:text-[9px]";

/**
 * What a tile shows when the run produced words instead of pictures.
 *
 * An excerpt rather than an icon: these results are told apart by what they
 * say, and a grid of identical document glyphs would make a page of them
 * unreadable.
 *
 * Clipped by `line-clamp` alone. A fade at the bottom would read better,
 * but it has to be painted in the tile's own background colour — and that
 * colour comes from a `bg-white/*` tint that the light theme flips to a
 * black one, so a single hardcoded gradient is a smudge in one theme or
 * the other. The ellipsis says the same thing and cannot be wrong.
 *
 * `text-muted` rather than an explicit tint, unlike the lightbox: this tile
 * sits on the page, whose ground flips with the theme, so the token that
 * flips with it is the right one.
 */
function TextResultCover({ text }: { text?: string | null }) {
  return (
    <div className="h-full w-full bg-white/[0.04] p-2.5 pt-7 md:p-3 md:pt-8">
      <p className="line-clamp-6 text-[9px] leading-relaxed text-muted md:text-[10px]">
        {text?.trim() || "No text was recorded for this run."}
      </p>
    </div>
  );
}

/**
 * Kits that are a set of pictures rather than a deck: their tiles open the
 * results viewer and the chat, like an image tile, instead of an editor.
 */
export const OPENS_AS_RESULT = new Set(["campaign", "festive", "charms", "on_model"]);

type KitResultActions = {
  /** The run behind a Campaign Kit or Festive Poster tile, by kit id, once loaded. */
  items: Record<string, HistoryItem>;
  canContinue: (item: HistoryItem) => boolean;
  canView: (item: HistoryItem) => boolean;
  onOpen: (item: HistoryItem) => void;
  onContinue: (item: HistoryItem) => void;
};

/**
 * The saved kits, as the same tiles the results grid uses.
 *
 * Same square geometry, same column count, same chrome — badge top-left,
 * actions top-right, caption along the bottom. Switching tabs changes what
 * is in the grid, not what a grid looks like, and a second card style would
 * make the two halves read as two different pages.
 */
export function KitsGrid({
  kits,
  loading,
  columns,
  onDelete,
  ...actions
}: {
  kits: MarketingKitSummary[] | null;
  loading: boolean;
  columns: number;
  onDelete: (kit: MarketingKitSummary) => void;
} & KitResultActions) {
  if (loading || kits === null) return <SkeletonGrid rows={2} columns={columns} />;

  if (kits.length === 0) {
    return (
      <p className="px-2 py-10 text-center text-sm text-faint">
        No kits yet — a Brand Story, Affinity deck, Collection Story, Campaign Kit or Poster is saved here to
        reopen and edit.
      </p>
    );
  }

  return (
    <div className="grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: GRID_GAP }}>
      {kits.map((kit) => (
        <KitTile key={kit.id} kit={kit} onDelete={onDelete} {...actions} />
      ))}
    </div>
  );
}

function KitTile({
  kit,
  onDelete,
  items,
  canContinue,
  canView,
  onOpen,
  onContinue,
}: { kit: MarketingKitSummary; onDelete: (kit: MarketingKitSummary) => void } & KitResultActions) {
  // Campaign Kit and Festive Poster open the results viewer once their run
  // has loaded; until then (and for every other kind) the tile opens the kit.
  const item = OPENS_AS_RESULT.has(kit.kind) ? items[kit.id] : undefined;
  const cover = item?.outputs[0];
  const picture = kit.previewUrl ? (
    /* eslint-disable-next-line @next/next/no-img-element -- small grid tile, lazy-loaded natively; next/image adds no value at this size */
    <img
      src={kit.previewUrl}
      alt=""
      loading="lazy"
      decoding="async"
      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.05]"
    />
  ) : (
    /* A kit whose save failed has no picture to show. */
    <span className="flex h-full w-full items-center justify-center bg-white/[0.04]">
      <Newspaper size={22} className="text-faint" />
    </span>
  );

  return (
    <div
      title={kit.title || "Untitled kit"}
      className="group relative aspect-square overflow-hidden rounded-lg border border-white/[0.06] transition-colors hover:border-white/20 md:rounded-xl"
    >
      {item ? (
        <button
          type="button"
          onClick={() => onOpen(item)}
          className="absolute inset-0 block cursor-pointer"
          aria-label={`Preview ${kit.title || "this kit"}`}
        >
          {picture}
        </button>
      ) : (
        <Link href={kitHref(kit)} className="absolute inset-0" aria-label={kit.title || "Untitled kit"}>
          {picture}
        </Link>
      )}

      <div className="pointer-events-none absolute left-1.5 right-1.5 top-1.5 flex items-center justify-between gap-1 md:left-2 md:right-2 md:top-2">
        {/* The same badge the results tiles carry, in Marketing Kit's own
            colour, so a kit is recognisable at a glance in either tab. */}
        <span
          className="min-w-0 truncate rounded-full px-1 py-0.5 text-[7px] font-semibold backdrop-blur-sm md:px-1.5 md:text-[9px] lg:text-[10px]"
          style={kitBadgeStyle(kit.kind)}
        >
          {describeKit(kit)}
        </span>

        {/* The same ⋮ an image tile has. A teammate's kit is readable but
            not theirs to remove — the server refuses it, so no Delete. */}
        <div className="pointer-events-auto">
          <TileActionsMenu
            title={kit.title || "Untitled kit"}
            actions={[
              item && canContinue(item) && { icon: MessageCircle, label: "Continue chat", onSelect: () => onContinue(item) },
              item && canView(item) && { icon: Eye, label: "View chat", onSelect: () => onContinue(item) },
              item &&
                cover && {
                  icon: Download,
                  label: "Download",
                  onSelect: () => downloadImage(cover.url, downloadName(cover.url, `${item.tool}-${item.id}`, cover.type)),
                },
              kit.isOwn !== false && { icon: Trash2, label: "Delete", onSelect: () => onDelete(kit), danger: true },
            ]}
          />
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-1.5 left-1.5 right-1.5 flex items-end justify-between gap-1 md:bottom-2 md:left-2 md:right-2">
        {/* Who made it, in the same corner and the same chip the results
            tiles use for it — the kit's own name is the badge above and the
            tooltip on the tile, so this corner stays the one place you look
            to see whose work a tile is. First name only: the whole of it
            crowds a small tile, and the tooltip has the rest. */}
        <span title={kit.userName} className={cn(TILE_CHIP, "min-w-0 truncate")}>
          {firstName(kit.userName)}
        </span>
        <span className={cn(TILE_CHIP, "shrink-0")}>{timeAgoShort(kit.updatedAt)}</span>
      </div>

      {/* A kit whose save failed is shown rather than hidden — the run
          happened, and the reason is the only thing that explains why there
          is nothing to open. */}
      {kit.status === "failed" && (
        <p className="pointer-events-none absolute inset-x-1.5 bottom-8 truncate rounded bg-error/80 px-1.5 py-0.5 text-[8px] font-medium text-white md:inset-x-2 md:bottom-10 md:text-[10px]">
          {kit.error || "Could not be saved"}
        </p>
      )}
    </div>
  );
}

/** A short relative date for a kit row — the grid's tiles use their own. */
function timeAgoShort(iso: string) {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * Same shape as a real tile, so the grid doesn't jump when results replace it.
 *
 * Laid out by CSS breakpoints rather than by `useResponsiveColumns`, and that
 * is the whole point: the hook cannot know the viewport until it has mounted
 * and measured, so it necessarily returns its 2-column default for the first
 * paint. That is precisely the frame the skeleton occupies — which is why the
 * loader used to appear as two oversized boxes and then snap to six small
 * ones. Media queries are resolved before the first paint, so there is no
 * wrong frame to correct.
 *
 * The breakpoints below must stay in step with the hook's, or the skeleton
 * would hand over to a grid of a different shape.
 */
const SKELETON_GRID_COLUMNS = "grid-cols-2 sm:grid-cols-4 lg:grid-cols-6";

export function SkeletonGrid({ rows, columns }: { rows: number; columns?: number }) {
  // A size the person picked with the slider is known exactly, so the
  // stand-in takes the same shape as the grid it hands over to.
  if (columns) {
    return (
      <div className="grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: GRID_GAP }}>
        {Array.from({ length: columns * rows }).map((_, i) => (
          <div key={i} className="aspect-square animate-pulse rounded-lg bg-white/[0.04] md:rounded-xl" />
        ))}
      </div>
    );
  }

  // Enough tiles for the widest layout; the surplus is hidden at narrower
  // ones so every breakpoint shows the same number of *rows* rather than the
  // same number of tiles.
  const perRowWide = 6;
  const total = perRowWide * rows;

  return (
    <div className={cn("grid", SKELETON_GRID_COLUMNS)} style={{ gap: GRID_GAP }}>
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "aspect-square animate-pulse rounded-lg bg-white/[0.04] md:rounded-xl",
            // Beyond what fits in two columns, then in four.
            i >= 2 * rows && i < 4 * rows && "hidden sm:block",
            i >= 4 * rows && "hidden lg:block"
          )}
        />
      ))}
    </div>
  );
}

type HistoryTileProps = {
  item: HistoryItem;
  toolLabel: string;
  canContinue: boolean;
  /** A colleague's result, and the viewer holds org.conversations.read: open its chat to read. */
  canView: boolean;
  /** Their own result, or a colleague's with org.results.delete. */
  canDelete: boolean;
  deleting: boolean;
  onOpen: (item: HistoryItem) => void;
  onContinue: (item: HistoryItem) => void;
  onDelete: (item: HistoryItem) => void;
};

/**
 * Memoized so a page full of tiles doesn't all re-render every time one
 * unrelated tile's `deleting` state flips, or a new page of results appends —
 * `onOpen`/`onContinue`/`onDelete` are stable across renders (see the parent's
 * `useCallback`s), and `item` keeps its object identity for every row that
 * hasn't itself changed, so the comparator below bails out on those tiles.
 */
export const HistoryTile = memo(
  function HistoryTile({
    item,
    toolLabel,
    canContinue,
    canView,
    canDelete,
    deleting,
    onOpen,
    onContinue,
    onDelete,
  }: HistoryTileProps) {
    const cover = item.outputs[0];

    return (
      <div
        className="group relative aspect-square cursor-pointer overflow-hidden rounded-lg border border-white/[0.06] transition-colors hover:border-white/20 md:rounded-xl"
        onClick={() => onOpen(item)}
      >
        {/* The small copy, not the original: a full page of results is tens
            of megabytes at full size and under a megabyte here. The original
            is still what the download link and the lightbox below point at.
            A video result is a poster frame rather than a broken image.

            A run that made words rather than pictures — Image to Text, and
            Marketing Kit's writing halves — has no cover at all, and shows
            an excerpt instead. It used to render nothing, which did not
            hide the run so much as punch a hole in the grid: the tile was
            still counted into its row, so the row came up one short. */}
        {cover ? (
          <AssetThumb
            output={cover}
            alt={toolLabel}
            className="transition-transform duration-500 group-hover:scale-[1.05]"
          />
        ) : (
          <TextResultCover text={item.text} />
        )}

        <div className="absolute left-1.5 right-1.5 top-1.5 flex items-center justify-between gap-1 md:left-2 md:right-2 md:top-2">
          {/* The tool's short form — "Clean", "T2I" — since the colour already
              says which tool at a glance; the full name is on hover, and in
              the lightbox. */}
          <span
            title={toolLabel}
            className="min-w-0 truncate rounded-full px-1 py-0.5 text-[7px] font-semibold backdrop-blur-sm md:px-1.5 md:text-[9px] lg:text-[10px]"
            style={toolBadgeStyle(item.tool)}
          >
            {TOOL_SHORT_LABELS[item.tool] ?? toolLabel}
          </span>

          <div className="flex shrink-0 items-center gap-1">
            {/* The output size — "4K", "1K", the video's resolution. Same
                fact the lightbox prints beside the model name, up here too
                so a grid can be scanned for it without opening anything.
                Absent on a text result, which has no size. */}
            {item.quality && (
              <span className="rounded-full bg-black/55 px-1 py-0.5 text-[7px] font-semibold text-white/85 backdrop-blur-sm md:text-[8px]">
                {item.quality}
              </span>
            )}

            {/* Everything else a tile can do, behind one button rather than
                a row of them over the picture. */}
            <TileActionsMenu
              title={`${toolLabel} · ${item.userName}`}
              busy={deleting}
              actions={[
                canContinue && { icon: MessageCircle, label: "Continue chat", onSelect: () => onContinue(item) },
                // Same destination as Continue — the tool page sees the
                // thread is not the viewer's and opens it without a composer.
                canView && { icon: Eye, label: "View chat", onSelect: () => onContinue(item) },
                // Absent on a text result — there is no file to save. The
                // full-size original, never the grid thumbnail, under its
                // real extension, so a clip arrives as a playable .mp4.
                cover && {
                  icon: Download,
                  label: "Download",
                  onSelect: () => downloadImage(cover.url, downloadName(cover.url, `${item.tool}-${item.id}`, cover.type)),
                },
                // Own results, or a colleague's with org.results.delete — on
                // any other tile the server would refuse, so it isn't offered.
                canDelete && { icon: Trash2, label: "Delete", onSelect: () => onDelete(item), danger: true },
              ]}
            />
          </div>
        </div>

        <div className="pointer-events-none absolute bottom-1.5 left-1.5 right-1.5 flex items-end justify-between gap-1 md:bottom-2 md:left-2 md:right-2">
          <div className="flex min-w-0 flex-col items-start gap-0.5">
            {/* The label this was searched by — on the tile so a page of
                matches can be told apart without opening each one. */}
            {item.designNo && (
              <span
                title={`Design no. ${item.designNo}`}
                className="pointer-events-auto max-w-full truncate rounded-full bg-gold/80 px-1.5 py-0.5 text-[7px] font-semibold text-black backdrop-blur-sm md:text-[9px]"
              >
                #{item.designNo}
              </span>
            )}
            {/* First name only — the whole of it crowded the chip on a small
                tile. The tooltip has the rest. */}
            <span title={item.userName} className={cn(TILE_CHIP, "pointer-events-auto max-w-full truncate")}>
              {firstName(item.userName)}
            </span>
          </div>

          {/* How many images this run produced. Down here rather than up with
              the actions: it is information about the tile, not a control, and
              a long name truncates before it rather than pushing it off. */}
          {item.outputs.length > 1 && (
            <span className={cn(TILE_CHIP, "flex shrink-0 items-center gap-0.5")}>
              <Copy size={9} className="md:h-2.5 md:w-2.5" /> {item.outputs.length}
            </span>
          )}
        </div>
      </div>
    );
  },
  (prev, next) =>
    prev.item === next.item &&
    prev.toolLabel === next.toolLabel &&
    prev.canContinue === next.canContinue &&
    prev.canView === next.canView &&
    prev.canDelete === next.canDelete &&
    prev.deleting === next.deleting
);
