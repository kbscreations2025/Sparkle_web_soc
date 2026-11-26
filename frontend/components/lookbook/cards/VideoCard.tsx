"use client";

import type { CSSProperties } from "react";
import { ASPECT_RATIOS, naturalRatio, sizesFor } from "@/lib/lookbook/media";
import type { VideoCard as VideoCardType } from "@/lib/lookbook/types";
import { useEditable, useRender } from "../context";
import { MediaView } from "../MediaView";
import { Body, CardFrame, Title, cardRadius, justifyFor } from "../parts";

/** A turntable from Image to Video, or any clip: full width, framed, or in a phone. */
export function VideoCard({ card }: { card: VideoCardType }) {
  const { theme, mode } = useRender();
  const editable = useEditable();
  if (mode === "public" && !card.media) return null;
  const { style } = card;
  const variant = style.variant;
  const radius = cardRadius(style, theme);

  const clip = (extra?: { layout?: "cover"; style?: CSSProperties }) => (
    <MediaView
      media={card.media}
      slot="media"
      kind="video"
      fit={style.fit}
      aspect={extra?.layout ? "auto" : style.aspect}
      layout={extra?.layout}
      sizes={sizesFor({ desktop: 1, mobile: 1, maxWidth: theme.maxWidth })}
      radius={extra?.layout ? undefined : radius}
      fallbackRatio={variant === "phone" ? 9 / 16 : 16 / 9}
      label="Add a turntable or clip"
      style={extra?.style}
    />
  );

  let body;
  if (variant === "phone") {
    const ratio = ASPECT_RATIOS[style.aspect] ?? (naturalRatio(card.media) && naturalRatio(card.media)! < 1 ? naturalRatio(card.media)! : 9 / 16);
    body = (
      <div
        className="relative mx-auto w-[min(19rem,74%)] overflow-hidden bg-black"
        style={{ aspectRatio: String(ratio), borderRadius: 38, border: "9px solid #111", boxShadow: "0 30px 60px -20px rgba(0,0,0,0.45)" }}
      >
        {clip({ layout: "cover" })}
      </div>
    );
  } else if (variant === "framed") {
    body = (
      <div className="mx-auto w-full max-w-[46rem]" style={{ boxShadow: "0 30px 70px -30px rgba(0,0,0,0.5)", borderRadius: radius }}>
        {clip()}
      </div>
    );
  } else {
    body = clip();
  }

  return (
    <CardFrame card={card}>
      <div className="flex flex-col gap-6 @2xl:gap-8">
        {(editable || card.title) && (
          <div className="flex flex-col" style={{ alignItems: justifyFor(style.align) }}>
            <Title value={card.title} path={["title"]} placeholder="Title" />
          </div>
        )}
        {body}
        {(editable || card.caption) && (
          <div className="flex flex-col" style={{ alignItems: justifyFor(style.align) }}>
            <Body value={card.caption} path={["caption"]} placeholder="A line under the clip" style={{ color: "var(--lb-m)", maxWidth: "48ch" }} />
          </div>
        )}
      </div>
    </CardFrame>
  );
}
