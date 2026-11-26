"use client";

import type { CSSProperties } from "react";
import { ChevronDown } from "lucide-react";
import { safeColor, sizesFor, thumbOf, withAlpha } from "@/lib/lookbook/media";
import type { HeroCard as HeroCardType } from "@/lib/lookbook/types";
import { cn } from "@/lib/utils";
import { useEditable, useRender } from "../context";
import { Txt } from "../EditableText";
import { MediaView } from "../MediaView";
import { CardFrame, DisplayTitle, Eyebrow, Lead, buttonRadius, cardRadius, justifyFor } from "../parts";

const HEIGHTS: Record<HeroCardType["height"], string | undefined> = {
  screen: "var(--lb-screen)",
  tall: "calc(var(--lb-screen) * 0.82)",
  medium: "calc(var(--lb-screen) * 0.6)",
  auto: undefined,
};

/** The page's opening: a big picture or clip and the collection's name. */
export function HeroCard({ card }: { card: HeroCardType }) {
  const variant = card.style.variant;
  if (variant === "split") return <SplitHero card={card} />;
  if (variant === "stacked") return <StackedHero card={card} />;
  if (variant === "framed") return <FramedHero card={card} />;
  return <OverlayHero card={card} />;
}

function HeroText({ card, wide = false }: { card: HeroCardType; wide?: boolean }) {
  return (
    <div className="flex flex-col gap-4 @2xl:gap-5" style={{ alignItems: justifyFor(card.style.align) }}>
      <Eyebrow value={card.eyebrow} path={["eyebrow"]} placeholder="Small heading" />
      <DisplayTitle value={card.title} path={["title"]} placeholder="Collection name" style={{ maxWidth: wide ? "16ch" : "12ch" }} />
      <Lead value={card.subtitle} path={["subtitle"]} placeholder="A line about the collection" style={{ maxWidth: "34ch", color: "var(--lb-m)" }} />
      <HeroButton card={card} />
    </div>
  );
}

function useHeroZoom(card: HeroCardType) {
  const { openZoom } = useRender();
  return card.media?.kind === "image" ? () => openZoom([{ media: card.media! }], 0) : undefined;
}

/** Full-bleed picture with the words laid over it. */
function OverlayHero({ card }: { card: HeroCardType }) {
  const { theme, firstCardId } = useRender();
  const { style, media } = card;
  const radius = style.width === "full" ? 0 : cardRadius(style, theme);
  const height = HEIGHTS[card.height];
  const overlayColor = safeColor(style.overlayColor, "#000000");
  const overlay = Math.min(0.9, Math.max(0, style.overlay));
  const parallax = card.animation.type === "parallax" ? card.animation.strength : null;
  const hasMedia = Boolean(media);

  // Words over a picture are light unless the card says otherwise; with no
  // picture they're the page's own.
  const words: CSSProperties = hasMedia
    ? ({
        "--lb-h": safeColor(style.headingColor, "#FFFFFF"),
        "--lb-t": safeColor(style.textColor, "#FFFFFF"),
        "--lb-m": withAlpha(safeColor(style.textColor, "#FFFFFF"), 0.85),
        "--lb-ink": withAlpha(safeColor(style.textColor, "#FFFFFF"), 0.9),
        "--lb-btn-bg": "transparent",
        "--lb-btn-fg": safeColor(style.textColor, "#FFFFFF"),
        color: "var(--lb-t)",
        // A soft halo, so light words still read over a bright product shot.
        textShadow: "0 1px 2px rgba(0,0,0,0.25), 0 2px 22px rgba(0,0,0,0.35)",
      } as CSSProperties)
    : {};

  const vertical = style.align === "center" ? "justify-center" : "justify-end";

  return (
    <CardFrame card={card} bare>
      <div
        className="relative isolate overflow-hidden"
        style={{
          borderRadius: radius,
          height,
          minHeight: height ? undefined : hasMedia ? undefined : "60vh",
          background: hasMedia ? (theme.dark ? "#000" : "#0d0d0d") : "var(--lb-surface)",
        }}
      >
        {media && style.fit === "whole" && media.kind === "image" && height && (
          // Behind a picture shown whole, the same picture blurred, so the
          // space around it is its own colour rather than a flat band.
          // eslint-disable-next-line @next/next/no-img-element -- decorative, the small copy blurred
          <img src={thumbOf(media)} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-110 object-cover opacity-60 blur-2xl" />
        )}
        <MediaView
          media={media}
          slot="media"
          kind={media?.kind ?? "image"}
          fit={style.fit}
          aspect={height ? "auto" : style.aspect}
          layout={height ? "cover" : "intrinsic"}
          sizes="100vw"
          priority={firstCardId === card.id}
          parallax={parallax}
          fallbackRatio={16 / 9}
          label="Add the hero photo or clip"
        />
        {hasMedia && overlay > 0 && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background: `linear-gradient(to top, ${withAlpha(overlayColor, Math.min(0.95, overlay * 1.6))} 0%, ${withAlpha(overlayColor, overlay * 0.7)} 45%, ${withAlpha(overlayColor, overlay * 0.35)} 100%)`,
            }}
          />
        )}
        <div
          className={cn("pointer-events-none absolute inset-0 flex flex-col", vertical, !hasMedia && "relative")}
          style={{
            ...words,
            padding: "var(--lb-pad-y) calc(var(--lb-pad-x) + var(--lb-edge))",
            paddingTop: "calc(var(--lb-pad-y) + 3.5rem)",
          }}
        >
          <div className="pointer-events-auto mx-auto w-full" style={{ maxWidth: theme.maxWidth }}>
            <HeroText card={card} wide />
          </div>
        </div>
        {card.height === "screen" && hasMedia && <ScrollCue card={card} />}
      </div>
    </CardFrame>
  );
}

