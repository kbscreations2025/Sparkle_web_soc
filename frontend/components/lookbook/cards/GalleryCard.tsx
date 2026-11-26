"use client";

import { useRef, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight, ImagePlus, X } from "lucide-react";
import { sizesFor, withAlpha } from "@/lib/lookbook/media";
import type { Aspect, GalleryCard as GalleryCardType, GalleryItem } from "@/lib/lookbook/types";
import { cn } from "@/lib/utils";
import { useEditable, useRender } from "../context";
import { Txt } from "../EditableText";
import { MediaView } from "../MediaView";
import { Reveal } from "../motion";
import { Body, CardFrame, Eyebrow, Title, cardRadius, justifyFor } from "../parts";

/** A set of pictures: a grid, masonry, a swipeable row or a magazine layout. Every tile zooms. */
export function GalleryCard({ card }: { card: GalleryCardType }) {
  const { mode, openZoom } = useRender();
  const editable = useEditable();
  const items = mode === "public" ? card.items.filter((item) => item.media) : card.items;
  const zoomable = card.items.filter((item) => item.media);
  const zoom = (item: GalleryItem) => () =>
    openZoom(
      zoomable.map((entry) => ({ media: entry.media!, caption: entry.caption })),
      Math.max(0, zoomable.findIndex((entry) => entry.id === item.id))
    );

  if (mode === "public" && items.length === 0) return null;

  const variant = card.style.variant;
  const hasHeader = editable || card.eyebrow || card.title || card.caption;

  return (
    <CardFrame card={card} reveal={false}>
      {hasHeader && (
        <Reveal animation={card.animation}>
          <div className="mb-8 flex flex-col gap-3 @2xl:mb-10" style={{ alignItems: justifyFor(card.style.align) }}>
            <Eyebrow value={card.eyebrow} path={["eyebrow"]} />
            <Title value={card.title} path={["title"]} placeholder="Gallery title" />
            <Body value={card.caption} path={["caption"]} placeholder="A line about these pieces" style={{ maxWidth: "52ch", color: "var(--lb-m)" }} />
          </div>
        </Reveal>
      )}
      {variant === "carousel" ? (
        <Carousel card={card} items={items} zoom={zoom} />
      ) : variant === "masonry" ? (
        <Masonry card={card} items={items} zoom={zoom} />
      ) : variant === "editorial" ? (
        <Editorial card={card} items={items} zoom={zoom} />
      ) : (
        <Grid card={card} items={items} zoom={zoom} />
      )}
    </CardFrame>
  );
}

type LayoutProps = { card: GalleryCardType; items: GalleryItem[]; zoom: (item: GalleryItem) => () => void };

const TILE_GAP = "clamp(6px, 1.4cqw, 18px)";

function columnsOf(card: GalleryCardType) {
  return {
    mobile: Math.min(3, Math.max(1, Math.round(card.mobileColumns) || 2)),
    desktop: Math.min(6, Math.max(1, Math.round(card.columns) || 3)),
  };
}

function Grid({ card, items, zoom }: LayoutProps) {
  const { theme } = useRender();
  const columns = columnsOf(card);
  // A grid lines up: tiles share one shape. "Original" means square here,
  // with each picture shown whole inside it.
  const aspect: Aspect = card.style.aspect === "auto" ? "1:1" : card.style.aspect;
  const sizes = sizesFor({ desktop: 1 / columns.desktop, mobile: 1 / columns.mobile, maxWidth: theme.maxWidth });
  return (
    <div
      className="grid grid-cols-[repeat(var(--cols-m),minmax(0,1fr))] @2xl:grid-cols-[repeat(var(--cols-d),minmax(0,1fr))]"
      style={{ "--cols-m": columns.mobile, "--cols-d": columns.desktop, gap: TILE_GAP } as CSSProperties}
    >
      {items.map((item, index) => (
        <Tile key={item.id} card={card} item={item} index={index} aspect={aspect} sizes={sizes} onZoom={zoom(item)} />
      ))}
      <AddTile card={card} aspect={aspect} />
    </div>
  );
}

