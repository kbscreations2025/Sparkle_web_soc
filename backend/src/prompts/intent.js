/**
 * What a follow-up message is actually asking for.
 *
 * Every tool's follow-up box used to wrap the user's words in the same "edit
 * this image, only apply the requested change, keep everything else" prompt.
 * That is right for "make the band thinner" and wrong for most of what people
 * really type next:
 *
 *   · "show me more designs"  → keep-everything turned this into colour swaps
 *   · "make it a pendant"     → the model kept the ring, because it was told to
 *   · "in rose gold"          → worked, but also nudged stones and lighting
 *
 * So the message is read first. `detectIntent` is a fast keyword pass that
 * covers the common phrasings; `resolveIntent` adds a small model call for a
 * message the keywords can't place. The result then shapes the prompt
 * (`applyIntentToPrompt`), how many images a follow-up makes
 * (`refineCountFor`) and the short label the chat shows (`describeIntent`).
 *
 * Detection happens once, in the route, before the run is priced — "more
 * designs" makes several images and has to be held for as several.
 */

// ── Vocabulary ──────────────────────────────────────────────────────────────

/**
 * Jewellery types, longest phrases first so "nose ring" never reads as "ring".
 * Common misspellings are included on purpose — "earing", "pendent" and
 * "braclet" are typed far more often than a spell-checker would suggest.
 */
const TYPES = [
  ["nose_pin", ["nose pins?", "nose rings?", "nosepins?", "nath"]],
  ["maang_tikka", ["maang tikkas?", "mang tikkas?", "tikkas?"]],
  ["bracelet", ["tennis bracelets?", "bracelets?", "braclets?", "bracelates?"]],
  ["ring", ["cocktail rings?", "engagement rings?", "rings?", "bands?", "solitaires?"]],
  ["earrings", ["earrings?", "earings?", "ear[- ]rings?", "studs?", "hoops?", "drops?", "danglers?", "jhumkas?", "jhumkis?", "ear cuffs?"]],
  ["pendant", ["pendants?", "pendents?", "lockets?"]],
  ["necklace", ["necklaces?", "neckless", "necklesses", "chokers?", "mangalsutras?", "haars?"]],
  ["bangle", ["bangles?", "bangels?", "kadas?", "kadaa", "cuffs?"]],
  ["brooch", ["brooch(?:es)?"]],
  ["anklet", ["anklets?", "payals?"]],
  ["cufflinks", ["cuff ?links?"]],
];

const TYPE_ALTERNATION = TYPES.flatMap(([, words]) => words).join("|");

/** What makes each type that type — applied when a design is carried over to it. */
const TYPE_TRAITS = {
  ring: "a finger ring — the design becomes the head/top of the ring, on a complete circular shank of realistic finger size with natural shoulders, shown in a classic three-quarter product view",
  pendant: "a pendant — the design becomes the pendant body with a proper, proportionate bail at the top, hanging from a fine matching chain, centred and front-facing",
  necklace: "a necklace — the motif arranged along a complete, symmetrical necklace (repeated links or a central focal piece with graduated elements), with a clasp, laid out front-facing",
  earrings: "a matching PAIR of earrings — two mirror-image earrings at true earring scale, each with a proper post and back, hook or lever-back, shown side by side",
  bracelet: "a bracelet — the motif linked into a complete, flexible bracelet at wrist scale, with a clasp",
  bangle: "a bangle (kada) — a rigid closed circle, or open cuff, at wrist scale, with the motif on the front, shown in three-quarter view",
  brooch: "a brooch — the design as a flat-backed piece with a pin fitting, shown front-facing",
  nose_pin: "a nose pin — a single tiny piece at true nose-pin scale on a short post",
  maang_tikka: "a maang tikka — the design as a pendant-like ornament hanging from a fine chain with a hook at the top for the hair parting",
  anklet: "an anklet — a fine chain at ankle scale with the motif repeated along it or as a charm, with a clasp",
  cufflinks: "a matching PAIR of cufflinks with toggle backs, shown side by side",
};

const TYPE_NAMES = {
  ring: "ring",
  pendant: "pendant",
  necklace: "necklace",
  earrings: "earrings",
  bracelet: "bracelet",
  bangle: "bangle",
  brooch: "brooch",
  nose_pin: "nose pin",
  maang_tikka: "maang tikka",
  anklet: "anklet",
  cufflinks: "cufflinks",
};

