/**
 * The jewelry-attribute picker behind Text to Image's "Jewelry Builder" panel.
 * The "Jewelry Category", "Setting Style" and "Accent / Side Stones" rows are
 * ring-specific concepts (prongs, halos, engagement/wedding sub-types…) that
 * don't make sense for a bangle or a cufflink, so their option lists depend
 * on the selected "Jewelry Type" — pick a type first and those three rows
 * narrow down to match it.
 */

export const ASPECTS = [
  { id: "square", label: "1:1", w: 14, h: 14 },
  { id: "portrait", label: "4:5", w: 12, h: 15 },
  { id: "landscape", label: "16:9", w: 18, h: 10 },
  { id: "story", label: "9:16", w: 9, h: 16 },
] as const;

export type AspectId = (typeof ASPECTS)[number]["id"];

export const STYLES = [
  { id: "product-studio", label: "Product Studio" },
  { id: "photorealistic", label: "Photorealistic" },
  { id: "luxury-campaign", label: "Luxury Campaign" },
  { id: "dark-velvet", label: "Dark Velvet" },
  { id: "warm-gold", label: "Warm Gold" },
  { id: "ice-editorial", label: "Ice Editorial" },
] as const;

export type StyleId = (typeof STYLES)[number]["id"];

export const JEWELRY_TYPE_OPTIONS = ["Ring", "Pendant", "Bangle", "Bracelet", "Cufflink", "Earring", "Necklace", "Set"];

/** Selected by default whenever no jewelry type has been chosen yet. */
export const DEFAULT_JEWELRY_TYPE = "Ring";

export const DESIGN_STYLE_OPTIONS = [
  "Classic", "Modern", "Minimalist", "Luxury", "Vintage", "Art Deco", "Royal", "Nature Inspired",
  "Floral", "Haute Joaillerie", "Romantic", "Timeless Elegance", "Bold Statement",
];

export const METAL_TYPE_OPTIONS = [
  "18K White Gold", "18K Yellow Gold", "18K Rose Gold", "Platinum", "Two Tone White & Yellow Gold",
  "Two Tone White & Rose Gold", "Tri Color Gold", "Oxidised Silver", "Titanium",
];

export const CENTER_STONE_TYPE_OPTIONS = [
  "Diamond", "Emerald", "Ruby", "Sapphire", "Pink Sapphire", "Yellow Sapphire",
  "Black Diamond", "Tanzanite", "Morganite", "Aquamarine", "Pearl",
];

export const CENTER_STONE_SHAPE_OPTIONS = [
  "Round Brilliant", "Oval", "Cushion", "Emerald Cut", "Radiant", "Princess",
  "Pear", "Marquise", "Asscher", "Heart", "Trillion",
];

export const CENTER_STONE_SIZE_OPTIONS = [
  "0.5 Carat", "1 Carat", "1.5 Carat", "2 Carat", "2.5 Carat", "3 Carat", "4 Carat", "5 Carat",
];

export const DESIGN_INSPIRATION_OPTIONS = [
  "Nature", "Flowers", "Leaves", "Royal Crown", "Architecture", "Modern Art", "Ocean Waves",
  "Butterfly", "Infinity", "Celestial", "Vintage European", "Art Deco", "Minimal Luxury",
];

/** Sub-type options for the "Jewelry Category" row, keyed by "Jewelry Type". */
const JEWELRY_CATEGORY_BY_TYPE: Record<string, string[]> = {
  Ring: ["Engagement Ring", "Wedding Band", "Anniversary Ring", "Cocktail Ring", "Solitaire Ring", "Halo Ring", "Three Stone Ring", "Eternity Ring", "Statement Ring", "Signet Ring"],
  Pendant: ["Solitaire Pendant", "Halo Pendant", "Cluster Pendant", "Locket Pendant", "Cross Pendant", "Initial Pendant", "Charm Pendant", "Statement Pendant"],
  Bangle: ["Classic Bangle", "Cuff Bangle", "Hinged Bangle", "Kada", "Charm Bangle", "Studded Bangle", "Openable Bangle"],
  Bracelet: ["Tennis Bracelet", "Chain Bracelet", "Charm Bracelet", "Cuff Bracelet", "Link Bracelet", "Bolo Bracelet", "Beaded Bracelet"],
  Cufflink: ["Classic Cufflink", "Novelty Cufflink", "Monogram Cufflink", "Gemstone Cufflink", "Enamel Cufflink"],
  Earring: ["Stud Earring", "Hoop Earring", "Drop Earring", "Chandelier Earring", "Huggie Earring", "Ear Cuff", "Jhumka"],
  Necklace: ["Choker Necklace", "Pendant Necklace", "Chain Necklace", "Collar Necklace", "Statement Necklace", "Layered Necklace", "Lariat Necklace"],
  Set: ["Necklace & Earring Set", "Bridal Set", "Choker & Ring Set", "Full Jewelry Set"],
};

