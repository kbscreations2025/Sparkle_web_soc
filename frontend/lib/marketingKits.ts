import type { MarketingKitKind, MarketingKitSummary } from "./api";

/**
 * How a saved kit is named and where it reopens.
 *
 * Both the Marketing Kit landing page and the History page list kits, and
 * each had its own copy of these maps — which is how a fourth kind would
 * have ended up reachable from one list and not the other.
 */
export const KIT_SURFACE: Record<MarketingKitKind, string> = {
  brand_story: "/marketing-kit/brand-story",
  affinity: "/marketing-kit/affinity",
  campaign: "/marketing-kit/campaign",
};

export const KIT_LABEL: Record<MarketingKitKind, string> = {
  brand_story: "Brand Story",
  affinity: "Affinity",
  campaign: "Campaign Kit",
};

/** The link that reopens one kit. */
export function kitHref(kit: Pick<MarketingKitSummary, "id" | "kind">) {
  return `${KIT_SURFACE[kit.kind]}?kitId=${kit.id}`;
}

/**
 * The line under a kit's title — what kind it is, and how much is in it.
 *
 * Brand Story deliberately carries no count: it is one narrative about one
 * piece, so "1 photo" would be noise rather than information.
 */
export function describeKit(kit: Pick<MarketingKitSummary, "kind" | "pieceCount">) {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

  if (kit.kind === "affinity") return `Affinity · ${plural(kit.pieceCount, "piece")}`;
  if (kit.kind === "campaign") return `Campaign Kit · ${plural(kit.pieceCount, "shot")}`;
  return "Brand Story";
}
