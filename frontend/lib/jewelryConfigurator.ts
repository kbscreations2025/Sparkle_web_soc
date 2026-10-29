/**
 * The jewelry-attribute picker behind the "Jewelry Builder" panel that Text
 * to Image and Text to Sketch share.
 *
 * Most rows depend on two earlier choices: who the piece is for (Women, Men,
 * General) and the jewelry type. A men's ring has bands and signets rather
 * than halos and cocktail rings, and a ring's "Cathedral" setting means
 * nothing on a chain — so pick those first and the rows below narrow to match.
 * A few options open a follow-up row of their own: "Elongated" asks which
 * elongated cut, "Colour Diamond" which colour, "Religious" which symbol,
 * "Multi-row Band" how many rows.
 *
 * Trends run through the rows rather than beside them: each row that can
 * follow them offers "Trending" first, and flags the options in fashion this
 * month (see services/trends.js in the backend).
 */

import type { JewelryTrend, TrendCue } from "@/lib/api";

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
] as const;

export type StyleId = (typeof STYLES)[number]["id"];

/**
 * The four drawing media the sketch tools offer. Text to Sketch leads with
 * pencil; Image to Sketch orders them pencil-ink-charcoal-gouache, which is
 * the order below — a page that wants its own order sorts it.
 */
export const SKETCH_STYLES = [
  { id: "pencil", label: "Pencil" },
  { id: "ink", label: "Ink Line Art" },
  { id: "charcoal", label: "Charcoal" },
  { id: "gouache", label: "Gouache Render" },
] as const;

export type SketchStyleId = (typeof SKETCH_STYLES)[number]["id"];

/**
 * Photo-driven tools produce fewer at a time than text-driven ones — Sketch to
 * Image and Image to Sketch are following a piece that already exists, so
 * there is far less to vary than when inventing one from a description.
 */
export const PHOTO_COUNT_OPTIONS = [1, 2, 3] as const;
export const DEFAULT_PHOTO_COUNT = 1;

// ── who it's for, and what it is ────────────────────────────────────────────

const AUDIENCE_OPTIONS = ["Women", "Men", "General"];

/** What the rows fall back to whenever no jewelry type has been chosen yet. */
const DEFAULT_JEWELRY_TYPE = "Ring";

/** Every type, for when nobody has said who the piece is for. */
const ALL_TYPES = ["Ring", "Pendant", "Necklace", "Chain", "Earring", "Bangle", "Kada", "Bracelet", "Cufflink", "Set"];

const TYPES_BY_AUDIENCE: Record<string, string[]> = {
  Women: ["Ring", "Pendant", "Necklace", "Chain", "Earring", "Bangle", "Bracelet", "Set"],
  Men: ["Ring", "Chain", "Pendant", "Bracelet", "Kada", "Earring", "Cufflink", "Tie Pin", "Brooch"],
  General: ["Ring", "Pendant", "Necklace", "Chain", "Earring", "Bangle", "Kada", "Bracelet"],
};