/** Setting-style options for that row, keyed by "Jewelry Type". */
const SETTING_STYLE_BY_TYPE: Record<string, string[]> = {
  Ring: ["4 Prong", "6 Prong", "Double Claw Prong", "Bezel", "Half Bezel", "Cathedral", "Tension", "Basket", "Tulip", "Pavé", "Channel Set"],
  Pendant: ["Bezel", "Prong", "Halo", "Cluster", "Wire Wrapped", "Flush Set"],
  Bangle: ["Bezel", "Channel Set", "Pavé", "Flush Set", "Prong"],
  Bracelet: ["Prong", "Bezel", "Channel Set", "Pavé", "Link Set"],
  Cufflink: ["Bezel", "Flush Set", "Channel Set", "Prong"],
  Earring: ["Prong", "Bezel", "Halo", "Pavé", "Cluster"],
  Necklace: ["Bezel", "Prong", "Halo", "Pavé", "Cluster"],
  Set: ["Prong", "Bezel", "Halo", "Pavé"],
};

/** Accent/side-stone options for that row, keyed by "Jewelry Type". */
const ACCENT_STYLE_BY_TYPE: Record<string, string[]> = {
  Ring: ["None", "Pave Diamonds", "Micro Pave", "Channel Set", "Shared Prong", "Baguette Side Stones", "Three Stone Design", "Halo", "Double Halo"],
  Pendant: ["None", "Pave Diamonds", "Micro Pave", "Halo", "Cluster Accent", "Bail Diamonds"],
  Bangle: ["None", "Pave Diamonds", "Micro Pave", "Channel Set", "Engraved Pattern"],
  Bracelet: ["None", "Pave Diamonds", "Micro Pave", "Channel Set", "Charm Accents"],
  Cufflink: ["None", "Pave Diamonds", "Enamel Inlay", "Engraved Pattern"],
  Earring: ["None", "Pave Diamonds", "Micro Pave", "Halo", "Cluster Accent", "Dangle Accents"],
  Necklace: ["None", "Pave Diamonds", "Micro Pave", "Halo", "Cluster Accent", "Station Diamonds"],
  Set: ["None", "Pave Diamonds", "Micro Pave", "Halo", "Matching Accents"],
};

function optionsFor(map: Record<string, string[]>, jewelryType: string): string[] {
  return map[jewelryType] ?? map[DEFAULT_JEWELRY_TYPE];
}

export interface ConfiguratorGroup {
  key: string;
  label: string;
  options: string[];
}

/** Builds the full configurator row list for the given "Jewelry Type" selection. */
export function buildJewelryConfigurator(jewelryType: string): ConfiguratorGroup[] {
  const type = jewelryType || DEFAULT_JEWELRY_TYPE;
  return [
    { key: "jewelryType", label: "Jewelry Type", options: JEWELRY_TYPE_OPTIONS },
    { key: "jewelryCategory", label: "Jewelry Category", options: optionsFor(JEWELRY_CATEGORY_BY_TYPE, type) },
    { key: "designStyle", label: "Design Style", options: DESIGN_STYLE_OPTIONS },
    { key: "metalType", label: "Metal Type", options: METAL_TYPE_OPTIONS },
    { key: "centerStoneType", label: "Center Stone Type", options: CENTER_STONE_TYPE_OPTIONS },
    { key: "centerStoneShape", label: "Center Stone Shape", options: CENTER_STONE_SHAPE_OPTIONS },
    { key: "centerStoneSize", label: "Center Stone Size", options: CENTER_STONE_SIZE_OPTIONS },
    { key: "settingStyle", label: "Setting Style", options: optionsFor(SETTING_STYLE_BY_TYPE, type) },
    { key: "accentStyle", label: "Accent / Side Stones", options: optionsFor(ACCENT_STYLE_BY_TYPE, type) },
    { key: "designInspiration", label: "Design Inspiration", options: DESIGN_INSPIRATION_OPTIONS },
  ];
}

/** Builds the free-text description from the builder selections. */
export function buildJewelryPrompt(sel: Record<string, string>): string {
  const s = (k: string) => sel[k] || "";
  const parts: string[] = [];
  if (s("jewelryCategory")) parts.push(s("jewelryCategory").toLowerCase());
  if (s("centerStoneSize") && s("centerStoneShape") && s("centerStoneType"))
    parts.push(`${s("centerStoneSize")} ${s("centerStoneShape")} ${s("centerStoneType")}`);
  else if (s("centerStoneShape") && s("centerStoneType")) parts.push(`${s("centerStoneShape")} ${s("centerStoneType")}`);
  else if (s("centerStoneType")) parts.push(s("centerStoneType"));
  if (s("jewelryType")) parts.push(s("jewelryType").toLowerCase());
  if (s("settingStyle") && s("settingStyle") !== "None") parts.push(`${s("settingStyle")} setting`);
  if (s("accentStyle") && s("accentStyle") !== "None") parts.push(s("accentStyle").toLowerCase());
  if (s("metalType")) parts.push(`set in ${s("metalType")}`);
  if (s("designInspiration")) parts.push(`${s("designInspiration").toLowerCase()} inspired`);
  if (s("designStyle")) parts.push(`${s("designStyle").toLowerCase()} style`);
  return parts.join(", ");
}

/**
 * Selections that no longer apply after the jewelry type changes (e.g. the
 * ring's "Cathedral" setting doesn't exist for a bangle) — clears
 * jewelryCategory, settingStyle and accentStyle so a stale, now-invisible
 * option can't stay "active".
 */
export function clearJewelryTypeDependentSelections(sel: Record<string, string>): Record<string, string> {
  const next = { ...sel };
  for (const key of ["jewelryCategory", "settingStyle", "accentStyle"]) delete next[key];
  return next;
}

export const TEXT_COUNT_OPTIONS = [2, 4, 6, 8] as const;
export const DEFAULT_IMAGE_COUNT = 4;
