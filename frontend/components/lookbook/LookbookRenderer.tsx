"use client";

import { useMemo, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { useReducedMotion } from "framer-motion";
import { resolveTheme } from "@/lib/lookbook/theme";
import type { LookbookCard, LookbookDesign } from "@/lib/lookbook/types";
import { cn } from "@/lib/utils";
import { RenderContext, useRender, type EditorBridge, type RenderContextValue, type RenderMode } from "./context";
import { BeforeAfterCard } from "./cards/BeforeAfterCard";
import { ContactCard, FloatingContact } from "./cards/ContactCard";
import { GalleryCard } from "./cards/GalleryCard";
import { HeroCard } from "./cards/HeroCard";
import { SpecsCard } from "./cards/SpecsCard";
import { SpotlightCard } from "./cards/SpotlightCard";
import { SpacerCard, StoryCard } from "./cards/TextCards";
import { VideoCard } from "./cards/VideoCard";
import { ZoomLightbox, type ZoomItem } from "./ZoomLightbox";

type RendererProps = {
  design: LookbookDesign;
  mode: RenderMode;
  editor?: EditorBridge | null;
  /** The scrolling element when it isn't the window: the builder's preview pane. */
  scrollRoot?: RefObject<HTMLElement | null> | null;
  /** Height of "one screen" in px, for a preview frame. Omitted, it's the real screen (100svh). */
  screenHeight?: number | null;
  /** Drawn after the last card, inside the page: the builder's "add a card" prompt. */
  footer?: ReactNode;
  className?: string;
};

/**
 * Draws a lookbook. The same component serves the public page, the builder's
 * live preview and the template cards, so what someone designs is exactly
 * what their client will see.
 *
 * Layout answers to the page's own width (a CSS container), not the
 * browser's. The builder's phone preview gets the phone layout while sitting
 * in a desktop browser.
 */
export function LookbookRenderer({ design, mode, editor = null, scrollRoot = null, screenHeight = null, footer, className }: RendererProps) {
  const theme = useMemo(() => resolveTheme(design.theme), [design.theme]);
  const reduceMotion = useReducedMotion() ?? false;
  const [zoom, setZoom] = useState<{ items: ZoomItem[]; index: number } | null>(null);

  // Hidden cards stay visible (dimmed) in the editor and nowhere else.
  const cards = useMemo(() => (mode === "edit" ? design.cards : design.cards.filter((card) => !card.hidden)), [design.cards, mode]);

  const firstCardId = cards[0]?.id ?? null;
  const value = useMemo<RenderContextValue>(
    () => ({
      mode,
      theme,
      editor,
      scrollRoot,
      reduceMotion,
      firstCardId,
      openZoom: (items, index) => {
        if (mode === "public" || mode === "preview") setZoom({ items, index });
      },
      scrollToCard: (id) => scrollToCard(id, scrollRoot, reduceMotion),
      cards,
    }),
    [mode, theme, editor, scrollRoot, reduceMotion, firstCardId, cards]
  );

  const { colors } = theme;
  const rootStyle = {
    "--lb-bg": colors.bg,
    "--lb-surface": colors.surface,
    "--lb-text": colors.text,
    "--lb-heading": colors.heading,
    "--lb-muted": colors.muted,
    "--lb-accent": colors.accent,
    "--lb-accent-text": colors.accentText,
    "--lb-line": colors.line,
    "--lb-t": colors.text,
    "--lb-h": colors.heading,
    "--lb-m": colors.muted,
    "--lb-ink": colors.accent,
    "--lb-btn-bg": colors.accent,
    "--lb-btn-fg": colors.accentText,
    "--lb-display-font": theme.display.family,
    "--lb-display-weight": String(theme.display.weight),
    "--lb-display-case": theme.display.uppercase ? "uppercase" : "none",
    "--lb-display-tracking": `${theme.display.tracking}em`,
    "--lb-display-scale": String(theme.display.scale),
    "--lb-heading-font": theme.heading.family,
    "--lb-heading-weight": String(theme.heading.weight),
    "--lb-heading-case": theme.heading.uppercase ? "uppercase" : "none",
    "--lb-heading-tracking": `${theme.heading.tracking}em`,
    "--lb-heading-scale": String(theme.heading.scale),
    "--lb-body-font": theme.body,
    "--lb-base": `${theme.baseSize}px`,
    "--lb-screen": screenHeight ? `${screenHeight}px` : "100svh",
    background: theme.pageBackground,
    color: colors.text,
  } as CSSProperties;

  const first = cards[0];
  const headerOverFirst = first?.type === "hero" && first.style.variant === "overlay" && Boolean(first.media);

  return (
    <RenderContext.Provider value={value}>
      <style href="sparkle-lookbook" precedence="default">
        {LOOKBOOK_CSS}
      </style>
      <div className={cn("lb-root @container relative", className)} style={rootStyle} data-mode={mode}>
        <BrandHeader overlay={headerOverFirst} />
        <main className="flex flex-col" style={{ gap: theme.gap, paddingBottom: theme.gap ? Math.max(theme.gap, 32) : 32 }}>
          {cards.map((card) => (
            <CardView key={card.id} card={card} />
          ))}
          {footer}
        </main>
        <FloatingContact cards={cards} />
      </div>
      {zoom && <ZoomLightbox items={zoom.items} index={zoom.index} onClose={() => setZoom(null)} />}
    </RenderContext.Provider>
  );
}

/** Scrolls a card to the top of the page, or of the builder's preview when that's what scrolls. */
function scrollToCard(id: string, scrollRoot: RefObject<HTMLElement | null> | null, reduceMotion: boolean) {
  const target = document.getElementById(`lb-${id}`);
  if (!target) return;
  const behavior = reduceMotion ? "auto" : "smooth";
  const root = scrollRoot?.current;
  if (root) {
    // Layout offsets rather than screen rectangles: the builder's phone preview may be scaled.
    let top = 0;
    let node: HTMLElement | null = target;
    while (node && node !== root) {
      top += node.offsetTop;
      node = node.offsetParent as HTMLElement | null;
    }
    root.scrollTo({ top, behavior });
  } else {
    target.scrollIntoView({ behavior, block: "start" });
  }
}

function CardView({ card }: { card: LookbookCard }) {
  switch (card.type) {
    case "hero":
      return <HeroCard card={card} />;
    case "gallery":
      return <GalleryCard card={card} />;
    case "spotlight":
      return <SpotlightCard card={card} />;
    case "before_after":
      return <BeforeAfterCard card={card} />;
    case "video":
      return <VideoCard card={card} />;
    case "story":
      return <StoryCard card={card} />;
    case "specs":
      return <SpecsCard card={card} />;
    case "contact":
      return <ContactCard card={card} />;
    case "spacer":
      return <SpacerCard card={card} />;
    default:
      return null;
  }
}

/** The brand's logo or name at the top of the page, over the hero picture when the page opens with one. */
function BrandHeader({ overlay }: { overlay: boolean }) {
  const { theme } = useRender();
  const { raw } = theme;
  if (raw.logoPlacement === "hidden" || (!raw.logo && !raw.brandName)) return null;
  const justify = raw.logoPlacement === "left" ? "flex-start" : raw.logoPlacement === "right" ? "flex-end" : "center";
  const size = Math.min(140, Math.max(16, raw.logoSize || 40));
  return (
    <header
      className={cn("lb-header z-20 flex items-center gap-3", overlay ? "absolute inset-x-0 top-0" : "relative")}
      style={{
        justifyContent: justify,
        padding: "clamp(16px, 3cqw, 28px) var(--lb-edge)",
        color: overlay ? "#FFFFFF" : "var(--lb-heading)",
        maxWidth: overlay ? undefined : theme.maxWidth + 96,
        marginInline: "auto",
        width: "100%",
      }}
    >
      {raw.logo && (
        // eslint-disable-next-line @next/next/no-img-element -- the logo's own file: a cutout's thumbnail would lose its transparency
        <img src={raw.logo.url} alt={raw.brandName || "Logo"} style={{ height: size, width: "auto", maxWidth: "60%" }} className="block object-contain" />
      )}
      {raw.brandName && <span className="lb-brand">{raw.brandName}</span>}
    </header>
  );
}

/**
 * The renderer's own stylesheet, scoped under `.lb-root`. Type sizes are in
 * container units (cqw) so they scale with the page's width wherever it is
 * drawn, a phone frame included, and every card multiplies them by its own
 * text size (--lb-scale).
 */
const LOOKBOOK_CSS = `
.lb-root { container-type: inline-size; --lb-edge: clamp(16px, 5cqw, 48px); font-family: var(--lb-body-font); font-size: var(--lb-base); line-height: 1.6; -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; overflow-x: clip; }
.lb-root *, .lb-root *::before, .lb-root *::after { box-sizing: border-box; }
.lb-root h1, .lb-root h2, .lb-root h3, .lb-root p, .lb-root figure, .lb-root blockquote, .lb-root dl, .lb-root dd { margin: 0; }
.lb-root .lb-display { font-family: var(--lb-display-font); font-weight: var(--lb-display-weight); text-transform: var(--lb-display-case); letter-spacing: var(--lb-display-tracking); font-size: calc(clamp(2.6rem, 9.5cqw, 7.25rem) * var(--lb-scale, 1) * var(--lb-display-scale, 1)); line-height: 1.02; color: var(--lb-h); text-wrap: balance; }
.lb-root .lb-title { font-family: var(--lb-heading-font); font-weight: var(--lb-heading-weight); text-transform: var(--lb-heading-case); letter-spacing: var(--lb-heading-tracking); font-size: calc(clamp(1.65rem, 4.4cqw, 3.25rem) * var(--lb-scale, 1) * var(--lb-heading-scale, 1)); line-height: 1.12; color: var(--lb-h); text-wrap: balance; }
.lb-root .lb-lead { font-size: calc(clamp(1.02rem, 1.7cqw, 1.35rem) * var(--lb-scale, 1)); line-height: 1.55; }
.lb-root .lb-body { font-size: calc(var(--lb-base) * var(--lb-scale, 1)); line-height: 1.75; text-wrap: pretty; }
.lb-root .lb-small { font-size: calc(0.8rem * var(--lb-scale, 1)); line-height: 1.5; }
.lb-root .lb-eyebrow { font-family: var(--lb-body-font); font-size: calc(0.72rem * var(--lb-scale, 1)); font-weight: 500; letter-spacing: 0.28em; text-transform: uppercase; color: var(--lb-ink); }
.lb-root .lb-price { font-family: var(--lb-heading-font); font-size: calc(clamp(1.35rem, 2.6cqw, 2rem) * var(--lb-scale, 1)); color: var(--lb-h); letter-spacing: 0.02em; }
.lb-root .lb-row-name { font-family: var(--lb-heading-font); font-size: calc(1.08rem * var(--lb-scale, 1) * var(--lb-heading-scale, 1)); color: var(--lb-h); }
.lb-root .lb-row-price { font-size: calc(1rem * var(--lb-scale, 1)); color: var(--lb-h); font-variant-numeric: tabular-nums; }
.lb-root .lb-quote { font-family: var(--lb-heading-font); font-style: italic; font-size: calc(clamp(1.5rem, 3.6cqw, 2.6rem) * var(--lb-scale, 1) * var(--lb-heading-scale, 1)); line-height: 1.3; color: var(--lb-h); text-wrap: balance; max-width: 28ch; }
.lb-root .lb-quote-mark { font-family: var(--lb-display-font); font-size: calc(4.5rem * var(--lb-scale, 1)); line-height: 0.6; color: var(--lb-ink); height: 0.45em; }
.lb-root .lb-dropcap::first-letter { float: left; font-family: var(--lb-display-font); font-size: 4.1em; line-height: 0.82; padding: 0.06em 0.12em 0 0; color: var(--lb-ink); }
.lb-root .lb-brand { font-family: var(--lb-heading-font); font-size: calc(1.05rem * var(--lb-heading-scale, 1)); letter-spacing: 0.22em; text-transform: uppercase; }
.lb-root .lb-pill { font-family: var(--lb-body-font); font-size: 0.7rem; letter-spacing: 0.18em; text-transform: uppercase; }
.lb-root .lb-button { display: inline-flex; align-items: center; gap: 0.6em; padding: 0.95em 1.9em; font-family: var(--lb-body-font); font-size: calc(0.78rem * var(--lb-scale, 1)); font-weight: 500; letter-spacing: 0.16em; text-transform: uppercase; background: var(--lb-btn-bg); color: var(--lb-btn-fg); text-decoration: none; transition: transform 200ms ease, opacity 200ms ease; cursor: pointer; }
.lb-root .lb-button:hover { opacity: 0.9; }
.lb-root .lb-button:active { transform: scale(0.98); }
.lb-root .lb-contact { min-height: 50px; letter-spacing: 0.08em; text-transform: none; font-size: calc(0.95rem * var(--lb-scale, 1)); }
.lb-root .lb-carousel { scroll-snap-type: x mandatory; overscroll-behavior-x: contain; -webkit-overflow-scrolling: touch; }
.lb-root .lb-carousel > * { scroll-snap-align: start; }
.lb-root .lb-cue { animation: lb-cue 2.4s ease-in-out infinite; }
@keyframes lb-cue { 0%, 100% { transform: translate(-50%, 0); opacity: 0.8; } 50% { transform: translate(-50%, 6px); opacity: 1; } }
.lb-root .lb-ui { font-family: var(--font-inter), Inter, system-ui, sans-serif; letter-spacing: normal; text-transform: none; }
.lb-root .lb-editable:empty::before { content: attr(data-placeholder); opacity: 0.38; pointer-events: none; }
.lb-root .lb-editable:hover { box-shadow: 0 0 0 1px rgba(196, 168, 106, 0.45); border-radius: 2px; }
.lb-root .lb-editable:focus { box-shadow: 0 0 0 1.5px rgba(196, 168, 106, 0.95); border-radius: 2px; }
.lb-root .lb-card-editable { outline: 1px dashed transparent; outline-offset: -1px; transition: outline-color 150ms ease; }
.lb-root .lb-card-editable:hover { outline-color: rgba(196, 168, 106, 0.55); }
.lb-root .lb-card-selected, .lb-root .lb-card-selected:hover { outline: 2px solid #C4A86A; outline-offset: -2px; }
.lb-root .lb-card-hidden > :not(.lb-ui) { opacity: 0.4; }
.lb-root .lb-spacer-guide { background: repeating-linear-gradient(45deg, transparent 0 6px, rgba(196, 168, 106, 0.12) 6px 7px); }
@media (prefers-reduced-motion: reduce) { .lb-root .lb-cue { animation: none; } }
`;
