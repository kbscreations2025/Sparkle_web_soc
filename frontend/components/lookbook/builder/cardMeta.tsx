import { AlignLeft, Clapperboard, Gem, GripHorizontal, Image as ImageIcon, LayoutGrid, MessageCircle, SquareSplitHorizontal, Table2, type LucideIcon } from "lucide-react";
import { CARD_LABELS, type CardType, type LookbookCard } from "@/lib/lookbook/types";
import { thumbOf } from "@/lib/lookbook/media";

export const CARD_ICONS: Record<CardType, LucideIcon> = {
  hero: ImageIcon,
  gallery: LayoutGrid,
  spotlight: Gem,
  before_after: SquareSplitHorizontal,
  video: Clapperboard,
  story: AlignLeft,
  specs: Table2,
  contact: MessageCircle,
  spacer: GripHorizontal,
};

/** A card type's name where there's room for one short word: the palette's tiles, the folded rail. */
export function shortLabel(type: CardType): string {
  return type === "specs" ? "Specs" : CARD_LABELS[type].split(" / ")[0];
}

/** The order the "add a card" palette offers them in. */
export const CARD_ORDER: CardType[] = ["hero", "gallery", "spotlight", "before_after", "video", "story", "specs", "contact", "spacer"];

/** The data type a palette tile carries while being dragged into the page. */
export const CARD_DRAG_TYPE = "application/x-sparkle-lookbook-card";

/** A card's words, for its row in the list: its title, or its first line of text. */
export function cardSummary(card: LookbookCard): string {
  switch (card.type) {
    case "hero":
    case "spotlight":
    case "gallery":
    case "specs":
    case "contact":
    case "before_after":
    case "video":
      return card.title || ("eyebrow" in card ? card.eyebrow : "") || "";
    case "story":
      return card.title || card.body.split("\n")[0] || "";
    case "spacer":
      return `${card.height}px`;
    default:
      return "";
  }
}

/** A small picture for a card's row: its first photo, if it has one. */
export function cardThumb(card: LookbookCard): string | null {
  const media =
    card.type === "hero" || card.type === "spotlight" || card.type === "video"
      ? card.media
      : card.type === "gallery"
        ? card.items.find((item) => item.media)?.media ?? null
        : card.type === "before_after"
          ? card.after ?? card.before
          : null;
  if (!media) return null;
  return thumbOf(media) || null;
}