/** Ordered: the specific golds before plain "gold", which every one of them contains. */
const METALS = [
  ["rose_gold", /\b(?:rose|pink|red)[\s-]?gold\b/],
  ["white_gold", /\bwhite[\s-]?gold\b/],
  ["yellow_gold", /\byellow[\s-]?gold\b/],
  ["platinum", /\bplatinum\b/],
  ["silver", /\b(?:silver|sterling|925|chandi|chaandi)\b/],
  ["black_rhodium", /\b(?:black[\s-]?rhodium|gunmetal|oxidi[sz]ed|black[\s-]?metal)\b/],
  ["yellow_gold", /\b(?:gold|golden|sona|sone)\b/],
];

const METAL_LOOKS = {
  yellow_gold: "rich, warm, natural 18K yellow gold",
  rose_gold: "soft, warm, natural rose gold (pink gold) — not copper, not orange",
  white_gold: "bright, cool, mirror-polished white gold — never dull or flat grey",
  platinum: "bright, cool, mirror-polished platinum",
  silver: "bright polished sterling silver",
  black_rhodium: "dark black-rhodium / gunmetal plated metal",
};

const METAL_NAMES = {
  yellow_gold: "yellow gold",
  rose_gold: "rose gold",
  white_gold: "white gold",
  platinum: "platinum",
  silver: "silver",
  black_rhodium: "black rhodium",
};

const GEM_RE =
  /\b(?:(?:pink|blue|yellow|white|green|padparadscha)\s+sapphires?|sapphires?|rub(?:y|ies)|emeralds?(?!\s*cut)|diamonds?|tanzanites?|amethysts?|topaz(?:es)?|morganites?|aquamarines?|moissanites?|cubic zirconias?|cz|pearls?|polki|kundan|garnets?|opals?|onyx|citrines?|peridots?|tourmalines?|spinels?|lab[\s-]?grown(?:\s+diamonds?)?|(?:red|pink|blue|green|yellow|purple|black|white|coloured|colored)\s+(?:stones?|gems?|gemstones?))\b/;

const CUT_RE =
  /\b(?:round(?:\s+brilliant)?|oval|pear|marquise|princess|cushion|emerald\s+cut|radiant|asscher|heart(?:[\s-]shaped)?|baguette|trillion|old\s+mine|rose\s+cut)\b/;

const CHANGE_VERB_RE = /\b(?:change|changed|replace|swap|switch|convert|instead|turn|use|make|try|go with|with|in|to|into)\b/;

const FINISH_RE =
  /\b(?:matte|matt|brushed|satin|hammered|high[\s-]?polish(?:ed)?|mirror[\s-]?polish(?:ed)?|polished|textured|sandblasted|engrav\w*|milgrain|enamel(?:led)?|meenakari|filigree|diamond[\s-]?cut finish)\b/;

