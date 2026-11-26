"use client";

import type { CSSProperties, ReactNode } from "react";
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, Trash2 } from "lucide-react";
import { safeColor, withAlpha } from "@/lib/lookbook/media";
import type { ResolvedTheme } from "@/lib/lookbook/theme";
import type { CardStyle, LookbookCard } from "@/lib/lookbook/types";
import { cn } from "@/lib/utils";
import { CardContext, useRender } from "./context";
import { Txt } from "./EditableText";
import { Reveal } from "./motion";
import type { Path } from "@/lib/lookbook/edit";

/** A card's colours: its own where it set them, the page's otherwise, the accent's on an accent card. */
export function cardColors(style: CardStyle, theme: ResolvedTheme) {
  const { colors } = theme;
  if (style.background === "accent") {
    return {
      background: colors.accent,
      text: safeColor(style.textColor, colors.accentText),
      heading: safeColor(style.headingColor, colors.accentText),
      muted: withAlpha(colors.accentText, 0.75),
      ink: colors.accentText,
      buttonBg: colors.accentText,
      buttonFg: colors.accent,
      line: withAlpha(colors.accentText, 0.25),
    };
  }
  const background =
    style.background === "surface" ? colors.surface : style.background === "custom" ? safeColor(style.bgColor, colors.surface) : null;
  const text = safeColor(style.textColor, colors.text);
  return {
    background,
    text,
    heading: safeColor(style.headingColor, colors.heading),
    muted: style.textColor ? withAlpha(text, 0.72) : colors.muted,
    ink: colors.accent,
    buttonBg: colors.accent,
    buttonFg: colors.accentText,
    line: withAlpha(text, 0.16),
  };
}

export const cardRadius = (style: CardStyle, theme: ResolvedTheme) => style.radius ?? theme.radius;

/** Buttons follow the page's corners: square stays square, round goes pill. */
export const buttonRadius = (radius: number) => (radius >= 18 ? 999 : radius);

/**
 * The frame every card sits in: its width on the page, its background and
 * padding, its entrance, and in the builder, its selection outline and tools.
 *
 * `bare` cards (the hero, the spacer) lay out their own padding and
 * background, because theirs isn't a plain box.
 */
export function CardFrame({
  card,
  bare = false,
  reveal = true,
  children,
}: {
  card: LookbookCard;
  bare?: boolean;
  /** False for a card that animates its own parts (the gallery staggers its tiles). */
  reveal?: boolean;
  children: ReactNode;
}) {
  const { theme, mode, editor } = useRender();
  const { style } = card;
  const colors = cardColors(style, theme);
  const radius = cardRadius(style, theme);
  const editing = mode === "edit" && editor !== null;
  const selected = editing && editor.selectedId === card.id;

  const maxWidth = style.width === "full" ? undefined : style.width === "wide" ? theme.maxWidth : Math.min(theme.maxWidth, 780);
  const vars = {
    "--lb-scale": String(Math.min(2, Math.max(0.6, style.textScale || 1))),
    "--lb-t": colors.text,
    "--lb-h": colors.heading,
    "--lb-m": colors.muted,
    "--lb-ink": colors.ink,
    "--lb-btn-bg": colors.buttonBg,
    "--lb-btn-fg": colors.buttonFg,
    "--lb-line": colors.line,
    "--lb-r": `${radius}px`,
    "--lb-pad-y": `${clampNumber(style.paddingY, 0, 240)}px`,
    "--lb-pad-x": `${clampNumber(style.paddingX, 0, 160)}px`,
    color: colors.text,
    textAlign: style.align,
    marginTop: clampNumber(style.spaceAbove, 0, 240) || undefined,
  } as CSSProperties;

  const box: CSSProperties = bare
    ? {}
    : {
        background: colors.background ?? undefined,
        borderRadius: colors.background ? radius : undefined,
        padding: "var(--lb-pad-y) var(--lb-pad-x)",
      };

  const body = <div style={box}>{children}</div>;

  return (
    <CardContext.Provider value={card}>
      <section
        id={`lb-${card.id}`}
        data-card={card.type}
        style={vars}
        className={cn(
          "lb-card relative",
          editing && "lb-card-editable",
          selected && "lb-card-selected",
          editing && card.hidden && "lb-card-hidden"
        )}
        onClickCapture={editing ? () => editor.select(card.id) : undefined}
      >
        <div
          className="mx-auto w-full"
          style={{
            maxWidth: maxWidth ? `calc(${maxWidth}px + 2 * var(--lb-edge))` : undefined,
            paddingInline: style.width === "full" ? undefined : "var(--lb-edge)",
          }}
        >
          {reveal ? (
            // Keyed on its settings so the builder replays a card's entrance when they change.
            <Reveal key={mode === "edit" ? JSON.stringify(card.animation) : undefined} animation={card.animation}>
              {body}
            </Reveal>
          ) : (
            body
          )}
        </div>
        {editing && <CardTools card={card} selected={selected} />}
      </section>
    </CardContext.Provider>
  );
}

