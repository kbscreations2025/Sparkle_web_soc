"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { Film, Gem, ImagePlus, RefreshCw } from "lucide-react";
import { ASPECT_RATIOS, naturalRatio, responsiveSources, thumbOf, withAlpha } from "@/lib/lookbook/media";
import type { Aspect, Fit, Media, MediaKind } from "@/lib/lookbook/types";
import { cn } from "@/lib/utils";
import { useCard, useEditable, useRender, type MediaSlot } from "./context";
import { Parallax } from "./motion";

type MediaViewProps = {
  media: Media | null;
  /** Which slot of the card this is, so the builder can fill or replace it. */
  slot: MediaSlot;
  kind?: MediaKind;
  fit: Fit;
  aspect: Aspect;
  /**
   * "intrinsic": as tall as the picture's shape (or the chosen aspect) at the
   * slot's width. "cover": fills a parent that has a size of its own.
   */
  layout?: "intrinsic" | "cover";
  /** The `sizes` for the public page's srcset. */
  sizes: string;
  radius?: number;
  /** Load at once with high priority: the first thing on the page. */
  priority?: boolean;
  /** Opens the full-resolution viewer on the public page. */
  onZoom?: () => void;
  /** Drift against the scroll by this much, 0–1. */
  parallax?: number | null;
  /** Aspect used when the picture's own shape is unknown or there is no picture. */
  fallbackRatio?: number;
  label?: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
};

/**
 * One picture or clip on a card.
 *
 * "Whole" shows every pixel: the frame takes the picture's own shape, or,
 * when a shape is chosen, the picture sits inside it with the card's colour
 * around it. "Fill" covers the frame edge to edge and may trim. Only ever on
 * request, since the piece is the point.
 */
export function MediaView({
  media,
  slot,
  kind = "image",
  fit,
  aspect,
  layout = "intrinsic",
  sizes,
  radius,
  priority,
  onZoom,
  parallax,
  fallbackRatio = 4 / 5,
  label,
  className,
  style,
  children,
}: MediaViewProps) {
  const { mode } = useRender();
  const editable = useEditable();

  if (!media) {
    if (mode === "public") return null;
    return (
      <Placeholder
        slot={slot}
        kind={kind}
        layout={layout}
        ratio={ASPECT_RATIOS[aspect] ?? fallbackRatio}
        radius={radius}
        label={label}
        className={className}
        style={style}
      />
    );
  }

  const chosen = ASPECT_RATIOS[aspect];
  const ratio = chosen ?? naturalRatio(media) ?? (fit === "fill" ? fallbackRatio : null);
  const frameStyle: CSSProperties = {
    borderRadius: radius,
    ...(layout === "intrinsic" && ratio ? { aspectRatio: String(ratio) } : {}),
    ...style,
  };
  const objectFit = fit === "fill" ? "cover" : "contain";
  // A picture with no known shape and no chosen one: let it set its own height.
  const natural = layout === "intrinsic" && !ratio;

  const content =
    media.kind === "video" ? (
      <VideoElement media={media} objectFit={objectFit} natural={natural} />
    ) : (
      <ImageElement media={media} objectFit={objectFit} natural={natural} sizes={sizes} priority={priority} />
    );

  const zoomable = Boolean(onZoom) && media.kind === "image" && (mode === "public" || mode === "preview");

  return (
    <div
      className={cn(
        "lb-media group/media relative overflow-hidden",
        layout === "cover" && "absolute inset-0",
        zoomable && "cursor-zoom-in",
        className
      )}
      style={frameStyle}
      onClick={zoomable ? onZoom : undefined}
      role={zoomable ? "button" : undefined}
      tabIndex={zoomable ? 0 : undefined}
      aria-label={zoomable ? `Zoom ${media.alt || label || "picture"}` : undefined}
      onKeyDown={
        zoomable
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onZoom?.();
              }
            }
          : undefined
      }
    >
      {parallax ? (
        <Parallax strength={parallax} className={natural ? "" : "absolute inset-0"}>
          {content}
        </Parallax>
      ) : (
        content
      )}
      {children}
      {editable && <ReplaceButton slot={slot} kind={media.kind} />}
    </div>
  );
}