/** Sub-types for the "Jewelry Category" row, keyed by type — every audience but Men. */
const CATEGORY_BY_TYPE: Record<string, string[]> = {
  Ring: [
    "Engagement Ring", "Wedding Band", "Anniversary Ring", "Cocktail Ring", "Solitaire Ring", "Halo Ring", "Three Stone Ring",
    "Eternity Ring", "Statement Ring", "Signet Ring", "Fashion Ring", "Multi-row Band", "Stackable Ring",
  ],
  Pendant: [
    "Solitaire Pendant", "Halo Pendant", "Cluster Pendant", "Heart Pendant", "Locket Pendant", "Cross Pendant", "Initial Pendant",
    "Coin Pendant", "Charm Pendant", "Statement Pendant", "Fashion Pendant",
  ],
  Necklace: [
    "Choker Necklace", "Pendant Necklace", "Chain Necklace", "Tennis Necklace", "Collar Necklace", "Statement Necklace",
    "Layered Necklace", "Lariat Necklace", "Fashion Necklace",
  ],
  Chain: ["Cuban Link", "Rope Chain", "Figaro Chain", "Box Chain", "Franco Chain", "Paperclip Chain", "Tennis Chain", "Fashion Chain"],
  Earring: [
    "Stud Earring", "Hoop Earring", "Drop Earring", "Chandelier Earring", "Huggie Earring", "Ear Cuff", "Ear Climber", "Jhumka",
    "Statement Earring", "Fashion Earring",
  ],
  Bangle: ["Classic Bangle", "Cuff Bangle", "Hinged Bangle", "Kada", "Charm Bangle", "Studded Bangle", "Openable Bangle", "Fashion Bangle"],
  Kada: ["Classic Kada", "Studded Kada", "Religious Kada", "Textured Kada", "Openable Kada", "Fashion Kada"],
  Bracelet: [
    "Tennis Bracelet", "Chain Bracelet", "Charm Bracelet", "Cuff Bracelet", "Link Bracelet", "Bolo Bracelet", "Beaded Bracelet",
    "Fashion Bracelet",
  ],
  Cufflink: ["Classic Cufflink", "Novelty Cufflink", "Monogram Cufflink", "Gemstone Cufflink", "Enamel Cufflink", "Fashion Cufflink"],
  Set: ["Necklace & Earring Set", "Bridal Set", "Choker & Ring Set", "Full Jewelry Set", "Fashion Set"],
  "Tie Pin": ["Classic Tie Pin", "Tie Bar", "Gemstone Tie Pin", "Fashion Tie Pin"],
  Brooch: ["Lapel Pin", "Classic Brooch", "Gemstone Brooch", "Fashion Brooch"],
};

/** Men's own sub-types, where they differ from the list above. */
const MEN_CATEGORY_BY_TYPE: Record<string, string[]> = {
  Ring: ["Band", "Signet Ring", "Multi-row Band", "Statement Ring", "Fashion Ring", "Engagement Ring", "Solitaire Ring", "Eternity Band"],
  Pendant: [
    "Religious Pendant", "Initial Pendant", "Coin Pendant", "Dog Tag", "Cross Pendant", "Bar Pendant", "Statement Pendant",
    "Fashion Pendant",
  ],
  Earring: ["Stud Earring", "Huggie Earring", "Hoop Earring", "Bar Stud", "Fashion Earring"],
  Bracelet: [
    "Cuban Link Bracelet", "Chain Bracelet", "Tennis Bracelet", "Cuff Bracelet", "ID Bracelet", "Beaded Bracelet", "Fashion Bracelet",
  ],
};

const ROW_COUNT_OPTIONS = ["2 Rows", "3 Rows", "4 Rows", "5+ Rows"];

// ── style ───────────────────────────────────────────────────────────────────

// "Trending" isn't listed here: every row that can follow the trends gets it
// as its first choice (see `TRENDING`).
const DESIGN_STYLE_OPTIONS = [
  "Classic", "Modern", "Minimalist", "Luxury", "Fashion", "Bold Gold", "Religious", "Vintage", "Art Deco", "Royal",
  "Nature Inspired", "Floral", "Haute Joaillerie", "Romantic", "Timeless Elegance", "Bold Statement",
];

const MEN_DESIGN_STYLE_OPTIONS = [
  "Modern", "Classic", "Minimalist", "Bold Gold", "Religious", "Rugged / Textured", "Fashion", "Luxury", "Vintage", "Art Deco",
];

/** How many design styles can be combined — "Trending" with "Bold Gold", say. */
const MAX_DESIGN_STYLES = 2;

const RELIGIOUS_SYMBOL_OPTIONS = [
  "Om", "Ganesha", "Trishul", "Lakshmi", "Cross", "Allah", "Ayatul Kursi", "Khanda", "Star of David", "Evil Eye", "Hamsa", "Buddha",
];

