/**
 * The jewellery vocabulary the spellchecker treats as correct, and draws its
 * domain corrections from.
 *
 * This is the layer a general English dictionary cannot provide. Hunspell knows
 * every ordinary word (and, with the British dictionary alongside it, both
 * spellings of them) — what it does not know is "milgrain", "briolette",
 * "jhumka" or "padparadscha", and it would underline all of them until the user
 * stopped trusting the underlines entirely.
 *
 * Two sources live here:
 *   1. Every option the jewellery builder can emit — mirrors the option lists in
 *      `frontend/lib/jewelryConfigurator.ts`. Keep the two in step by hand; they
 *      are in different languages and cannot import from one another.
 *   2. The curated trade vocabulary below.
 *
 * A third source, each organisation's own saved terms, is merged in at request
 * time from Mongo — see models/lexiconTerm.js.
 */

/**
 * Lookup key for a term or a typed word: lowercased with diacritics stripped, so
 * "Pavé", "pavé" and "pave" all collapse to one entry.
 */
function normalizeTerm(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .trim();
}

/** Splits a term into the individual words a spellchecker would tokenize it into. */
function termWords(term) {
  return String(term || "")
    .split(/[^\p{L}\p{M}'’-]+/u)
    .filter(Boolean);
}

/** Mirrors the builder option lists in frontend/lib/jewelryConfigurator.ts. */
const BUILDER = [
  // Jewellery types and categories
  "Ring", "Pendant", "Bangle", "Bracelet", "Cufflink", "Earring", "Necklace", "Set",
  "Engagement Ring", "Wedding Band", "Anniversary Ring", "Cocktail Ring", "Solitaire Ring",
  "Halo Ring", "Three Stone Ring", "Eternity Ring", "Statement Ring", "Signet Ring",
  "Solitaire Pendant", "Halo Pendant", "Cluster Pendant", "Locket Pendant", "Cross Pendant",
  "Initial Pendant", "Charm Pendant", "Statement Pendant", "Classic Bangle", "Cuff Bangle",
  "Hinged Bangle", "Kada", "Charm Bangle", "Studded Bangle", "Openable Bangle",
  "Tennis Bracelet", "Chain Bracelet", "Charm Bracelet", "Cuff Bracelet", "Link Bracelet",
  "Bolo Bracelet", "Beaded Bracelet", "Classic Cufflink", "Novelty Cufflink", "Monogram Cufflink",
  "Gemstone Cufflink", "Enamel Cufflink", "Stud Earring", "Hoop Earring", "Drop Earring",
  "Chandelier Earring", "Huggie Earring", "Ear Cuff", "Jhumka", "Choker Necklace",
  "Pendant Necklace", "Chain Necklace", "Collar Necklace", "Statement Necklace",
  "Layered Necklace", "Lariat Necklace", "Necklace & Earring Set", "Bridal Set",
  "Choker & Ring Set", "Full Jewelry Set",
  // Design styles
  "Classic", "Modern", "Minimalist", "Luxury", "Vintage", "Art Deco", "Royal", "Nature Inspired",
  "Floral", "Haute Joaillerie", "Romantic", "Timeless Elegance", "Bold Statement",
  // Metals
  "White Gold", "Yellow Gold", "Rose Gold", "Platinum", "Two Tone White & Yellow Gold",
  "Two Tone White & Rose Gold", "Tri Color Gold", "Oxidised Silver", "Titanium",
  // Stones, shapes, sizes
  "Diamond", "Emerald", "Ruby", "Sapphire", "Pink Sapphire", "Yellow Sapphire", "Black Diamond",
  "Tanzanite", "Morganite", "Aquamarine", "Pearl", "Round Brilliant", "Oval", "Cushion",
  "Emerald Cut", "Radiant", "Princess", "Pear", "Marquise", "Asscher", "Heart", "Trillion",
  "Carat",
  // Settings and accents
  "Prong", "Double Claw Prong", "Bezel", "Half Bezel", "Cathedral", "Tension", "Basket", "Tulip",
  "Pavé", "Channel Set", "Wire Wrapped", "Flush Set", "Halo", "Cluster", "Link Set",
  "Pave Diamonds", "Micro Pave", "Shared Prong", "Baguette Side Stones", "Three Stone Design",
  "Double Halo", "Cluster Accent", "Bail Diamonds", "Engraved Pattern", "Charm Accents",
  "Enamel Inlay", "Dangle Accents", "Station Diamonds", "Matching Accents",
  // Inspirations
  "Nature", "Flowers", "Leaves", "Royal Crown", "Architecture", "Modern Art", "Ocean Waves",
  "Butterfly", "Infinity", "Celestial", "Vintage European", "Minimal Luxury",
];

/** Construction, setting and metalwork vocabulary. */
const CRAFT = [
  "milgrain", "filigree", "openwork", "granulation", "repoussé", "chasing", "half bezel",
  "claw prong", "basket setting", "cathedral setting", "tension setting", "flush setting",
  "gypsy setting", "channel setting", "micro pavé", "shank", "split shank", "euro shank",
  "knife edge", "comfort fit", "gallery rail", "under gallery", "bail", "jump ring",
  "lobster clasp", "spring ring", "box clasp", "toggle clasp", "hinge", "post and butterfly",
  "omega back", "screw back", "french wire", "lever back", "ear wire", "guard chain",
  "safety catch", "rhodium", "rhodium plated", "black rhodium", "vermeil", "electroplated",
  "hallmark", "assay", "soldering", "lost wax casting", "hand engraved", "hand set",
  "bright cut", "bead set", "invisible set", "illusion setting", "peg head", "head and shank",
  "tapered band", "graduated band",
];

/** Gemstones beyond the builder's centre-stone list. */
const GEMSTONES = [
  "amethyst", "citrine", "garnet", "rhodolite", "peridot", "topaz", "opal", "onyx", "turquoise",
  "moonstone", "labradorite", "tourmaline", "rubellite", "indicolite", "paraiba", "spinel",
  "alexandrite", "zircon", "moissanite", "lapis lazuli", "malachite", "carnelian", "chalcedony",
  "kunzite", "tsavorite", "demantoid", "padparadscha", "chrysoprase", "iolite", "apatite",
  "sphene", "zoisite", "jadeite", "nephrite", "akoya pearl", "tahitian pearl", "south sea pearl",
  "freshwater pearl", "keshi pearl", "baroque pearl", "mabe pearl", "seed pearl", "cultured pearl",
];

/** Cuts, shapes and the anatomy of a faceted stone. */
const CUTS = [
  "briolette", "cabochon", "baguette", "tapered baguette", "rose cut", "old mine cut",
  "old european cut", "transitional cut", "step cut", "mixed cut", "kite", "shield", "hexagon",
  "half moon", "lozenge", "bullet", "calf head", "portrait cut", "checkerboard cut",
  "fantasy cut", "culet", "girdle", "pavilion", "crown facet", "table facet", "star facet",
  "bezel facet", "faceted", "melee", "calibrated", "scintillation", "dispersion", "brilliance",
  "lustre", "adularescence", "chatoyancy", "asterism", "pleochroism",
];

/** Surface treatments. */
const FINISHES = [
  "high polish", "mirror polish", "brushed finish", "satin finish", "matte finish",
  "hammered finish", "sandblasted", "florentine finish", "oxidised", "oxidized", "patina",
  "antique finish", "two tone", "tri colour", "sunburst", "engine turned", "guilloché",
  "enamel", "champlevé", "cloisonné", "plique-à-jour", "meenakari",
];

/** Grading and certification shorthand. */
const GRADING = [
  "eye clean", "colourless", "near colourless", "triple excellent", "ideal cut",
  "hearts and arrows", "fluorescence", "inclusion", "clarity enhanced", "lab grown",
  "natural origin", "conflict free", "certified", "carat weight", "total carat weight",
  "centre stone", "side stone", "accent stone",
];

/**
 * South-Asian jewellery vocabulary. None of it exists in an English Hunspell
 * dictionary, and it is already load-bearing in this product's prompts.
 */
const HERITAGE = [
  "jhumka", "jhumki", "kada", "polki", "kundan", "jadau", "navratna", "nakshi",
  "temple jewellery", "mangalsutra", "maang tikka", "matha patti", "jhoomar", "passa", "nath",
  "nathni", "chandbali", "bajuband", "vanki", "oddiyanam", "kamarbandh", "haar", "rani haar",
  "satlada", "guttapusalu", "jimikki", "lakshmi motif", "paisley motif", "mango motif", "thewa",
  "bidri", "antique gold", "payal", "anklet", "toe ring", "armlet", "choker", "sarpech", "aigrette",
];

/** Photography and staging language, since these descriptions become image prompts. */
const PHOTOGRAPHY = [
  "macro shot", "hero shot", "product studio", "seamless backdrop", "gradient backdrop",
  "black velvet", "white marble", "raw silk", "brushed stone", "acrylic pedestal", "plinth",
  "rim light", "key light", "fill light", "softbox", "bounce card", "specular highlight",
  "catchlight", "bokeh", "shallow depth of field", "focus stacking", "chiaroscuro",
  "negative space", "flat lay", "three quarter view", "top down view", "editorial campaign",
];

/** Every built-in term, as display strings. */
const LEXICON_SEED = [
  ...BUILDER, ...CRAFT, ...GEMSTONES, ...CUTS, ...FINISHES, ...GRADING, ...HERITAGE, ...PHOTOGRAPHY,
];

/**
 * Normalized → display map of every individual word in the lexicon. A word here
 * is never underlined, and is offered as a correction for near-misses.
 *
 * Words under 3 characters are dropped: they add nothing but false "corrections"
 * of ordinary short English words.
 */
function lexiconWordMap(extraTerms = []) {
  const words = new Map();
  for (const term of [...extraTerms, ...LEXICON_SEED]) {
    for (const word of termWords(term)) {
      const key = normalizeTerm(word);
      if (key.length < 3 || words.has(key)) continue;
      words.set(key, word);
    }
  }
  return words;
}

module.exports = { LEXICON_SEED, normalizeTerm, lexiconWordMap };