function Masonry({ card, items, zoom }: LayoutProps) {
  const { theme } = useRender();
  const columns = columnsOf(card);
  const sizes = sizesFor({ desktop: 1 / columns.desktop, mobile: 1 / columns.mobile, maxWidth: theme.maxWidth });
  return (
    <div
      className="[column-count:var(--cols-m)] @2xl:[column-count:var(--cols-d)]"
      style={{ "--cols-m": columns.mobile, "--cols-d": columns.desktop, columnGap: TILE_GAP } as CSSProperties}
    >
      {items.map((item, index) => (
        <div key={item.id} className="break-inside-avoid" style={{ marginBottom: TILE_GAP }}>
          <Tile card={card} item={item} index={index} aspect={card.style.aspect} sizes={sizes} onZoom={zoom(item)} />
        </div>
      ))}
      <div className="break-inside-avoid">
        <AddTile card={card} aspect="4:5" />
      </div>
    </div>
  );
}

/** A row to swipe on a phone, with arrows on a computer. Native scrolling, so it's smooth everywhere. */
function Carousel({ card, items, zoom }: LayoutProps) {
  const { theme, mode } = useRender();
  const track = useRef<HTMLDivElement>(null);
  const columns = columnsOf(card);
  /** Slides in view at once on a large screen. */
  const perView = Math.min(columns.desktop, 4);
  const aspect: Aspect = card.style.aspect === "auto" ? "4:5" : card.style.aspect;
  const step = (direction: 1 | -1) => {
    const element = track.current;
    if (!element) return;
    const slide = element.firstElementChild as HTMLElement | null;
    element.scrollBy({ left: direction * ((slide?.offsetWidth ?? element.clientWidth) + 12), behavior: "smooth" });
  };
  const arrow =
    "lb-ui absolute top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full shadow-md transition-opacity hover:opacity-90 @2xl:flex";
  const arrowStyle = { background: withAlpha(theme.colors.bg, 0.85), color: theme.colors.heading };
  return (
    <div className="relative">
      <div
        ref={track}
        className="lb-carousel -mx-[var(--lb-edge)] flex overflow-x-auto px-[var(--lb-edge)] @2xl:mx-0 @2xl:px-0"
        style={{ gap: TILE_GAP, scrollPaddingInline: "var(--lb-edge)" } as CSSProperties}
      >
        {items.map((item, index) => (
          <div
            key={item.id}
            className="w-[78%] shrink-0 @md:w-[56%] @2xl:w-[var(--slide-w)]"
            style={{ "--slide-w": `calc((100% - ${perView - 1} * ${TILE_GAP}) / ${perView})` } as CSSProperties}
          >
            <Tile
              card={card}
              item={item}
              index={index}
              aspect={aspect}
              sizes={sizesFor({ desktop: 1 / perView, mobile: 0.8, maxWidth: theme.maxWidth })}
              onZoom={zoom(item)}
            />
          </div>
        ))}
        <div className="w-[60%] shrink-0 empty:hidden @2xl:w-[22%]">
          <AddTile card={card} aspect={aspect} />
        </div>
      </div>
      {mode !== "thumbnail" && items.length > 1 && (
        <>
          <button type="button" aria-label="Previous" className={cn(arrow, "-left-5")} style={arrowStyle} onClick={() => step(-1)}>
            <ChevronLeft size={18} />
          </button>
          <button type="button" aria-label="Next" className={cn(arrow, "-right-5")} style={arrowStyle} onClick={() => step(1)}>
            <ChevronRight size={18} />
          </button>
        </>
      )}
    </div>
  );
}