/**
 * The first choice in every row that can follow the trends: "whatever is in
 * fashion right now", decided per image from this month's trends. In Design
 * Style it means a whole current design direction per image.
 */
export const TRENDING = "Trending";

/**
 * The styles that mean "what's in fashion now". Either one sends each image
 * after a different current trend — see `wantsTrendMix`.
 */
const TREND_STYLES = [TRENDING, "Modern"];

// ── metal ───────────────────────────────────────────────────────────────────

const METAL_TYPE_OPTIONS = [
  "18K White Gold", "18K Yellow Gold", "18K Rose Gold", "22K Yellow Gold", "14K Yellow Gold", "14K White Gold", "9K Gold", "Platinum",
  "Two Tone White & Yellow Gold", "Two Tone White & Rose Gold", "Tri Color Gold", "Sterling Silver", "Oxidised Silver", "Gold Vermeil",
  "Black Rhodium Gold", "Titanium",
];

const FINISH_OPTIONS = ["Polished", "Matte", "Brushed", "Hammered", "Sandblasted", "Diamond-cut", "Textured"];

// ── stones ──────────────────────────────────────────────────────────────────

const NO_CENTER_STONE = "No Center Stone";

const CENTER_STONE_TYPE_OPTIONS = [
  NO_CENTER_STONE, "Diamond", "Lab-Grown Diamond", "Black Diamond", "Champagne Diamond", "Colour Diamond", "Emerald", "Ruby",
  "Sapphire", "Pink Sapphire", "Yellow Sapphire", "Tanzanite", "Morganite", "Aquamarine", "Pearl", "Moissanite", "Onyx",
];

const MEN_CENTER_STONE_TYPE_OPTIONS = [
  NO_CENTER_STONE, "Diamond", "Black Diamond", "Champagne Diamond", "Colour Diamond", "Onyx", "Sapphire", "Emerald", "Ruby",
  "Lab-Grown Diamond", "Moissanite",
];

const DIAMOND_COLOUR_OPTIONS = ["Pink", "Yellow (Canary)", "Blue", "Green", "Cognac", "Orange", "Purple", "Grey (Salt & Pepper)"];

const CENTER_STONE_SHAPE_OPTIONS = [
  "Round Brilliant", "Oval", "Cushion", "Emerald Cut", "Radiant", "Princess", "Pear", "Marquise", "Asscher", "Heart", "Trillion",
  "Elongated",
];

const ELONGATED_SHAPE_OPTIONS = [
  "Elongated Oval", "Elongated Cushion", "Elongated Radiant", "Elongated Emerald Cut", "Elongated Pear", "Marquise",
  "Elongated Hexagon", "Elongated Asscher", "Baguette", "Tapered Baguette", "Kite", "Shield", "Half Moon", "Trapezoid",
];

const CENTER_STONE_SIZE_OPTIONS = ["0.5 Carat", "1 Carat", "1.5 Carat", "2 Carat", "2.5 Carat", "3 Carat", "4 Carat", "5 Carat"];

/**
 * The stones around the center one — side stones, halo, pavé. Several can be
 * picked in each row: emerald and diamond side stones, pear and baguette cuts.
 */
const MAX_SIDE_STONE_PICKS = 3;

const SIDE_STONE_SHAPE_OPTIONS = [
  "Round Brilliant", "Baguette", "Tapered Baguette", "Trillion", "Pear", "Marquise", "Oval", "Princess", "Emerald Cut", "Half Moon",
  "Kite", "Heart",
];

// ── setting, accents, inspiration ───────────────────────────────────────────

