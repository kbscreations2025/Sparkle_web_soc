import type { MarketingKitKind, MarketingKitSummary } from "./api";

/**
 * How a saved kit is named and where it reopens.
 *
 * Both the Marketing Kit landing page and the History page list kits, and
 * each had its own copy of these maps — which is how a fourth kind would
 * have ended up reachable from one list and not the other.
 */
const KIT_SURFACE: Record<MarketingKitKind, string> = {
  brand_story: "/marketing-kit/brand-story",
  // Retired: Affinity kits were moved to Collection Story, which holds the
  // same deck. Anything still tagged Affinity opens there too.
  affinity: "/marketing-kit/collection-story",
  campaign: "/marketing-kit/campaign",
  collection_story: "/marketing-kit/collection-story",
  festive: "/marketing-kit/festive",
};

export const KIT_LABEL: Record<MarketingKitKind, string> = {
  brand_story: "Brand Story",
  affinity: "Collection Story",
  campaign: "Campaign Kit",
  collection_story: "Collection Story",
  festive: "Poster",
};

/** The link that reopens one kit. */
export function kitHref(kit: Pick<MarketingKitSummary, "id" | "kind">) {
  return `${KIT_SURFACE[kit.kind]}?kitId=${kit.id}`;
}

/**
 * One fixed hue per kind of kit, so Brand Story, Affinity, Campaign Kit and
 * the rest read apart at a glance in the Kits grid — the same idea, and the
 * same badge shape, as the results grid's per-tool colours.
 */
const KIT_COLORS: Record<string, string> = {
  brand_story: "20 70% 58%",
  affinity: "205 65% 55%",
  collection_story: "265 50% 62%",
  campaign: "150 45% 45%",
  festive: "40 85% 50%",
};

export function kitBadgeStyle(kind: string) {
  const hsl = KIT_COLORS[kind] || "20 70% 58%";
  return { color: `hsl(${hsl})`, background: `hsl(${hsl} / 0.14)`, border: `1px solid hsl(${hsl} / 0.28)` };
}

/**
 * The line under a kit's title — what kind it is, and how much is in it.
 *
 * Brand Story deliberately carries no count: it is one narrative about one
 * piece, so "1 photo" would be noise rather than information.
 */
export function describeKit(kit: Pick<MarketingKitSummary, "kind" | "pieceCount">) {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

  if (kit.kind === "affinity" || kit.kind === "collection_story") {
    return `${KIT_LABEL[kit.kind]} · ${plural(kit.pieceCount, "piece")}`;
  }
  if (kit.kind === "campaign") return `Campaign Kit · ${plural(kit.pieceCount, "shot")}`;
  if (kit.kind === "festive") return `Poster · ${plural(kit.pieceCount, "poster")}`;
  return "Brand Story";
}