/** Magazine rhythm: a large picture beside a small one, alternating sides row by row. */
function Editorial({ card, items, zoom }: LayoutProps) {
  const { theme } = useRender();
  const rows: GalleryItem[][] = [];
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2));
  const editable = useEditable();
  return (
    <div className="flex flex-col" style={{ gap: TILE_GAP }}>
      {rows.map((row, rowIndex) => {
        const flipped = rowIndex % 2 === 1;
        if (row.length === 1) {
          return (
            <Tile
              key={row[0].id}
              card={card}
              item={row[0]}
              index={rowIndex * 2}
              aspect={card.style.aspect === "auto" ? "16:9" : card.style.aspect}
              sizes={sizesFor({ desktop: 1, mobile: 1, maxWidth: theme.maxWidth })}
              onZoom={zoom(row[0])}
            />
          );
        }
        return (
          <div key={row[0].id} className="grid @2xl:grid-cols-3 @2xl:[aspect-ratio:2.3]" style={{ gap: TILE_GAP }}>
            {row.map((item, i) => {
              const large = flipped ? i === 1 : i === 0;
              return (
                <div key={item.id} className={cn("min-h-0", large ? "@2xl:col-span-2" : "@2xl:col-span-1")}>
                  <Tile
                    card={card}
                    item={item}
                    index={rowIndex * 2 + i}
                    aspect="4:5"
                    fill
                    sizes={sizesFor({ desktop: large ? 0.66 : 0.33, mobile: 1, maxWidth: theme.maxWidth })}
                    onZoom={zoom(item)}
                  />
                </div>
              );
            })}
          </div>
        );
      })}
      {editable && <AddTile card={card} aspect="16:9" />}
    </div>
  );
}

function Tile({
  card,
  item,
  index,
  aspect,
  sizes,
  onZoom,
  fill = false,
}: {
  card: GalleryCardType;
  item: GalleryItem;
  index: number;
  aspect: Aspect;
  sizes: string;
  onZoom: () => void;
  /** Fills the height its row gives it on a large screen (the editorial layout). */
  fill?: boolean;
}) {
  const { theme, editor } = useRender();
  const editable = useEditable();
  const radius = cardRadius(card.style, theme);
  return (
    <Reveal animation={card.animation} delay={Math.min(index, 8) * 0.07} className={cn(fill && "h-full")}>
      <figure className={cn("group/tile relative m-0", fill && "h-full @2xl:flex @2xl:flex-col")}>
        <div className={cn("relative", fill && "aspect-[4/5] @2xl:aspect-auto @2xl:min-h-0 @2xl:flex-1")}>
          <MediaView
            media={item.media}
            slot={`gallery:${item.id}`}
            fit={card.style.fit}
            aspect={fill ? "auto" : aspect}
            layout={fill ? "cover" : "intrinsic"}
            sizes={sizes}
            radius={radius}
            onZoom={item.media ? onZoom : undefined}
            parallax={card.animation.type === "parallax" ? card.animation.strength * 0.5 : null}
          />
        </div>
        {card.showCaptions && (
          <Txt
            as="figcaption"
            value={item.caption}
            path={["items", item.id, "caption"]}
            placeholder="Caption"
            className="lb-small mt-2.5 block"
            style={{ color: "var(--lb-m)" }}
          />
        )}
        {editable && editor && (
          <button
            type="button"
            title="Remove from the gallery"
            onClick={(event) => {
              event.stopPropagation();
              editor.updateCard(card.id, (current) =>
                current.type === "gallery" ? { ...current, items: current.items.filter((entry) => entry.id !== item.id) } : current
              );
            }}
            className="lb-ui absolute left-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 backdrop-blur transition-opacity group-hover/tile:opacity-100 touch:opacity-100"
          >
            <X size={12} />
          </button>
        )}
      </figure>
    </Reveal>
  );
}

/** The builder's "add photos" tile at the end of a gallery. */
function AddTile({ card, aspect }: { card: GalleryCardType; aspect: Aspect }) {
  const { editor, theme } = useRender();
  const editable = useEditable();
  if (!editable || !editor) return null;
  const ratio = { "1:1": 1, "4:5": 0.8, "3:4": 0.75, "2:3": 2 / 3, "3:2": 1.5, "16:9": 16 / 9, "9:16": 9 / 16, auto: 0.8 }[aspect];
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        editor.select(card.id);
        editor.pickMedia({ cardId: card.id, slot: "gallery:add", kind: "image" });
      }}
      className="lb-ui flex w-full flex-col items-center justify-center gap-2 text-[12px] font-medium transition-opacity hover:opacity-80"
      style={{
        aspectRatio: String(ratio),
        border: `1px dashed ${withAlpha(theme.colors.text, 0.3)}`,
        borderRadius: cardRadius(card.style, theme),
        color: withAlpha(theme.colors.text, 0.65),
      }}
    >
      <ImagePlus size={22} strokeWidth={1.4} />
      Add photos
    </button>
  );
}