/** Setting-style options, keyed by type. */
const SETTING_STYLE_BY_TYPE: Record<string, string[]> = {
  Ring: [
    "4 Prong", "6 Prong", "Double Claw Prong", "Bezel", "Half Bezel", "Cathedral", "Tension", "Basket", "Tulip", "Pavé", "Channel Set",
    "Bar Set", "Illusion Set", "Flush Set", "Invisible Set",
  ],
  Pendant: ["Bezel", "Prong", "Halo", "Cluster", "Wire Wrapped", "Flush Set", "Bar Set", "Channel Set", "Illusion Set"],
  Necklace: ["Bezel", "Prong", "Halo", "Pavé", "Cluster", "Bar Set", "Illusion Set"],
  Chain: ["Pavé", "Bezel", "Flush Set", "Channel Set"],
  Earring: ["Prong", "Bezel", "Halo", "Pavé", "Cluster", "Bar Set", "Channel Set", "Flush Set", "Illusion Set"],
  Bangle: ["Bezel", "Channel Set", "Pavé", "Flush Set", "Prong", "Bar Set", "Invisible Set"],
  Kada: ["Flush Set", "Channel Set", "Bezel", "Pavé", "Bar Set"],
  Bracelet: ["Prong", "Bezel", "Channel Set", "Pavé", "Link Set", "Bar Set", "Flush Set", "Invisible Set"],
  Cufflink: ["Bezel", "Flush Set", "Channel Set", "Prong"],
  Set: ["Prong", "Bezel", "Halo", "Pavé"],
  "Tie Pin": ["Bezel", "Flush Set", "Prong", "Channel Set"],
  Brooch: ["Prong", "Bezel", "Pavé", "Cluster"],
};

const MEN_SETTING_STYLE_BY_TYPE: Record<string, string[]> = {
  Ring: ["Flush Set", "Channel Set", "Bar Set", "Bezel", "Invisible Set", "Pavé", "4 Prong", "Tension"],
};

/** Accent/side-stone options, keyed by type. */
const ACCENT_STYLE_BY_TYPE: Record<string, string[]> = {
  Ring: [
    "None", "Pave Diamonds", "Micro Pave", "Channel Set", "Shared Prong", "Baguette Side Stones", "Three Stone Design", "Halo",
    "Double Halo", "Hidden Halo",
  ],
  Pendant: ["None", "Pave Diamonds", "Micro Pave", "Halo", "Cluster Accent", "Bail Diamonds"],
  Necklace: ["None", "Pave Diamonds", "Micro Pave", "Halo", "Cluster Accent", "Station Diamonds"],
  Chain: ["None", "Diamond-cut Links", "Pave Diamonds", "Station Diamonds"],
  Earring: ["None", "Pave Diamonds", "Micro Pave", "Halo", "Cluster Accent", "Dangle Accents"],
  Bangle: ["None", "Pave Diamonds", "Micro Pave", "Channel Set", "Engraved Pattern"],
  Kada: ["None", "Pave Diamonds", "Channel Set", "Engraved Pattern", "Black Diamond Accents"],
  Bracelet: ["None", "Pave Diamonds", "Micro Pave", "Channel Set", "Charm Accents"],
  Cufflink: ["None", "Pave Diamonds", "Enamel Inlay", "Engraved Pattern"],
  Set: ["None", "Pave Diamonds", "Micro Pave", "Halo", "Matching Accents"],
  "Tie Pin": ["None", "Pave Diamonds", "Enamel Inlay", "Engraved Pattern"],
  Brooch: ["None", "Pave Diamonds", "Micro Pave", "Enamel Inlay", "Cluster Accent"],
};

const MEN_ACCENT_STYLE_BY_TYPE: Record<string, string[]> = {
  Ring: ["None", "Channel Set", "Pave Diamonds", "Baguette Side Stones", "Black Diamond Accents", "Engraved Pattern"],
};

const DESIGN_INSPIRATION_OPTIONS = [
  "Nature", "Flowers", "Leaves", "Royal Crown", "Architecture", "Geometric", "Modern Art", "Ocean Waves", "Butterfly", "Infinity",
  "Celestial", "Vintage European", "Art Deco", "Minimal Luxury",
];