/** Picture on one side, words on the other; stacked on a phone. */
function SplitHero({ card }: { card: HeroCardType }) {
  const { theme, firstCardId } = useRender();
  const zoom = useHeroZoom(card);
  const { style } = card;
  const radius = cardRadius(style, theme);
  const pictureRight = style.align === "right";
  return (
    <CardFrame card={card}>
      <div className="grid items-center gap-8 @2xl:grid-cols-2 @2xl:gap-14" style={{ minHeight: HEIGHTS[card.height] }}>
        <div className={cn(pictureRight && "@2xl:order-2")}>
          <MediaView
            media={card.media}
            slot="media"
            kind={card.media?.kind ?? "image"}
            fit={style.fit}
            aspect={style.aspect}
            sizes={sizesFor({ desktop: 0.5, mobile: 1, maxWidth: theme.maxWidth })}
            radius={radius}
            priority={firstCardId === card.id}
            onZoom={zoom}
            parallax={card.animation.type === "parallax" ? card.animation.strength : null}
            label="Add the hero photo or clip"
          />
        </div>
        <div className="py-2">
          <HeroText card={card} />
        </div>
      </div>
    </CardFrame>
  );
}

/** Words first, the picture underneath at its own shape. */
function StackedHero({ card }: { card: HeroCardType }) {
  const { theme, firstCardId } = useRender();
  const zoom = useHeroZoom(card);
  const { style } = card;
  return (
    <CardFrame card={card}>
      <div className="flex flex-col gap-8 @2xl:gap-12">
        <HeroText card={card} wide />
        <MediaView
          media={card.media}
          slot="media"
          kind={card.media?.kind ?? "image"}
          fit={style.fit}
          aspect={style.aspect}
          sizes={sizesFor({ desktop: 1, mobile: 1, maxWidth: theme.maxWidth })}
          radius={cardRadius(style, theme)}
          priority={firstCardId === card.id}
          onZoom={zoom}
          parallax={card.animation.type === "parallax" ? card.animation.strength : null}
          fallbackRatio={16 / 9}
          label="Add the hero photo or clip"
        />
      </div>
    </CardFrame>
  );
}

/** The picture in a fine frame, like a print, with the words beneath. */
function FramedHero({ card }: { card: HeroCardType }) {
  const { theme, firstCardId } = useRender();
  const zoom = useHeroZoom(card);
  const { style } = card;
  const radius = cardRadius(style, theme);
  return (
    <CardFrame card={card}>
      <div className="flex flex-col items-center gap-8 @2xl:gap-12" style={{ minHeight: HEIGHTS[card.height] }}>
        <div
          className="w-full max-w-[34rem] p-2.5 @2xl:p-3.5"
          style={{ border: "1px solid var(--lb-line)", borderRadius: radius ? radius + 10 : 0 }}
        >
          <MediaView
            media={card.media}
            slot="media"
            kind={card.media?.kind ?? "image"}
            fit={style.fit}
            aspect={style.aspect}
            sizes={sizesFor({ desktop: 0.5, mobile: 0.92, maxWidth: 1088 })}
            radius={radius}
            priority={firstCardId === card.id}
            onZoom={zoom}
            parallax={card.animation.type === "parallax" ? card.animation.strength : null}
            label="Add the hero photo or clip"
          />
        </div>
        <div className="w-full">
          <HeroText card={card} wide />
        </div>
      </div>
    </CardFrame>
  );
}

function HeroButton({ card }: { card: HeroCardType }) {
  const { theme, cards, scrollToCard } = useRender();
  const editable = useEditable();
  if (card.buttonTarget === "none" || (!card.buttonLabel && !editable)) return null;

  const index = cards.findIndex((entry) => entry.id === card.id);
  const target =
    card.buttonTarget === "contact"
      ? cards.find((entry) => entry.type === "contact" && !entry.hidden)
      : cards.slice(index + 1).find((entry) => !entry.hidden);
  const overlay = card.style.variant === "overlay" && Boolean(card.media);

  return (
    <a
      href={target ? `#lb-${target.id}` : undefined}
      onClick={(event) => {
        event.preventDefault();
        if (!editable && target) scrollToCard(target.id);
      }}
      className="lb-button mt-3"
      style={{
        borderRadius: buttonRadius(cardRadius(card.style, theme)),
        ...(overlay ? { border: "1px solid currentColor", background: "transparent", color: "var(--lb-btn-fg)" } : {}),
      }}
    >
      <Txt value={card.buttonLabel} path={["buttonLabel"]} placeholder="Button" />
    </a>
  );
}

/** A small nudge at the foot of a full-screen hero: there's more below. */
function ScrollCue({ card }: { card: HeroCardType }) {
  const { cards, scrollToCard, mode } = useRender();
  const index = cards.findIndex((entry) => entry.id === card.id);
  const next = cards.slice(index + 1).find((entry) => !entry.hidden);
  if (!next || mode === "thumbnail") return null;
  return (
    <button
      type="button"
      aria-label="Scroll down"
      onClick={() => scrollToCard(next.id)}
      className="lb-cue absolute bottom-4 left-1/2 -translate-x-1/2 text-white/80 transition-colors hover:text-white"
    >
      <ChevronDown size={26} strokeWidth={1.25} />
    </button>
  );
}
