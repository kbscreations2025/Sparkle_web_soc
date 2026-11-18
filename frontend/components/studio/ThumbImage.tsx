"use client";

import Image from "next/image";
import { useThumbnail } from "@/lib/thumbnail";

/**
 * A `fill` image of a stored picture, drawn small: its thumbnail, falling
 * back to the original if there isn't one (see useThumbnail). For tiles and
 * strips only. Where the picture is looked at full size (the stage, the
 * lightbox, a download), use the original.
 */
export function ThumbImage({ src, alt, sizes, className }: { src: string; alt: string; sizes: string; className?: string }) {
  const [shown, onError] = useThumbnail(src);
  return <Image src={shown ?? src} alt={alt} fill sizes={sizes} className={className} onError={onError} />;
}