const MEN_DESIGN_INSPIRATION_OPTIONS = [
  "Geometric", "Architecture", "Monogram", "Lion", "Spiritual", "Celestial", "Modern Art", "Minimal Luxury", "Nature", "Art Deco",
];

// ── the rows ────────────────────────────────────────────────────────────────

/** A follow-up row inside a group, shown once the group has `when` picked. */
export interface SubRow {
  key: string;
  label: string;
  options: string[];
  when: string;
}

export interface ConfiguratorGroup {
  key: string;
  label: string;
  options: string[];
  /** How many may be picked together, stored joined with "|". One when omitted. */
  multi?: number;
  subRows?: SubRow[];
  /** Offers "Trending" as its first choice, and flags the options in fashion now. */
  trendable?: boolean;
}

/**
 * The rows that can follow the trends, and how each is named — in the brief
 * ("on-trend setting and metal"), on its summary chip ("Trending setting") and
 * in what each image is told ("Setting: Bezel").
 */
export const FACET_NAMES: Record<string, string> = {
  jewelryCategory: "category",
  designStyle: "design",
  metalType: "metal",
  finish: "finish",
  centerStoneType: "center stone",
  centerStoneShape: "stone shape",
  settingStyle: "setting",
  accentStyle: "accents",
  designInspiration: "motif",
};

const TREND_FACETS = Object.keys(FACET_NAMES);

function forType(map: Record<string, string[]>, type: string, menMap?: Record<string, string[]>, men = false): string[] {
  return (men && menMap?.[type]) || map[type] || map[DEFAULT_JEWELRY_TYPE];
}

/** A multi-pick value ("Trending|Bold Gold") as its parts. */
export function splitMulti(value: string | undefined): string[] {
  return value ? value.split("|").filter(Boolean) : [];
}

export function joinMulti(values: string[]): string {
  return values.join("|");
}

/** Builds the row list for the current selections — who it's for, the type and the stone shape the rest. */
export function buildJewelryConfigurator(sel: Record<string, string>): ConfiguratorGroup[] {
  const men = sel.audience === "Men";
  const types = TYPES_BY_AUDIENCE[sel.audience] ?? ALL_TYPES;
  const type = types.includes(sel.jewelryType) ? sel.jewelryType : DEFAULT_JEWELRY_TYPE;
  const noStone = sel.centerStoneType === NO_CENTER_STONE;

  const groups: ConfiguratorGroup[] = [
    { key: "audience", label: "For", options: AUDIENCE_OPTIONS },
    { key: "jewelryType", label: "Jewelry Type", options: types },
    {
      key: "jewelryCategory",
      label: "Jewelry Category",
      options: forType(CATEGORY_BY_TYPE, type, MEN_CATEGORY_BY_TYPE, men),
      subRows: [{ key: "rows", label: "Rows", options: ROW_COUNT_OPTIONS, when: "Multi-row Band" }],
    },
    {
      key: "designStyle",
      label: "Design Style",
      options: men ? MEN_DESIGN_STYLE_OPTIONS : DESIGN_STYLE_OPTIONS,
      multi: MAX_DESIGN_STYLES,
      subRows: [{ key: "religiousSymbol", label: "Symbol", options: RELIGIOUS_SYMBOL_OPTIONS, when: "Religious" }],
    },
    { key: "metalType", label: "Metal Type", options: METAL_TYPE_OPTIONS },
    { key: "finish", label: "Finish", options: FINISH_OPTIONS },
    {
      key: "centerStoneType",
      label: "Center Stone Type",
      options: men ? MEN_CENTER_STONE_TYPE_OPTIONS : CENTER_STONE_TYPE_OPTIONS,
      subRows: [{ key: "diamondColour", label: "Diamond colour", options: DIAMOND_COLOUR_OPTIONS, when: "Colour Diamond" }],
    },
    {
      key: "centerStoneShape",
      label: "Center Stone Shape",
      options: CENTER_STONE_SHAPE_OPTIONS,
      subRows: [{ key: "elongatedShape", label: "Elongated cut", options: ELONGATED_SHAPE_OPTIONS, when: "Elongated" }],
    },
    { key: "centerStoneSize", label: "Center Stone Size", options: CENTER_STONE_SIZE_OPTIONS },
    {
      key: "sideStoneType",
      label: "Side Stone Type",
      options: (men ? MEN_CENTER_STONE_TYPE_OPTIONS : CENTER_STONE_TYPE_OPTIONS).filter((option) => option !== NO_CENTER_STONE),
      multi: MAX_SIDE_STONE_PICKS,
    },
    { key: "sideStoneShape", label: "Side Stone Shape", options: SIDE_STONE_SHAPE_OPTIONS, multi: MAX_SIDE_STONE_PICKS },
    { key: "settingStyle", label: "Setting Style", options: forType(SETTING_STYLE_BY_TYPE, type, MEN_SETTING_STYLE_BY_TYPE, men) },
    { key: "accentStyle", label: "Accent / Side Stones", options: forType(ACCENT_STYLE_BY_TYPE, type, MEN_ACCENT_STYLE_BY_TYPE, men) },
    { key: "designInspiration", label: "Design Inspiration", options: men ? MEN_DESIGN_INSPIRATION_OPTIONS : DESIGN_INSPIRATION_OPTIONS },
  ].map((group) => (TREND_FACETS.includes(group.key) ? { ...group, options: [TRENDING, ...group.options], trendable: true } : group));

  // No centre stone, nothing to shape or size.
  return noStone ? groups.filter((group) => group.key !== "centerStoneShape" && group.key !== "centerStoneSize") : groups;
}