function clampNumber(value: unknown, min: number, max: number) {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.min(max, Math.max(min, n));
}

/** The builder's per-card tools, on the card itself: move, copy, hide, remove. */
function CardTools({ card, selected }: { card: LookbookCard; selected: boolean }) {
  const { editor, cards } = useRender();
  if (!editor) return null;
  const index = cards.findIndex((entry) => entry.id === card.id);
  const tool = "flex h-7 w-7 items-center justify-center rounded-md text-white/85 transition-colors hover:bg-white/15 hover:text-white disabled:opacity-30";
  return (
    <>
      {card.hidden && (
        <span className="lb-ui absolute left-3 top-3 z-20 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
          Hidden
        </span>
      )}
      <div
        className={cn(
          "lb-ui absolute right-2 top-2 z-20 flex items-center gap-0.5 rounded-lg bg-[#16140F]/90 p-0.5 shadow-lg backdrop-blur transition-opacity",
          selected ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className={tool} title="Move up" disabled={index <= 0} onClick={() => editor.moveCard(card.id, -1)}>
          <ArrowUp size={14} />
        </button>
        <button type="button" className={tool} title="Move down" disabled={index >= cards.length - 1} onClick={() => editor.moveCard(card.id, 1)}>
          <ArrowDown size={14} />
        </button>
        <button type="button" className={tool} title="Duplicate" onClick={() => editor.duplicateCard(card.id)}>
          <Copy size={13} />
        </button>
        <button type="button" className={tool} title={card.hidden ? "Show on the page" : "Hide from the page"} onClick={() => editor.toggleHidden(card.id)}>
          {card.hidden ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>
        <button type="button" className={cn(tool, "hover:bg-red-500/30")} title="Delete card" onClick={() => editor.removeCard(card.id)}>
          <Trash2 size={13} />
        </button>
      </div>
    </>
  );
}

/* ── Type ────────────────────────────────────────────────────────────── */

type TextPartProps = {
  value: string;
  path: Path;
  placeholder?: string;
  className?: string;
  style?: CSSProperties;
};

export function Eyebrow({ value, path, placeholder = "Small heading", className, style }: TextPartProps) {
  return <Txt as="p" value={value} path={path} placeholder={placeholder} className={cn("lb-eyebrow", className)} style={style} />;
}

export function DisplayTitle({ value, path, placeholder = "Title", className, style }: TextPartProps) {
  return <Txt as="h1" value={value} path={path} placeholder={placeholder} multiline className={cn("lb-display", className)} style={style} />;
}

export function Title({ value, path, placeholder = "Title", className, style, as = "h2" }: TextPartProps & { as?: "h2" | "h3" }) {
  return <Txt as={as} value={value} path={path} placeholder={placeholder} multiline className={cn("lb-title", className)} style={style} />;
}

export function Lead({ value, path, placeholder = "A line or two", className, style }: TextPartProps) {
  return <Txt as="p" value={value} path={path} placeholder={placeholder} multiline className={cn("lb-lead", className)} style={style} />;
}

export function Body({ value, path, placeholder = "Write something", className, style }: TextPartProps) {
  return <Txt as="p" value={value} path={path} placeholder={placeholder} multiline className={cn("lb-body", className)} style={style} />;
}

/** Where text sits across its column: the card's alignment, as flexbox needs it. */
export const justifyFor = (align: CardStyle["align"]) => (align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center");
