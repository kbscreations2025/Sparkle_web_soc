"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ChevronsLeftRight } from "lucide-react";
import { ASPECT_RATIOS, naturalRatio, sizesFor } from "@/lib/lookbook/media";
import type { BeforeAfterCard as BeforeAfterCardType } from "@/lib/lookbook/types";
import { useEditable, useRender } from "../context";
import { Txt } from "../EditableText";
import { MediaView } from "../MediaView";
import { Body, CardFrame, Title, cardRadius, justifyFor } from "../parts";

/** Two photos of the same piece, compared by dragging a line across them, or side by side. */
export function BeforeAfterCard({ card }: { card: BeforeAfterCardType }) {
  const { mode } = useRender();
  const editable = useEditable();
  const complete = Boolean(card.before && card.after);
  if (mode === "public" && !complete) return null;

  return (
    <CardFrame card={card}>
      <div className="flex flex-col gap-6 @2xl:gap-8">
        {(editable || card.title || card.caption) && (
          <div className="flex flex-col gap-3" style={{ alignItems: justifyFor(card.style.align) }}>
            <Title value={card.title} path={["title"]} placeholder="Title" />
            <Body value={card.caption} path={["caption"]} placeholder="A line about the change" style={{ maxWidth: "48ch", color: "var(--lb-m)" }} />
          </div>
        )}
        {card.style.variant === "side-by-side" || !complete ? <SideBySide card={card} /> : <Slider card={card} />}
      </div>
    </CardFrame>
  );
}

function SideBySide({ card }: { card: BeforeAfterCardType }) {
  const { theme } = useRender();
  const { style } = card;
  const ratio = ASPECT_RATIOS[style.aspect] ?? naturalRatio(card.after) ?? naturalRatio(card.before) ?? 4 / 5;
  const aspect = style.aspect === "auto" ? (ratio === 1 ? "1:1" : style.aspect) : style.aspect;
  const half = sizesFor({ desktop: 0.5, mobile: 0.5, maxWidth: theme.maxWidth });
  const radius = cardRadius(style, theme);
  return (
    <div className="grid grid-cols-2 gap-3 @2xl:gap-5">
      {(["before", "after"] as const).map((side) => (
        <figure key={side} className="m-0 flex flex-col gap-2.5">
          <MediaView
            media={card[side]}
            slot={side}
            fit={style.fit}
            aspect={aspect}
            fallbackRatio={ratio}
            sizes={half}
            radius={radius}
            label={side === "before" ? "Add the before photo" : "Add the after photo"}
            style={card[side] && style.aspect === "auto" ? { aspectRatio: String(ratio) } : undefined}
          />
          <Txt
            as="figcaption"
            value={side === "before" ? card.beforeLabel : card.afterLabel}
            path={[side === "before" ? "beforeLabel" : "afterLabel"]}
            placeholder={side === "before" ? "Before" : "After"}
            className="lb-eyebrow text-center"
          />
        </figure>
      ))}
    </div>
  );
}

/**
 * The comparison slider. Dragging sideways moves the line; dragging up and
 * down still scrolls the page (`touch-action: pan-y`), so it never traps a
 * thumb. Arrow keys move it too.
 */
function Slider({ card }: { card: BeforeAfterCardType }) {
  const { theme } = useRender();
  const { style } = card;
  const box = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [position, setPosition] = useState(card.start);
  // The inspector's starting point wins whenever it changes.
  const [startSeen, setStartSeen] = useState(card.start);
  if (card.start !== startSeen) {
    setStartSeen(card.start);
    setPosition(card.start);
  }

  const ratio = ASPECT_RATIOS[style.aspect] ?? naturalRatio(card.after) ?? naturalRatio(card.before) ?? 4 / 5;
  const radius = cardRadius(style, theme);
  const sizes = sizesFor({ desktop: 1, mobile: 1, maxWidth: Math.min(theme.maxWidth, 780) });

  const moveTo = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    setPosition(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)));
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest("[contenteditable], .lb-ui")) return;
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    moveTo(event.clientX);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.shiftKey ? 10 : 4;
    if (event.key === "ArrowLeft") setPosition((value) => Math.max(0, value - step));
    else if (event.key === "ArrowRight") setPosition((value) => Math.min(100, value + step));
    else return;
    event.preventDefault();
  };

  return (
    <div
      ref={box}
      className="relative mx-auto w-full select-none overflow-hidden"
      style={{ aspectRatio: String(ratio), borderRadius: radius, touchAction: "pan-y", cursor: "ew-resize", background: "var(--lb-surface)" }}
      onPointerDown={onPointerDown}
      onPointerMove={(event) => dragging.current && moveTo(event.clientX)}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
    >
      <MediaView media={card.before} slot="before" fit={style.fit} aspect="auto" layout="cover" sizes={sizes} />
      <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${position}%)` }}>
        <MediaView media={card.after} slot="after" fit={style.fit} aspect="auto" layout="cover" sizes={sizes} />
      </div>

      <Label side="left" value={card.beforeLabel} path="beforeLabel" />
      <Label side="right" value={card.afterLabel} path="afterLabel" />

      <div className="pointer-events-none absolute inset-y-0" style={{ left: `${position}%` }}>
        <div className="absolute inset-y-0 -translate-x-1/2 bg-white/90" style={{ width: 2, boxShadow: "0 0 12px rgba(0,0,0,0.35)" }} />
        <div
          role="slider"
          tabIndex={0}
          aria-label="Compare before and after"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(position)}
          onKeyDown={onKeyDown}
          className="lb-ui pointer-events-auto absolute top-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-black shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        >
          <ChevronsLeftRight size={18} />
        </div>
      </div>
    </div>
  );
}

function Label({ side, value, path }: { side: "left" | "right"; value: string; path: "beforeLabel" | "afterLabel" }) {
  const editable = useEditable();
  if (!value && !editable) return null;
  return (
    <div className="absolute top-3 z-10" style={side === "left" ? { left: 12 } : { right: 12 }}>
      <Txt
        as="span"
        value={value}
        path={[path]}
        placeholder={side === "left" ? "Before" : "After"}
        className="lb-pill inline-block rounded-full bg-black/55 px-3 py-1 text-white backdrop-blur-sm"
      />
    </div>
  );
}