/** Every selection key, parents before the follow-up rows that hang off them. */
export const SELECTION_KEYS = buildJewelryConfigurator({}).flatMap((group) => [group.key, ...(group.subRows ?? []).map((row) => row.key)]);

/**
 * Drops whatever the rows no longer offer — after "For" or the type changes,
 * a ring's "Cathedral" setting can't stay active on a chain, and a follow-up
 * row's pick goes with its parent. Repeated because one change can lead to
 * another: switching to Men drops "Necklace", which changes every type row.
 */
export function pruneJewelrySelections(sel: Record<string, string>): Record<string, string> {
  let current = sel;
  for (let pass = 0; pass < 3; pass++) {
    const next: Record<string, string> = {};
    for (const group of buildJewelryConfigurator(current)) {
      const kept = splitMulti(current[group.key]).filter((value) => group.options.includes(value));
      if (!kept.length) continue;
      next[group.key] = joinMulti(kept.slice(-(group.multi ?? 1)));
      for (const row of group.subRows ?? []) {
        if (kept.includes(row.when) && row.options.includes(current[row.key])) next[row.key] = current[row.key];
      }
    }
    const settled = Object.keys(next).length === Object.keys(current).length && Object.entries(next).every(([key, value]) => current[key] === value);
    current = next;
    if (settled) break;
  }
  return current;
}

/** Whether each image should follow a whole current design direction — "Trending" or "Modern" as the design style. */
function wantsTrendMix(sel: Record<string, string>): boolean {
  return splitMulti(sel.designStyle).some((style) => TREND_STYLES.includes(style));
}

const AUDIENCE_KEYS: Record<string, string> = { Women: "women", Men: "men", General: "general" };

/**
 * What to ask the trends endpoint for: who it's for, the type, and the
 * builder's own lists, so what comes back flagged is something the builder
 * offers. With nobody chosen, a cufflink or tie pin is read as men's, a kada
 * as unisex and anything else as women's — most of the market.
 */