function ImageElement({
  media,
  objectFit,
  natural,
  sizes,
  priority,
}: {
  media: Media;
  objectFit: "cover" | "contain";
  natural: boolean;
  sizes: string;
  priority?: boolean;
}) {
  const { mode } = useRender();
  // Thumbnails in the builder and on template cards; the browser's choice of both sizes on the public page.
  const sources = mode === "public" || mode === "preview" ? responsiveSources(media) : { src: thumbOf(media) };

  // Visible from the server's first paint: no "fade in once loaded" state,
  // which would keep every picture hidden until the page's script arrived.
  return (
    // eslint-disable-next-line @next/next/no-img-element -- R2 originals served as-is; next/image's optimizer is off app-wide (next.config.ts)
    <img
      src={sources.src}
      srcSet={sources.srcSet}
      sizes={sources.srcSet ? sizes : undefined}
      alt={media.alt || ""}
      width={media.width || undefined}
      height={media.height || undefined}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      fetchPriority={priority ? "high" : undefined}
      draggable={false}
      className={cn("block select-none", natural ? "h-auto w-full" : "absolute inset-0 h-full w-full")}
      style={{ objectFit }}
    />
  );
}

/**
 * A clip: muted, looping and inline, so phones will autoplay it. It plays only
 * while on screen, which saves a client's data and battery. With reduced
 * motion it waits for a tap instead.
 */
function VideoElement({ media, objectFit, natural }: { media: Media; objectFit: "cover" | "contain"; natural: boolean }) {
  const { mode, reduceMotion, scrollRoot } = useRender();
  const card = useCard();
  const ref = useRef<HTMLVideoElement>(null);
  const settings = card.type === "video" ? card : null;
  const autoplay = mode !== "thumbnail" && !reduceMotion && (settings ? settings.autoplay : true);
  const loop = settings ? settings.loop : true;
  const controls = mode !== "thumbnail" && (settings ? settings.showControls || !autoplay : !autoplay);

  useEffect(() => {
    const video = ref.current;
    if (!video || !autoplay) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void video.play().catch(() => {});
        else video.pause();
      },
      { root: scrollRoot?.current ?? null, threshold: 0.25 }
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, [autoplay, scrollRoot]);

  return (
    <video
      ref={ref}
      src={media.url}
      poster={media.posterUrl || undefined}
      muted
      playsInline
      loop={loop}
      controls={controls}
      preload={mode === "public" ? "metadata" : "auto"}
      className={cn("block", natural ? "h-auto w-full" : "absolute inset-0 h-full w-full")}
      style={{ objectFit }}
    />
  );
}

/** An empty slot: in the builder, a button to fill it; on a template card, a quiet stand-in. */
function Placeholder({
  slot,
  kind,
  layout,
  ratio,
  radius,
  label,
  className,
  style,
}: {
  slot: MediaSlot;
  kind: MediaKind;
  layout: "intrinsic" | "cover";
  ratio: number;
  radius?: number;
  label?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const { theme, editor, mode } = useRender();
  const card = useCard();
  const editable = useEditable();
  const tint = theme.colors.accent;
  const Icon = kind === "video" ? Film : editable ? ImagePlus : Gem;
  const background = `linear-gradient(135deg, ${withAlpha(tint, theme.dark ? 0.16 : 0.1)}, ${withAlpha(theme.colors.text, theme.dark ? 0.06 : 0.05)})`;
  const body = (
    <>
      <Icon size={mode === "thumbnail" ? 18 : 26} strokeWidth={1.4} style={{ color: withAlpha(theme.colors.text, 0.45) }} />
      {editable && (
        <span className="mt-2 text-[12px] font-medium" style={{ color: withAlpha(theme.colors.text, 0.6), fontFamily: "var(--font-inter), system-ui" }}>
          {label ?? (kind === "video" ? "Add a clip" : "Add a photo")}
        </span>
      )}
    </>
  );
  const shared = cn(
    "lb-media flex flex-col items-center justify-center overflow-hidden",
    layout === "cover" ? "absolute inset-0" : "relative w-full",
    className
  );
  const frame: CSSProperties = {
    background,
    borderRadius: radius,
    ...(layout === "intrinsic" ? { aspectRatio: String(ratio) } : {}),
    border: editable ? `1px dashed ${withAlpha(theme.colors.text, 0.25)}` : undefined,
    ...style,
  };
  if (!editable) return <div className={shared} style={frame} aria-hidden />;
  return (
    <button
      type="button"
      className={cn(shared, "transition-opacity hover:opacity-80")}
      style={frame}
      onClick={(event) => {
        event.stopPropagation();
        editor?.select(card.id);
        editor?.pickMedia({ cardId: card.id, slot, kind });
      }}
    >
      {body}
    </button>
  );
}

function ReplaceButton({ slot, kind }: { slot: MediaSlot; kind: MediaKind }) {
  const { editor } = useRender();
  const card = useCard();
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        editor?.select(card.id);
        editor?.pickMedia({ cardId: card.id, slot, kind });
      }}
      className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white opacity-0 backdrop-blur transition-opacity group-hover/media:opacity-100 touch:opacity-100"
      style={{ fontFamily: "var(--font-inter), system-ui" }}
    >
      <RefreshCw size={11} /> Replace
    </button>
  );
}
