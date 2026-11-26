"use client";

import type { SpacerCard as SpacerCardType, StoryCard as StoryCardType } from "@/lib/lookbook/types";
import { cn } from "@/lib/utils";
import { useEditable, useRender } from "../context";
import { Txt } from "../EditableText";
import { Body, CardFrame, Eyebrow, Title, justifyFor } from "../parts";

/** Words: a paragraph, a pull quote, two columns, or a drop cap. */
export function StoryCard({ card }: { card: StoryCardType }) {
  const editable = useEditable();
  const { style } = card;
  const variant = style.variant;
  const signature = (editable || card.signature) && (
    <Txt
      as="p"
      value={card.signature}
      path={["signature"]}
      placeholder="Signature"
      className="lb-small mt-2 uppercase tracking-[0.22em]"
      style={{ color: "var(--lb-m)" }}
    />
  );

  if (variant === "quote") {
    return (
      <CardFrame card={card}>
        <figure className="m-0 flex flex-col gap-5" style={{ alignItems: justifyFor(style.align) }}>
          <span aria-hidden className="lb-quote-mark">“</span>
          <Txt as="blockquote" value={card.body} path={["body"]} placeholder="A line worth quoting" multiline className="lb-quote m-0" />
          {(editable || card.signature) && <figcaption>{signature}</figcaption>}
        </figure>
      </CardFrame>
    );
  }

  if (variant === "columns") {
    return (
      <CardFrame card={card}>
        <div className="grid gap-6 @3xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] @3xl:gap-14" style={{ textAlign: "left" }}>
          <div className="flex flex-col gap-3">
            <Eyebrow value={card.eyebrow} path={["eyebrow"]} />
            <Title value={card.title} path={["title"]} placeholder="Title" />
          </div>
          <div>
            <Body value={card.body} path={["body"]} placeholder="Write the story" className="@4xl:columns-2 @4xl:gap-10" />
            {signature}
          </div>
        </div>
      </CardFrame>
    );
  }

  return (
    <CardFrame card={card}>
      <div className="flex flex-col gap-4" style={{ alignItems: justifyFor(style.align) }}>
        <Eyebrow value={card.eyebrow} path={["eyebrow"]} />
        <Title value={card.title} path={["title"]} placeholder="Title" />
        <Body
          value={card.body}
          path={["body"]}
          placeholder="Write the story"
          className={cn("mt-1", variant === "dropcap" && "lb-dropcap")}
          style={{ maxWidth: "62ch", textAlign: variant === "dropcap" ? "left" : undefined }}
        />
        {signature}
      </div>
    </CardFrame>
  );
}

/** Room to breathe between cards: space, a hairline, an ornament or three dots. */
export function SpacerCard({ card }: { card: SpacerCardType }) {
  const { mode } = useRender();
  const height = Math.min(320, Math.max(0, card.height));
  const variant = card.style.variant;
  return (
    <CardFrame card={card} bare>
      <div
        className={cn("flex items-center justify-center", mode === "edit" && variant === "space" && "lb-spacer-guide")}
        style={{ minHeight: Math.max(height, mode === "edit" ? 16 : 0) }}
        aria-hidden
      >
        {variant === "line" && <div className="h-px w-full" style={{ background: "var(--lb-line)" }} />}
        {variant === "ornament" && (
          <div className="flex w-full max-w-sm items-center gap-4" style={{ color: "var(--lb-ink)" }}>
            <span className="h-px flex-1" style={{ background: "currentColor", opacity: 0.45 }} />
            <span className="h-2 w-2 rotate-45" style={{ background: "currentColor" }} />
            <span className="h-px flex-1" style={{ background: "currentColor", opacity: 0.45 }} />
          </div>
        )}
        {variant === "dots" && (
          <div className="flex gap-2.5" style={{ color: "var(--lb-ink)" }}>
            {[0, 1, 2].map((dot) => (
              <span key={dot} className="h-1.5 w-1.5 rounded-full" style={{ background: "currentColor" }} />
            ))}
          </div>
        )}
      </div>
    </CardFrame>
  );
}