const VIEW_RE =
  /\b(?:(?:side|top|front|back|rear|profile|bird'?s[\s-]?eye|underside|gallery)\s+view|45\s*(?:°|deg(?:ree)?s?)|three[\s-]quarters?|3\/4\s*view|close[\s-]?up|zoom(?:ed)?\s+in|(?:different|another|other)\s+angles?|from\s+(?:the\s+)?(?:side|top|back|above|below)|rotate)\b/;

const BACKGROUND_RE =
  /\b(?:background|backdrop|bg|velvet|jewel(?:le)?ry\s+box|display\s+stand|props?|shadows?|reflections?|lighting|exposure|brighter|darker)\b/;

const EXPLORE_RES = [
  /\b(?:more|few|some|other|another|different|new|alternate|alternative|similar|extra|additional|fresh)\s+(?:[\w-]+\s+)?(?:options?|designs?|variations?|variants?|versions?|ideas?|concepts?|styles?|looks?|choices?|takes?)\b/,
  /\b(?:variations?|variants?|alternatives?)\b/,
  /\bshow\s+(?:me\s+)?(?:some\s+)?more\b/,
  /\b(?:inspired\s+by|based\s+on|similar\s+to|in\s+the\s+style\s+of)\s+(?:this|it|these|that)\b/,
  /\bexplore\b/,
  /\baur\s+(?:designs?|options?)\b/,
];

/** What a type word must be followed by to be the *target* of a change, not just mentioned. */
const TYPE_END = String.raw`(?=\s*(?:$|[.,!?;)]|\s(?:for|from|with|in|of|version|instead|too|also|and|using|that|which|please|now|set)\b))`;

const TYPE_CHANGE_RES = [
  new RegExp(
    String.raw`\b(?:change|convert|turn|transform|switch|redesign|remake|recreate|adapt|translate)\b(?:\s+[\w'-]+){0,4}?\s+(?:in)?to\s+(?:an?\s+|the\s+|matching\s+|a\s+matching\s+|pair\s+of\s+|a\s+pair\s+of\s+)?(${TYPE_ALTERNATION})\b`
  ),
  new RegExp(
    String.raw`\b(?:make|create|design|do|show|give|render|draw)\b(?:\s+(?:it|this|that|me|us|one|the\s+design|the\s+piece|this\s+design))?\s+(?:as\s+|into\s+)?(?:an?|matching|a\s+matching|a\s+pair\s+of|pair\s+of)\s+(${TYPE_ALTERNATION})${TYPE_END}`
  ),
  new RegExp(String.raw`\bas\s+(?:an?\s+|matching\s+|a\s+pair\s+of\s+)?(${TYPE_ALTERNATION})${TYPE_END}`),
  new RegExp(String.raw`\b(?:look|looks|looking)\s+like\s+(?:an?\s+|a\s+pair\s+of\s+)?(${TYPE_ALTERNATION})${TYPE_END}`),
  new RegExp(String.raw`\b(?:matching|same\s+design\s+(?:as|in|for)\s+(?:an?\s+)?|this\s+design\s+(?:as|in|for)\s+(?:an?\s+)?)(${TYPE_ALTERNATION})\b`),
  new RegExp(String.raw`\b(${TYPE_ALTERNATION})\s+(?:version|instead)\b`),
];

/** Negations that protect an attribute rather than change it: "keep the gold", "don't change the metal". */
const KEEP_METAL_RE =
  /\b(?:keep|same|retain|don'?t\s+change|do\s+not\s+change|without\s+changing|leave)\b[^.,;!?]*\b(?:metal|gold|silver|platinum|colou?r|tone)\b/;

// ── Detection ───────────────────────────────────────────────────────────────

function normalise(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function typeFromWord(word) {
  const w = word.toLowerCase().replace(/\s+/g, " ");
  for (const [canonical, words] of TYPES) {
    if (words.some((pattern) => new RegExp(`^(?:${pattern})$`).test(w))) return canonical;
  }
  return null;
}

function emptyIntent() {
  return { kinds: [], metals: [], gem: null, cut: null, carat: null, targetType: null, source: "keywords" };
}

/**
 * Keyword pass. Synchronous and free, so it runs on every follow-up.
 *
 * `kinds` can hold several at once — "make it a pendant in rose gold" is both
 * a type change and a metal change, and both have to reach the prompt.
 * An empty `kinds` means "a plain edit", which is what the tools did before.
 */
function detectIntent(text) {
  const intent = emptyIntent();
  const t = normalise(text);
  if (!t) return intent;

  // A colour that belongs to the background is not a metal: "gold background",
  // "background in pink". Removed before the metal pass, still seen by the
  // background pass.
  const withoutBackgroundColours = t
    .replace(/\b(?:[\w-]+\s+){0,2}(?:background|backdrop|bg)\b/g, " ")
    .replace(/\b(?:background|backdrop|bg)\s+(?:in|to|of|as|colou?r)?\s*(?:[\w-]+\s*){0,2}/g, " ");

  // ── more designs
  if (EXPLORE_RES.some((re) => re.test(t))) {
    intent.kinds.push("explore");
    // "make 4 more designs" — the number they asked for, capped per tool later.
    const asked = t.match(/\b([2-6]|two|three|four|five|six)\s+(?:more\s+|new\s+|different\s+|other\s+)?(?:[\w-]+\s+)?(?:options?|designs?|variations?|variants?|versions?|ideas?|concepts?)\b/);
    if (asked) {
      const words = { two: 2, three: 3, four: 4, five: 5, six: 6 };
      intent.exploreCount = words[asked[1]] ?? Number(asked[1]);
    }
  }

  // ── type change
  for (const re of TYPE_CHANGE_RES) {
    const match = t.match(re);
    if (match) {
      intent.targetType = typeFromWord(match[1]);
      if (intent.targetType) break;
    }
  }
  // A bare type on its own — "pendant", "now earrings" — is a request for that type.
  if (!intent.targetType && t.split(" ").length <= 3) {
    const bare = t.replace(/\b(?:now|please|pls|a|an|the|as|in|to)\b/g, " ").trim();
    const asType = bare && typeFromWord(bare);
    if (asType) intent.targetType = asType;
  }
  if (intent.targetType) intent.kinds.push("type_change");

  // ── metal colour
  if (!KEEP_METAL_RE.test(t)) {
    const metals = [];
    let rest = withoutBackgroundColours;
    for (const [metal, re] of METALS) {
      if (re.test(rest)) {
        metals.push(metal);
        // So "rose gold" isn't also counted as plain "gold".
        rest = rest.replace(new RegExp(re.source, "g"), " ");
      }
    }
    const twoTone = /\b(?:two|2|tri|three|3)[\s-]?(?:tone|toned|colou?r(?:ed)?)\b|\bmixed[\s-]?metals?\b/.test(t);

    // "white and yellow gold" names two golds with one "gold": the bare colours count too.
    if (twoTone || /\b(?:white|yellow|rose|pink)\s+(?:and|&|\+|with)\s+(?:white|yellow|rose|pink)\s+gold\b/.test(rest + " " + withoutBackgroundColours)) {
      if (/\bwhite\b/.test(withoutBackgroundColours)) metals.push("white_gold");
      if (/\byellow\b/.test(withoutBackgroundColours)) metals.push("yellow_gold");
      if (/\b(?:rose|pink)\b/.test(withoutBackgroundColours)) metals.push("rose_gold");
    }

    // A bare colour is a metal when it is said of the metal — "metal colour to
    // rose pink", even with stones named elsewhere in the same message — or
    // when the message is about colour and names no stone at all ("in pink"
    // next to "sapphire" is the stone). "medal"/"mettle" are how "metal" is
    // often typed.
    if (metals.length === 0) {
      const saidOfMetal = withoutBackgroundColours.match(
        /\b(?:metal|medal|mettle|metals|band|shank|gold)\b(?:\s+[\w-]+){0,3}?\s+(?:to|in|into|as|=|->)?\s*(rose|pink|yellow|white)\b/
      );
      const colourOnly = /\b(?:metal|medal|mettle|colou?r|tone|plating|plated|finish)\b/.test(t) && !GEM_RE.test(t);
      const colour = saidOfMetal?.[1] ?? (colourOnly ? withoutBackgroundColours.match(/\b(rose|pink|yellow|white)\b/)?.[1] : null);
      if (colour === "rose" || colour === "pink") metals.push("rose_gold");
      else if (colour === "yellow") metals.push("yellow_gold");
      else if (colour === "white") metals.push("white_gold");
    }

    if (metals.length || twoTone) {
      intent.metals = [...new Set(metals)];
      intent.twoTone = twoTone || intent.metals.length > 1;
      intent.kinds.push("metal");
    }
  }

  // ── stones: a gem/cut/carat plus a sign of change. "add more diamonds" stays a plain edit.
  // The stone wanted is the one after "with/to/into/for" — "replace the
  // diamonds with rubies" wants rubies — or else the last one named.
  const gemAfterVerb = t.match(new RegExp(String.raw`\b(?:with|to|into|for|use|using)\s+(?:an?\s+|the\s+|some\s+)?(${GEM_RE.source.slice(2, -2)})\b`));
  const allGems = t.match(new RegExp(GEM_RE.source, "g"));
  const gem = gemAfterVerb?.[1] ?? allGems?.[allGems.length - 1] ?? null;
  const cut = /\b(?:cut|shape|shaped|stone|stones|diamond|cent(?:er|re))\b/.test(t) ? t.match(CUT_RE)?.[0] ?? null : null;
  const carat = t.match(/\b\d+(?:\.\d+)?\s*(?:ct|cts|carat|carats)\b/)?.[0] ?? null;
  const isAdding = /\b(?:add|adding|more)\b/.test(t) && !/\b(?:replace|instead|change|swap|switch)\b/.test(t);
  // A named cut is a request on its own ("emerald cut centre stone"); a gem needs a verb.
  if (((gem || carat) && CHANGE_VERB_RE.test(t) && !isAdding) || (cut && !isAdding)) {
    intent.gem = gem;
    intent.cut = cut;
    intent.carat = carat;
    intent.kinds.push("stone");
  }

  if (FINISH_RE.test(t)) intent.kinds.push("finish");
  if (VIEW_RE.test(t)) intent.kinds.push("view");
  if (BACKGROUND_RE.test(t)) intent.kinds.push("background");

  return intent;
}

// ── Model fallback ──────────────────────────────────────────────────────────

const CLASSIFIER_MODEL = "gemini-2.5-flash";

/**
 * Gemini's own schema dialect (upper-case type names, as `Type.OBJECT` etc.
 * from @google/genai produce). OpenRouter's `generateText` converts it to
 * standard JSON Schema when it is the one answering.
 */
const CLASSIFIER_SCHEMA = {
  type: "OBJECT",
  properties: {
    explore: { type: "BOOLEAN", description: "user wants several NEW, different designs inspired by the current one" },
    targetType: {
      type: "STRING",
      enum: ["none", ...Object.keys(TYPE_TRAITS)],
      description: "jewellery type the user wants the design converted into, or none",
    },
    metal: {
      type: "STRING",
      enum: ["none", ...Object.keys(METAL_LOOKS), "two_tone"],
      description: "metal the user wants the piece changed to, or none",
    },
    stone: { type: "STRING", description: "the stone/gem or cut the user wants instead, or empty" },
    finish: { type: "BOOLEAN" },
    view: { type: "BOOLEAN", description: "user wants a different camera angle of the same piece" },
    background: { type: "BOOLEAN", description: "user wants the background, lighting or presentation changed" },
  },
  required: ["explore", "targetType", "metal", "stone", "finish", "view", "background"],
};

const CLASSIFIER_PROMPT = `You classify one follow-up message a user typed under a generated jewellery image. Decide what they are asking for.

- explore: true only if they want several NEW, DIFFERENT designs (more options, alternatives, ideas). Not "more diamonds", not "more shine".
- targetType: the jewellery type they want the design turned into (ring, pendant, earrings...), else "none". Mentioning a type while editing it ("make the ring band thinner") is "none".
- metal: the metal they want it changed to, else "none". A colour for the background is not a metal. A coloured stone is not a metal.
- stone: the gem or cut they want instead, else "".
- finish / view / background: true if they ask to change the surface finish / camera angle / background, lighting or presentation.

Messages may be in English, Hindi or Hinglish. Message:
`;

/**
 * Keyword pass, then — only when it found nothing to go on — one quick,
 * cheap model call. Most follow-ups ("add a halo", "thinner band") are plain
 * edits and stay plain; the model is there for the phrasings no list covers
 * ("try this as something for the ears"). Any failure means "plain edit".
 */
async function resolveIntent(text, { tenant } = {}) {
  const keyword = detectIntent(text);
  const words = normalise(text).split(" ").filter(Boolean).length;
  if (keyword.kinds.length > 0 || !tenant || words < 3) return keyword;

  try {
    // Required lazily: this module is also loaded by prompt builders that
    // must not pull the provider stack in with them.
    const { routeTextCall } = require("../aiRouting");
    const { output } = await routeTextCall({
      tenant,
      modelId: CLASSIFIER_MODEL,
      prompt: CLASSIFIER_PROMPT + JSON.stringify(String(text)),
      responseSchema: CLASSIFIER_SCHEMA,
      temperature: 0,
      thinkingBudget: 0,
      maxOutputTokens: 300,
    });
    if (output.blocked || !output.text) return keyword;

    const answer = JSON.parse(output.text);
    const intent = emptyIntent();
    intent.source = "model";
    if (answer.explore) intent.kinds.push("explore");
    if (answer.targetType && answer.targetType !== "none" && TYPE_TRAITS[answer.targetType]) {
      intent.targetType = answer.targetType;
      intent.kinds.push("type_change");
    }
    if (answer.metal && answer.metal !== "none") {
      intent.metals = answer.metal === "two_tone" ? [] : [answer.metal];
      intent.twoTone = answer.metal === "two_tone";
      intent.kinds.push("metal");
    }
    if (answer.stone?.trim()) {
      intent.gem = answer.stone.trim().slice(0, 60);
      intent.kinds.push("stone");
    }
    if (answer.finish) intent.kinds.push("finish");
    if (answer.view) intent.kinds.push("view");
    if (answer.background) intent.kinds.push("background");
    return intent;
  } catch (err) {
    console.warn("[intent] classifier failed — treating as a plain edit:", err.message);
    return keyword;
  }
}

// ── Per-tool behaviour ──────────────────────────────────────────────────────

/**
 * `designTool`: the piece on screen is a design, so new designs and type
 * changes make sense. In Cleaning, Lifestyle and Campaign Kit it is the
 * customer's real product — redesigning it would be wrong, so there "more
 * options" means more takes on the shot and a type change is ignored.
 *
 * `medium`: what a result must remain — a hand-drawn sketch must not turn
 * into a photograph because someone asked for rose gold.
 *
 * `maxExplore`: how many images "more options" makes. 1 where the tool's
 * result handling only shows one image per run.
 */
const TOOL_PROFILES = {
  text_to_image: { designTool: true, medium: "photo", maxExplore: 3 },
  sketch_to_image: { designTool: true, medium: "photo", maxExplore: 3 },
  chat_to_edit: { designTool: true, medium: "photo", maxExplore: 3 },
  text_to_sketch: { designTool: true, medium: "sketch", maxExplore: 3 },
  image_to_sketch: { designTool: true, medium: "sketch", maxExplore: 3 },
  cleaning: { designTool: false, medium: "photo", maxExplore: 1 },
  life_style: { designTool: false, medium: "scene", maxExplore: 3 },
  marketing_kit: { designTool: false, medium: "scene", maxExplore: 1 },
};

const DEFAULT_PROFILE = { designTool: true, medium: "photo", maxExplore: 1 };

function profileFor(tool) {
  return TOOL_PROFILES[tool] ?? DEFAULT_PROFILE;
}

/** Drops what a tool doesn't support, so the rest of the system never sees it. */
function intentForTool(intent, tool) {
  if (!intent) return emptyIntent();
  const { designTool } = profileFor(tool);
  if (designTool) return intent;
  return { ...intent, kinds: intent.kinds.filter((kind) => kind !== "type_change"), targetType: null };
}

/** Upper bound for a number the user names ("6 more designs"): each image is charged. */
const MAX_ASKED_EXPLORE = 4;

/**
 * How many images a follow-up makes: one for an edit; for "more options" the
 * number asked for (up to 4), else the tool's default — never more than one
 * where the tool can only show one.
 */
function refineCountFor(intent, tool) {
  if (!intent?.kinds.includes("explore")) return 1;
  const { maxExplore } = profileFor(tool);
  if (maxExplore <= 1) return 1;
  if (intent.exploreCount) return Math.max(1, Math.min(MAX_ASKED_EXPLORE, intent.exploreCount));
  return maxExplore;
}

// ── Prompt shaping ──────────────────────────────────────────────────────────

function mediumKeep(medium) {
  if (medium === "sketch") {
    return "The result must stay a HAND-DRAWN DESIGN SKETCH in exactly the same drawing medium, paper, linework and shading style as the first image — never a photograph or a 3D render.";
  }
  if (medium === "scene") {
    return "Keep the same photographic scene, model, styling, lighting and composition as the first image.";
  }
  return "Keep the same photorealistic product-photography presentation as the first image: same background, studio lighting and composition, the piece centred and fully in frame.";
}

function metalDescription(intent) {
  const looks = intent.metals.map((metal) => METAL_LOOKS[metal]).filter(Boolean);
  if (intent.twoTone) {
    const names = intent.metals.map((metal) => METAL_NAMES[metal]);
    const pair = names.length >= 2 ? names.join(" and ") : names.length === 1 ? `${names[0]} combined with a contrasting metal` : "white and yellow gold";
    return `two-tone ${pair}, with clean, sharp boundaries between the metals placed where they suit the design`;
  }
  return looks[0] ?? "the requested metal";
}

function stoneDescription(intent) {
  return [intent.carat, intent.cut, intent.gem].filter(Boolean).join(" ") || "the requested stone";
}

/** Direction per variation, so three "more options" don't come back as near-copies. */
const EXPLORE_DIRECTIONS = [
  "Explore a different central motif and overall silhouette.",
  "Explore a different stone arrangement and setting style.",
  "Explore different metalwork — the frame, gallery, shank or links, and the use of negative space.",
  "Explore a bolder, more statement interpretation.",
  "Explore a lighter, more delicate interpretation.",
];

/** The same, for a real product: only the shot varies, never the piece. */
const SHOT_DIRECTIONS = [
  "Vary the camera angle.",
  "Vary the pose and framing.",
  "Vary the styling and mood of the scene.",
  "Vary the crop — a closer, more detailed view.",
];

/**
 * Focused blocks for the attribute-level changes, appended to a tool's own
 * edit prompt.
 *
 * Each block says what it changes and what must stay — but "what must stay"
 * leaves out anything another block in the same request is changing.
 * "Rose gold metal and emerald stones" is two changes; a stone block saying
 * "do NOT change the metal" would contradict the metal block beside it.
 */
function attributeBlocks(intent, { medium }) {
  const blocks = [];
  const kinds = new Set(intent.kinds);

  /** The attributes from `candidates` that no block in this request changes. */
  const keep = (candidates) => {
    const changing = {
      metal: kinds.has("metal") || kinds.has("finish"),
      "metal colour": kinds.has("metal"),
      stones: kinds.has("stone"),
      "stone colours": kinds.has("stone"),
      background: kinds.has("background"),
      lighting: kinds.has("background"),
      composition: kinds.has("view"),
      "viewing angle": kinds.has("view"),
      presentation: kinds.has("background") || kinds.has("view"),
    };
    return candidates.filter((name) => !changing[name]).join(", ") || "rest of the piece";
  };

  if (kinds.has("metal")) {
    blocks.push(
      `METAL CHANGE: change the metal of the piece to ${metalDescription(intent)}. Recolour ALL metal parts${intent.twoTone ? " as described" : ""}. ` +
        (medium === "sketch"
          ? "Show the metal colour within the sketch's own medium (a colour wash or tinted rendering where the medium allows), keeping it a sketch. "
          : "It must look like real polished precious metal with natural reflections. ") +
        `Do NOT change the ${keep(["design", "shape", "stones", "stone colours", "setting", "proportions", "background", "lighting", "composition"])}.`
    );
  }
  if (kinds.has("stone")) {
    blocks.push(
      `STONE CHANGE: change to ${stoneDescription(intent)} ONLY the stones the request refers to. If it points at particular stones — circled or marked on the image, or named ("the centre stone", "the side stones") — change those and leave every other stone exactly as it is; change all the stones only when the request clearly means all of them. Keep the number of stones, their positions, sizes and settings exactly as they are unless the request says otherwise. ` +
        `Do NOT change the ${keep(["design", "metal", "presentation"])}.`
    );
  }
  if (kinds.has("finish")) {
    blocks.push(
      `FINISH CHANGE: change the surface finish/texture of the metal as requested. Keep the ${keep(["design", "shape", "stones", "metal colour"])} exactly the same.`
    );
  }
  if (kinds.has("view")) {
    blocks.push(
      `VIEW CHANGE: show the SAME piece from the requested camera angle — the ${keep(["design", "metal", "stones"])} and proportions unchanged. This overrides any earlier instruction to keep the original viewing angle.`
    );
  }
  if (kinds.has("background")) {
    blocks.push(
      `BACKGROUND / PRESENTATION CHANGE: change the background, lighting or presentation as requested. This overrides any earlier instruction to keep the background. The jewellery's ${keep(["design", "metal", "stones"])} must stay exactly the same.`
    );
  }
  if (blocks.length > 1) {
    blocks.push("This request asks for ALL of the changes above together — apply every one of them in the same image.");
  }
  return blocks;
}

/**
 * The follow-up prompt, shaped by what was asked.
 *
 * · "more designs" on a design tool and "make it a pendant" REPLACE the tool's
 *   edit prompt: that prompt's whole point is "keep the design", which is the
 *   one thing these requests don't want.
 * · Everything else keeps the tool's own prompt and adds focused instructions
 *   — what to change, and what that kind of change must leave alone.
 * · A plain edit returns `basePrompt` untouched: nothing changes for it.
 */
function applyIntentToPrompt({ basePrompt, instruction, intent, tool, referenceNote = "", variationIndex = 0, variationTotal = 1 }) {
  const { designTool, medium } = profileFor(tool);
  const scoped = intentForTool(intent, tool);
  const kinds = new Set(scoped.kinds);
  if (kinds.size === 0) return basePrompt;

  const request = String(instruction || "").trim();
  const blocks = attributeBlocks(scoped, { medium });
  const directions = designTool ? EXPLORE_DIRECTIONS : SHOT_DIRECTIONS;
  const variationNote =
    variationTotal > 1
      ? ` This is option ${variationIndex + 1} of ${variationTotal}; it must be clearly different from the other options. ${directions[variationIndex % directions.length]}`
      : "";

  if (designTool && kinds.has("type_change")) {
    const type = scoped.targetType;
    return [
      `REDESIGN AS A ${TYPE_NAMES[type].toUpperCase()}: turn the jewellery in the first image into ${TYPE_TRAITS[type]}.`,
      "Carry the design language over faithfully so it reads as the matching piece from the same collection: the same motif and shapes, the same stone types, cuts and colours, the same setting style, metal colour and finish. Adapt the proportions and construction to what this type of jewellery needs — do not just paste the old piece onto a new fitting.",
      `The user asked: "${request}".`,
      ...blocks,
      kinds.has("explore") ? "Give a distinct take on this conversion." + variationNote : "",
      mediumKeep(medium),
      referenceNote,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  if (designTool && kinds.has("explore")) {
    return [
      "NEW DESIGN OPTION: use the jewellery in the first image as design INSPIRATION and create a NEW design — not a copy, and not the same piece in another colour.",
      "Keep: the same type of jewellery, the same overall style family and mood, and the same metal colour and stone types unless the user asked otherwise.",
      "Change: the actual design — the motif, the silhouette, the stone layout and the metalwork — so it is a genuinely different piece a customer would see as another option from the same collection.",
      "A result that differs only in colour, lighting or angle is a FAILURE.",
      `The user asked: "${request}".` + variationNote,
      ...blocks,
      mediumKeep(medium),
      referenceNote,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  // Product tools: "more options" means more takes on the same shot.
  if (kinds.has("explore")) {
    blocks.push(
      "ANOTHER TAKE: produce an alternative version of this shot — vary the angle, pose, framing or styling — while the jewellery itself stays exactly the same real product: identical design, metal and stones." +
        variationNote
    );
  }

  return [basePrompt, ...blocks, "Where these instructions and the ones above conflict, follow these."].join("\n\n");
}

/** The few words the chat shows under a result, e.g. "Metal → rose gold". Null for a plain edit. */
function describeIntent(intent, tool, count = 1) {
  const scoped = intentForTool(intent, tool);
  const kinds = new Set(scoped.kinds);
  if (kinds.size === 0) return null;
  const { designTool } = profileFor(tool);

  const parts = [];
  if (kinds.has("type_change")) parts.push(`Converted to ${TYPE_NAMES[scoped.targetType]}`);
  if (kinds.has("explore")) {
    const noun = designTool ? "design option" : "variation";
    parts.push(`${count} new ${noun}${count === 1 ? "" : "s"}`);
  }
  if (kinds.has("metal")) {
    const name = scoped.twoTone
      ? `two-tone${scoped.metals.length ? ` ${scoped.metals.map((m) => METAL_NAMES[m]).join(" & ")}` : ""}`
      : METAL_NAMES[scoped.metals[0]] ?? "new metal";
    parts.push(`Metal → ${name}`);
  }
  if (kinds.has("stone")) parts.push(`Stones → ${stoneDescription(scoped)}`);
  if (kinds.has("finish")) parts.push("Finish changed");
  if (kinds.has("view")) parts.push("New angle");
  if (kinds.has("background")) parts.push("Background / lighting");
  return parts.join(" · ");
}

module.exports = {
  detectIntent,
  resolveIntent,
  intentForTool,
  refineCountFor,
  applyIntentToPrompt,
  describeIntent,
  TOOL_PROFILES,
};
