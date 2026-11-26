"use client";

import { Plus, X } from "lucide-react";
import { sizesFor } from "@/lib/lookbook/media";
import { uid } from "@/lib/lookbook/defaults";
import type { SpotlightCard as SpotlightCardType } from "@/lib/lookbook/types";
import { cn } from "@/lib/utils";
import { useEditable, useRender } from "../context";
import { Txt } from "../EditableText";
import { MediaView } from "../MediaView";
import { Body, CardFrame, Eyebrow, Title, cardRadius, justifyFor } from "../parts";

/** One piece, large, with what it's made of and, if the owner wants, its price. */
export function SpotlightCard({ card }: { card: SpotlightCardType }) {
  const { theme, openZoom } = useRender();
  const { style } = card;
  const variant = style.variant;
  const sideBySide = variant === "image-left" || variant === "image-right";
  const zoom = card.media?.kind === "image" ? () => openZoom([{ media: card.media!, caption: card.title }], 0) : undefined;

  const picture = (
    <MediaView
      media={card.media}
      slot="media"
      kind={card.media?.kind ?? "image"}
      fit={style.fit}
      aspect={style.aspect}
      sizes={sizesFor({ desktop: sideBySide ? 0.5 : variant === "centered" ? 0.55 : 1, mobile: 1, maxWidth: theme.maxWidth })}
      radius={cardRadius(style, theme)}
      onZoom={zoom}
      parallax={card.animation.type === "parallax" ? card.animation.strength : null}
      label="Add a photo of the piece"
    />
  );

  return (
    <CardFrame card={card}>
      {sideBySide ? (
        <div className="grid items-center gap-8 @2xl:grid-cols-2 @2xl:gap-16">
          <div className={cn(variant === "image-right" && "@2xl:order-2")}>{picture}</div>
          <SpotlightText card={card} />
        </div>
      ) : (
        <div className="flex flex-col gap-8 @2xl:gap-12">
          <div className={cn("w-full", variant === "centered" && "mx-auto max-w-[34rem]")}>{picture}</div>
          <div className="mx-auto w-full" style={{ maxWidth: variant === "centered" ? "40rem" : "46rem" }}>
            <SpotlightText card={card} />
          </div>
        </div>
      )}
    </CardFrame>
  );
}

function SpotlightText({ card }: { card: SpotlightCardType }) {
  const editable = useEditable();
  const { editor } = useRender();
  const { align } = card.style;
  const details = card.details.filter((detail) => editable || detail.label || detail.value);

  return (
    <div className="flex flex-col gap-4" style={{ alignItems: justifyFor(align) }}>
      <Eyebrow value={card.eyebrow} path={["eyebrow"]} />
      <Title value={card.title} path={["title"]} placeholder="Name of the piece" />
      <Body value={card.description} path={["description"]} placeholder="A few lines about the piece" style={{ maxWidth: "48ch" }} />

      {details.length > 0 && (
        <dl className="mt-2 w-full max-w-md" style={{ textAlign: "left" }}>
          {details.map((detail) => (
            <div
              key={detail.id}
              className="group/detail relative grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4 py-3"
              style={{ borderTop: "1px solid var(--lb-line)" }}
            >
              <Txt as="dt" value={detail.label} path={["details", detail.id, "label"]} placeholder="Label" keepEmpty className="lb-small uppercase tracking-[0.14em]" style={{ color: "var(--lb-m)" }} />
              <Txt as="dd" value={detail.value} path={["details", detail.id, "value"]} placeholder="Value" keepEmpty className="lb-body m-0" style={{ lineHeight: 1.5 }} />
              {editable && editor && (
                <button
                  type="button"
                  title="Remove this line"
                  onClick={() =>
                    editor.updateCard(card.id, (current) =>
                      current.type === "spotlight" ? { ...current, details: current.details.filter((entry) => entry.id !== detail.id) } : current
                    )
                  }
                  className="lb-ui absolute -right-7 top-3 flex h-5 w-5 items-center justify-center rounded-full opacity-0 transition-opacity hover:bg-black/10 group-hover/detail:opacity-70 touch:opacity-70"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          ))}
          <div style={{ borderTop: "1px solid var(--lb-line)" }} />
        </dl>
      )}
      {editable && editor && (
        <button
          type="button"
          onClick={() =>
            editor.updateCard(card.id, (current) =>
              current.type === "spotlight" ? { ...current, details: [...current.details, { id: uid(), label: "", value: "" }] } : current
            )
          }
          className="lb-ui flex items-center gap-1 text-[12px] font-medium opacity-60 transition-opacity hover:opacity-100"
        >
          <Plus size={13} /> Add a detail
        </button>
      )}

      {card.showPrice && (editable || card.price) && (
        <Txt as="p" value={card.price} path={["price"]} placeholder="Add a price" className="lb-price mt-2" />
      )}
    </div>
  );
}
