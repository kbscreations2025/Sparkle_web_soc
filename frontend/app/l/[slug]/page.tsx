import type { Metadata, Viewport } from "next";
import { notFound, redirect } from "next/navigation";
import { normalizeDesign } from "@/lib/lookbook/defaults";
import { safeColor } from "@/lib/lookbook/media";
import { PublicLookbook } from "./PublicLookbook";
import { PageUnavailable } from "./PageUnavailable";
import { readLookbook, requestOrigin } from "./data";

type Props = { params: Promise<{ slug: string }> };

/**
 * A shared Live Lookbook, for anyone with the link: no sign-in, read-only,
 * published pages only.
 *
 * Rendered on the server, so the first screen arrives as HTML with its
 * pictures already in it, before any script. The link-preview tags (title,
 * description, picture) are in the <head> for WhatsApp and the like, which
 * read nothing else. The proxy lets this one route through without a session
 * (proxy.ts, isPublicPath).
 */
export default async function PublicLookbookPage({ params }: Props) {
  const { slug } = await params;
  const result = await readLookbook(slug);

  // An old link name, or one typed in capitals: on to the page's current address.
  if (result.kind === "redirect") redirect(`/l/${result.slug}`);
  if (result.kind === "missing") notFound();
  if (result.kind === "unavailable") return <PageUnavailable busy />;

  const design = normalizeDesign(result.lookbook.design);
  return <PublicLookbook design={design} />;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const result = await readLookbook(slug);
  if (result.kind !== "found") {
    return { title: "Page not available", robots: { index: false, follow: false } };
  }

  const { lookbook } = result;
  const origin = await requestOrigin();
  const url = origin ? `${origin}/l/${lookbook.slug}` : undefined;
  // The page's own words when it has no description of its own. Null rather
  // than empty, so the preview doesn't inherit Sparkle's tagline from the root layout.
  const description = lookbook.description || leadText(normalizeDesign(lookbook.design)) || null;
  const image = lookbook.shareImage;
  const images = image
    ? [{ url: image.url, ...(image.width ? { width: image.width } : {}), ...(image.height ? { height: image.height } : {}), ...(image.type ? { type: image.type } : {}), alt: lookbook.title }]
    : undefined;

  return {
    title: lookbook.title,
    description,
    // Shared by link, like a private viewing room: kept out of search results.
    robots: { index: false, follow: false },
    alternates: url ? { canonical: url } : undefined,
    openGraph: { type: "website", title: lookbook.title, description: description ?? undefined, url, images },
    twitter: { card: images ? "summary_large_image" : "summary", title: lookbook.title, description: description ?? undefined, images: image ? [image.url] : undefined },
  };
}

/** A line for the preview from the page itself: the hero's subtitle, or the opening of its story. */
function leadText(design: ReturnType<typeof normalizeDesign>): string {
  for (const card of design.cards) {
    const text = card.type === "hero" ? card.subtitle : card.type === "story" ? card.body : "";
    const line = text.replace(/\s+/g, " ").trim();
    if (line) return line.length > 180 ? `${line.slice(0, 177).replace(/\s+\S*$/, "")}…` : line;
  }
  return "";
}

/** The phone's browser bar takes the page's own background colour. */
export async function generateViewport({ params }: Props): Promise<Viewport> {
  const { slug } = await params;
  const result = await readLookbook(slug);
  if (result.kind !== "found") return {};
  const design = normalizeDesign(result.lookbook.design);
  return { themeColor: safeColor(design.theme.bgColor, "#FFFFFF") };
}