export function trendQueryFor(sel: Record<string, string>) {
  const base = { audience: sel.audience, jewelryType: sel.jewelryType };
  const groups = buildJewelryConfigurator(base);
  const type = groups.find((group) => group.key === "jewelryType")!.options.includes(sel.jewelryType) ? sel.jewelryType : DEFAULT_JEWELRY_TYPE;
  const audience = AUDIENCE_KEYS[sel.audience] ?? (["Cufflink", "Tie Pin", "Brooch"].includes(type) ? "men" : type === "Kada" ? "general" : "women");

  const options: Record<string, string[]> = {};
  for (const group of groups) {
    if (group.key === "audience" || group.key === "jewelryType") continue;
    options[group.key] = group.options.filter((option) => option !== TRENDING);
    for (const row of group.subRows ?? []) options[row.key] = row.options;
  }
  return { audience, type, options };
}

/** A setting reads better as "bar-set stones" than "Bar Set setting". */
function settingPhrase(setting: string): string {
  return /\sset$/i.test(setting) ? `${setting.replace(/\sset$/i, "").toLowerCase()}-set stones` : `${setting.toLowerCase()} setting`;
}

/** "setting", "setting and metal", "setting, metal and finish". */
function joinWithAnd(items: string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Builds the description the selections spell out, ready to join with the free text. */
export function buildJewelryPrompt(sel: Record<string, string>): string {
  const s = (key: string) => sel[key]?.trim() || "";
  // A row left on "Trending" is decided per image (see `buildTrendCues`) —
  // the brief only says which rows those are.
  const trending = (key: string) => s(key) === TRENDING;
  const onTrend: string[] = [];
  const parts: string[] = [];

  const audience = s("audience");
  const prefix = audience === "Women" ? "women's " : audience === "Men" ? "men's " : audience === "General" ? "unisex " : "";
  // With no type chosen the rows offer ring categories, so it is a ring style.
  if (trending("jewelryCategory")) onTrend.push(`${(s("jewelryType") || DEFAULT_JEWELRY_TYPE).toLowerCase()} style`);
  const subject = (trending("jewelryCategory") ? "" : s("jewelryCategory")) || s("jewelryType");
  if (subject) parts.push(`${prefix}${subject.toLowerCase()}${s("rows") ? ` (${s("rows").toLowerCase()})` : ""}`);
  else if (prefix) parts.push(`${prefix}jewelry`);

  const stoneType = s("centerStoneType");
  if (stoneType === NO_CENTER_STONE) {
    parts.push("no center stone");
  } else {
    if (trending("centerStoneType")) onTrend.push(FACET_NAMES.centerStoneType);
    if (trending("centerStoneShape")) onTrend.push(FACET_NAMES.centerStoneShape);
    const stone = trending("centerStoneType")
      ? ""
      : stoneType === "Colour Diamond" && s("diamondColour")
        ? `${s("diamondColour")} Diamond`
        : stoneType;
    const shape = trending("centerStoneShape") ? "" : s("centerStoneShape") === "Elongated" ? s("elongatedShape") || "Elongated" : s("centerStoneShape");
    const words = [s("centerStoneSize"), shape, stone || (shape || s("centerStoneSize") ? "center stone" : "")].filter(Boolean);
    if (words.length) parts.push(words.join(" "));
  }

  // "pear and baguette emerald and diamond side stones"
  const side = ["sideStoneShape", "sideStoneType"].map((key) => joinWithAnd(splitMulti(sel[key]))).filter(Boolean);
  if (side.length) parts.push(`${side.join(" ")} side stones`);

  const simple: [string, (value: string) => string][] = [
    ["settingStyle", settingPhrase],
    ["accentStyle", (value) => (value === "None" ? "" : value.toLowerCase())],
    ["metalType", (value) => `crafted in ${value}`],
    ["finish", (value) => `${value.toLowerCase()} finish`],
    ["designInspiration", (value) => `${value.toLowerCase()} inspired`],
  ];
  for (const [key, phrase] of simple) {
    if (trending(key)) onTrend.push(FACET_NAMES[key]);
    else if (s(key) && phrase(s(key))) parts.push(phrase(s(key)));
  }
  if (onTrend.length) parts.push(`on-trend ${joinWithAnd(onTrend)}`);

  const styles = splitMulti(sel.designStyle);
  if (styles.length) parts.push(`${joinWithAnd(styles).toLowerCase()} style`);
  if (s("religiousSymbol")) parts.push(`${s("religiousSymbol")} motif`);
  if (audience === "Men") parts.push("masculine proportions");

  return parts.join(", ");
}

/**
 * The options flagged as in fashion in one row: those the trends name for it,
 * plus a parent whose follow-up row has some — "Elongated" is flagged when an
 * elongated cut is trending, so the flame leads to the cut.
 */
export function trendingOptionsFor(group: ConfiguratorGroup, trending: Record<string, string[]>): Set<string> {
  const flagged = new Set(trending[group.key] ?? []);
  for (const row of group.subRows ?? []) if (trending[row.key]?.length) flagged.add(row.when);
  return flagged;
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** "Elongated" names the cut, "Colour Diamond" the colour — from the trend leading the image, or the row's trending ones. */
function describeChoice(key: string, value: string, lead: JewelryTrend | null, trending: Record<string, string[]>, index: number): string {
  const nth = (list: string[] | undefined) => (list?.length ? list[index % list.length] : "");
  if (key === "centerStoneShape" && value === "Elongated") return lead?.picks.elongatedShape || nth(trending.elongatedShape) || "an elongated cut";
  if (key === "centerStoneType" && value === "Colour Diamond") {
    const colour = lead?.picks.diamondColour || nth(trending.diamondColour);
    return colour ? `${colour} diamond` : "a colour diamond";
  }
  return value;
}

/**
 * What each image of a run is told about the trends, one entry per image:
 *  - a "Trending" or "Modern" design style sends each image after a different
 *    whole design direction;
 *  - each row left on "Trending" gets one of its in-fashion options per image,
 *    rotating — so a run of four shows four takes, not one repeated. Where an
 *    image follows a whole direction, that direction's own choice wins.
 * Empty when the brief asks for neither.
 */
export function buildTrendCues({
  sel,
  trends,
  trending,
  count,
  random = Math.random,
}: {
  sel: Record<string, string>;
  trends: JewelryTrend[];
  trending: Record<string, string[]>;
  count: number;
  random?: () => number;
}): TrendCue[] {
  const facets = TREND_FACETS.filter((key) => key !== "designStyle" && sel[key] === TRENDING);
  const leads = wantsTrendMix(sel) ? shuffle(trends, random) : [];
  if (facets.length === 0 && leads.length === 0) return [];

  // Each row starts its rotation somewhere new, so two runs don't come out alike.
  const start = Object.fromEntries(facets.map((key) => [key, Math.floor(random() * 100)]));

  return Array.from({ length: Math.max(1, count) }, (_, index) => {
    const lead = leads.length ? leads[index % leads.length] : null;
    const choices = facets.map((key) => {
      const values = trending[key] ?? [];
      const value = lead?.picks[key] || (values.length ? values[(start[key] + index) % values.length] : "");
      const name = FACET_NAMES[key][0].toUpperCase() + FACET_NAMES[key].slice(1);
      return `${name}: ${value ? describeChoice(key, value, lead, trending, start[key] + index) : "whichever is most in fashion right now"}`;
    });
    const rows = choices.length ? `In-fashion choices for this image — ${choices.join("; ")}.` : "";
    return lead ? { label: lead.label, cue: [lead.cue, rows].filter(Boolean).join(" ") } : { label: "Trending now", cue: rows };
  });
}

/** Text-driven tools — Text to Image and Text to Sketch — offer a run of 1 to 4. */
export const TEXT_COUNT_OPTIONS = [1, 2, 3, 4] as const;
export const DEFAULT_IMAGE_COUNT = 2;
