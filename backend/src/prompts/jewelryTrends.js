/**
 * Jewellery design trends, for the Jewelry Builder's "Trending" choices and
 * the flames on its options, and for the trend each generated image is asked
 * to follow.
 *
 * Two sources, the second preferred:
 *  - this curated list — always there, the fallback whenever a live refresh
 *    hasn't happened or can't (no web-capable key, a failed call);
 *  - a monthly refresh from the live web (services/trends.js asks a model
 *    with web search what is trending *now*, and keeps the answer for the
 *    month).
 *
 * Each trend is:
 *  - `label`  its name ("Toi et Moi")
 *  - `hint`   a few words on it ("Two stones, side by side")
 *  - `cue`    what the design looks like, concretely enough to draw — this is
 *             what reaches the image model
 *  - `picks`  the builder selections that define it — the options flagged as
 *             trending in each row. Values must be the builder's own option
 *             labels (frontend lib/jewelryConfigurator.ts); one that isn't
 *             is dropped.
 *
 * Keyed by audience, then jewellery type. A type missing for an audience falls
 * back to the same type under "women", then to rings.
 */

const t = (label, hint, cue, picks = {}) => ({ label, hint, cue, picks });

const CURATED = {
  women: {
    Ring: [
      t("Toi et Moi", "Two stones, side by side", "a toi-et-moi ring: two different centre stones — for example a pear and an oval — set side by side on an open bypass shank", { jewelryCategory: "Statement Ring", centerStoneShape: "Pear" }),
      t("East-West Solitaire", "Stone set sideways", "an elongated centre stone set horizontally (east-west) across the finger in a slim bezel or four-prong setting on a fine band", { jewelryCategory: "Solitaire Ring", centerStoneShape: "Elongated", elongatedShape: "Elongated Oval" }),
      t("Bezel Solitaire", "Sleek wrapped stone", "a sleek modern solitaire with the stone fully wrapped in a smooth gold bezel on a slightly chunky, rounded band", { jewelryCategory: "Solitaire Ring", settingStyle: "Bezel" }),
      t("Hidden Halo", "Sparkle under the stone", "a solitaire with a hidden halo — a ring of tiny pavé diamonds tucked beneath the centre stone, visible only from the side — on a pavé band", { jewelryCategory: "Solitaire Ring", accentStyle: "Micro Pave" }),
      t("Chunky Dome", "Bold sculpted gold", "a bold, high-polish gold dome ring with a sculptural rounded profile, plain or with a few stones set flush into the dome", { jewelryCategory: "Statement Ring", designStyle: "Bold Gold", settingStyle: "Flush Set" }),
      t("Stacking Bands", "Mixed slim bands", "a stack of slim bands worn together — one pavé, one plain polished, one with tiny bezel-set stones — mixing textures and widths", { jewelryCategory: "Stackable Ring" }),
      t("Colour Diamonds", "Pink & champagne sparkle", "soft pink or champagne coloured diamonds paired with white diamonds for a warm, modern sparkle", { centerStoneType: "Colour Diamond", diamondColour: "Pink" }),
      t("Molten Gold", "Fluid, organic shape", "an organic, molten-looking gold band with fluid, slightly irregular curves, as if hand-formed, with a single stone nestled into it", { designStyle: "Bold Gold", designInspiration: "Nature" }),
    ],
    Pendant: [
      t("Modern Heart", "Puffed or open heart", "a modern heart pendant — a puffed or open-outline gold heart, sometimes with a single heart-cut stone or a pavé edge", { jewelryCategory: "Heart Pendant" }),
      t("Personalised Initial", "Script or block letter", "a personalised initial pendant in fine gold script or a bold block letter, edged in tiny pavé diamonds", { jewelryCategory: "Initial Pendant" }),
      t("Floating Diamond", "Barely-there solitaire", "a single diamond that seems to float on a fine chain, held in a minimal bezel with an invisible bail", { jewelryCategory: "Solitaire Pendant", settingStyle: "Bezel" }),
      t("Charm Stack", "Mixed charms on one chain", "a cluster of mixed charms — a tiny heart, a star, a coin and a gemstone drop — gathered on one chain, playful and personal", { jewelryCategory: "Charm Pendant" }),
      t("Bow & Ribbon", "Soft bow motif", "a delicate bow or ribbon-shaped pendant in polished gold with pavé-set edges", { jewelryCategory: "Fashion Pendant" }),
      t("Elongated Drop", "Long pear or marquise", "an elongated pear or marquise drop pendant in a sleek bezel on a fine chain", { centerStoneShape: "Elongated", elongatedShape: "Elongated Pear" }),
      t("Coin Medallion", "Antique-style coin", "an antique-inspired gold coin medallion with engraved detail, hung on a substantial chain", { designStyle: "Vintage" }),
    ],
    Necklace: [
      t("Tennis Necklace", "Continuous line of stones", "a tennis necklace — one continuous line of matched stones in four-prong or bezel settings, sometimes in graduated colour", { jewelryCategory: "Tennis Necklace" }),
      t("Paperclip Chain", "Elongated open links", "a paperclip chain of elongated open gold links, worn alone or layered with a pendant", { jewelryCategory: "Chain Necklace" }),
      t("Layered Pearls", "Pearls with gold", "pearl strands layered with fine gold chains, mixing classic pearls with modern gold", { centerStoneType: "Pearl", jewelryCategory: "Layered Necklace" }),
      t("Bold Gold Collar", "Sculpted statement collar", "a sculpted, high-polish gold collar necklace with a bold, graphic silhouette", { jewelryCategory: "Collar Necklace", designStyle: "Bold Gold" }),
      t("Diamonds by the Yard", "Spaced bezel stations", "a fine chain with small bezel-set diamonds spaced along it at even stations", { jewelryCategory: "Chain Necklace", accentStyle: "Station Diamonds" }),
      t("Lariat", "Y-shaped drop", "a lariat or Y-necklace with a slim vertical drop ending in a pear-shaped stone", { jewelryCategory: "Lariat Necklace" }),
    ],
    Chain: [
      t("Paperclip Chain", "Elongated open links", "a paperclip chain of elongated open gold links", { jewelryCategory: "Paperclip Chain" }),
      t("Rope Chain", "Twisted, light-catching", "a classic twisted rope chain with a high-polish, light-catching finish", { jewelryCategory: "Rope Chain" }),
      t("Tennis Chain", "Line of diamonds", "a slim tennis chain with a continuous line of small diamonds", { jewelryCategory: "Tennis Chain" }),
      t("Chunky Link", "Bold gold links", "a chunky gold link chain with bold, rounded links", { jewelryCategory: "Fashion Chain", designStyle: "Bold Gold" }),
    ],
    Earring: [
      t("Ear Climbers", "Up the ear", "ear climbers — a curved line of graduated stones that climbs up the edge of the ear", { jewelryCategory: "Ear Climber" }),
      t("Charm Huggies", "Huggies with tiny drops", "small gold huggie hoops with tiny detachable charm or gemstone drops", { jewelryCategory: "Huggie Earring" }),
      t("Chunky Hoops", "Bold sculpted hoops", "chunky, sculpted gold hoops — thick, rounded and high-polish", { jewelryCategory: "Hoop Earring", designStyle: "Bold Gold" }),
      t("Statement Drops", "Long dramatic drops", "long statement drop earrings with an elongated stone at the base", { jewelryCategory: "Statement Earring" }),
      t("Mismatched Pair", "Two different earrings", "a deliberately mismatched pair — a stud on one ear and a small drop on the other, linked by the same stones", { jewelryCategory: "Fashion Earring" }),
      t("Modern Jhumka", "Lightweight jhumka", "a lightweight, modern jhumka with a clean gold bell and a fringe of tiny stones or pearls", { jewelryCategory: "Jhumka" }),
    ],
    Bangle: [
      t("Stacking Bangles", "Slim bangles together", "a stack of slim bangles mixing plain polished gold, a pavé line and a textured band", { jewelryCategory: "Classic Bangle" }),
      t("Bold Cuff", "Sculpted open cuff", "a wide sculpted gold cuff with a smooth, high-polish open form", { jewelryCategory: "Cuff Bangle", designStyle: "Bold Gold" }),
      t("Hinged Pavé", "Diamond line bangle", "a slim hinged bangle with a line of pavé diamonds across the top", { jewelryCategory: "Hinged Bangle", accentStyle: "Pave Diamonds" }),
      t("Fusion Kada", "Kada, modern lines", "a modern kada with clean architectural lines and a single row of flush-set stones", { jewelryCategory: "Kada", settingStyle: "Flush Set" }),
    ],
    Bracelet: [
      t("Colour Tennis", "Tennis line in colour", "a tennis bracelet in gradient coloured stones — sapphire, ruby and emerald tones", { jewelryCategory: "Tennis Bracelet" }),
      t("Paperclip Bracelet", "Elongated open links", "a paperclip-link bracelet in polished gold", { jewelryCategory: "Chain Bracelet" }),
      t("Charm Bracelet", "Personal charms", "a fine bracelet hung with a few personal charms — initials, hearts and birthstones", { jewelryCategory: "Charm Bracelet" }),
      t("Bezel Stations", "Diamonds by the yard", "a delicate chain bracelet with small bezel-set diamonds spaced along it", { jewelryCategory: "Chain Bracelet", settingStyle: "Bezel" }),
    ],
    Set: [
      t("Lightweight Bridal", "Fine, wearable bridal", "a lightweight bridal set — necklace and earrings with fine pavé and delicate drops, wearable beyond the wedding day", { jewelryCategory: "Bridal Set" }),
      t("Uncut Polki", "Modern polki", "a modern polki set with uncut diamonds in clean gold frames", { jewelryCategory: "Necklace & Earring Set", designStyle: "Royal" }),
      t("Heart Set", "Matching hearts", "a matching heart pendant and heart stud earrings in polished gold", { jewelryCategory: "Fashion Set" }),
    ],
  },
  men: {
    Ring: [
      t("Black Diamond Band", "Channel-set black diamonds", "a wide men's band in black rhodium or yellow gold with a single row of channel-set black diamonds", { jewelryCategory: "Band", centerStoneType: "Black Diamond", settingStyle: "Channel Set" }),
      t("Modern Signet", "Chunky flat-faced signet", "a chunky signet ring with a flat oval or cushion face, an engraved monogram or one flush-set stone, polished sides", { jewelryCategory: "Signet Ring", settingStyle: "Flush Set" }),
      t("Hammered Gold", "Hand-hammered texture", "a heavy band with a hand-hammered, faceted texture in yellow gold, contrasting matte and polish", { jewelryCategory: "Band", finish: "Hammered", designStyle: "Bold Gold" }),
      t("Two-Tone Band", "White and yellow gold", "a two-tone band combining white and yellow gold with a crisp groove line and a brushed finish", { metalType: "Two Tone White & Yellow Gold", finish: "Brushed" }),
      t("Hexagon Stone", "Geometric flush-set stone", "a men's ring with a geometric hexagon-cut stone flush-set into a broad, angular band", { centerStoneShape: "Elongated", elongatedShape: "Elongated Hexagon", settingStyle: "Flush Set" }),
      t("Pinky Signet", "Slim pinky ring", "a slim, refined pinky signet with a small onyx or diamond inset", { jewelryCategory: "Signet Ring", centerStoneType: "Onyx" }),
    ],
    Chain: [
      t("Cuban Link", "Heavy curb links", "a heavy Cuban link chain with tight, flat-polished interlocking links", { jewelryCategory: "Cuban Link", designStyle: "Bold Gold" }),
      t("Rope Chain", "Twisted gold rope", "a thick twisted rope chain in yellow gold", { jewelryCategory: "Rope Chain" }),
      t("Franco Chain", "Sleek V-links", "a sleek franco chain with dense V-shaped links", { jewelryCategory: "Franco Chain" }),
      t("Men's Tennis Chain", "Line of diamonds", "a men's tennis chain with a continuous line of diamonds in four-prong settings", { jewelryCategory: "Tennis Chain" }),
    ],
    Pendant: [
      t("Modern Religious", "Clean-lined symbol", "a modern religious pendant — a clean-lined symbol in polished gold, optionally with a black diamond accent", { jewelryCategory: "Religious Pendant", designStyle: "Religious" }),
      t("Dog Tag", "Engraved tag", "a polished gold dog-tag pendant with a fine engraved monogram", { jewelryCategory: "Dog Tag" }),
      t("Coin Pendant", "Antique-style coin", "an antique-style gold coin pendant on a substantial chain", { jewelryCategory: "Coin Pendant" }),
      t("Black Diamond Bar", "Vertical bar", "a vertical bar pendant set with a line of black diamonds", { jewelryCategory: "Bar Pendant", centerStoneType: "Black Diamond" }),
    ],
    Bracelet: [
      t("Cuban Link Bracelet", "Heavy curb links", "a heavy Cuban link bracelet in polished gold", { jewelryCategory: "Cuban Link Bracelet" }),
      t("Men's Tennis", "Line of diamonds", "a men's tennis bracelet with larger diamonds in sturdy four-prong settings", { jewelryCategory: "Tennis Bracelet" }),
      t("Minimal Cuff", "Brushed gold cuff", "a minimal open cuff in brushed gold with a single flush-set diamond", { jewelryCategory: "Cuff Bracelet", finish: "Brushed" }),
      t("Beads & Gold", "Stone beads with gold", "a beaded bracelet of onyx or tiger-eye beads with gold spacer beads", { jewelryCategory: "Beaded Bracelet", centerStoneType: "Onyx" }),
    ],
    Kada: [
      t("Textured Kada", "Hammered or brushed", "a solid kada with a hammered or brushed texture and polished edges", { jewelryCategory: "Textured Kada", finish: "Hammered" }),
      t("Religious Kada", "Engraved symbols", "a kada with finely engraved religious symbols around it", { jewelryCategory: "Religious Kada", designStyle: "Religious" }),
      t("Black Diamond Kada", "Black stones in gold", "a bold kada with a row of flush-set black diamonds", { jewelryCategory: "Studded Kada", centerStoneType: "Black Diamond" }),
    ],
    Earring: [
      t("Black Diamond Studs", "Bezel-set black stones", "men's stud earrings with black diamonds in a clean bezel", { jewelryCategory: "Stud Earring", centerStoneType: "Black Diamond" }),
      t("Small Huggies", "Minimal hoops", "small, chunky gold huggie hoops", { jewelryCategory: "Huggie Earring" }),
    ],
    Cufflink: [
      t("Black Onyx", "Onyx and gold", "cufflinks with a polished black onyx face framed in gold", { centerStoneType: "Onyx" }),
      t("Monogram", "Engraved initials", "engraved monogram cufflinks in brushed gold", { jewelryCategory: "Monogram Cufflink" }),
      t("Geometric Gold", "Clean architectural shapes", "geometric cufflinks — a hexagon or square face in brushed gold with a polished bevelled edge", { designInspiration: "Geometric", finish: "Brushed" }),
    ],
    "Tie Pin": [
      t("Slim Tie Bar", "Minimal brushed bar", "a slim, minimal tie bar in brushed gold with a single polished edge line", { jewelryCategory: "Tie Bar", finish: "Brushed" }),
      t("Black Diamond Pin", "One dark stone", "a tie pin topped with a single bezel-set black diamond", { jewelryCategory: "Gemstone Tie Pin", centerStoneType: "Black Diamond" }),
    ],
    Brooch: [
      t("Lapel Pin", "Small sculpted motif", "a small sculpted lapel pin — a bee, star or leaf in gold with a few pavé stones", { jewelryCategory: "Lapel Pin" }),
      t("Statement Brooch", "Bold gemstone brooch", "a bold men's brooch with a central coloured stone in a sculpted gold frame", { jewelryCategory: "Gemstone Brooch" }),
    ],
  },
  general: {
    Ring: [
      t("Minimal Bezel Band", "Clean, unisex", "a clean, unisex band with a single small stone in a flush or bezel setting", { jewelryCategory: "Wedding Band", settingStyle: "Bezel" }),
      t("Signet Revival", "Modern signet", "a modern signet ring with a flat face and a fine engraved detail", { jewelryCategory: "Signet Ring" }),
      t("Textured Gold", "Hammered or brushed", "a textured gold band — hammered or brushed — with polished edges", { finish: "Hammered" }),
      t("Stacking Bands", "Mix and stack", "a set of slim stackable bands in different textures", { jewelryCategory: "Stackable Ring" }),
    ],
    Chain: [
      t("Paperclip Chain", "Elongated open links", "a paperclip chain of elongated open gold links", { jewelryCategory: "Paperclip Chain" }),
      t("Box Chain", "Square box links", "a sleek box chain with square links", { jewelryCategory: "Box Chain" }),
    ],
    Pendant: [
      t("Initial Pendant", "Personal letter", "a clean initial pendant in polished gold — a bold block letter that suits anyone", { jewelryCategory: "Initial Pendant" }),
      t("Coin Medallion", "Antique-style coin", "an antique-inspired gold coin medallion with engraved detail", { jewelryCategory: "Coin Pendant" }),
      t("Symbol Pendant", "Meaningful motif", "a minimal symbol pendant — an evil eye, star or spiritual motif — in polished gold", { designStyle: "Religious" }),
    ],
    Earring: [
      t("Chunky Huggies", "Small bold hoops", "small, chunky gold huggie hoops with a high polish", { jewelryCategory: "Huggie Earring" }),
      t("Single Studs", "One clean stone", "minimal stud earrings — a single bezel-set diamond or black diamond", { jewelryCategory: "Stud Earring", settingStyle: "Bezel" }),
    ],
    Bracelet: [
      t("Cuban Link", "Curb links", "a Cuban link bracelet in polished gold, worn by anyone", { jewelryCategory: "Chain Bracelet" }),
      t("Tennis Bracelet", "Line of diamonds", "a classic tennis bracelet of matched diamonds", { jewelryCategory: "Tennis Bracelet" }),
      t("Open Cuff", "Minimal cuff", "a minimal open cuff in brushed gold", { jewelryCategory: "Cuff Bracelet", finish: "Brushed" }),
    ],
    Kada: [
      t("Textured Kada", "Hammered or brushed", "a solid kada with a hammered or brushed texture and polished edges", { jewelryCategory: "Textured Kada", finish: "Hammered" }),
      t("Modern Kada", "Clean lines, flush stones", "a modern kada with clean architectural lines and a row of flush-set diamonds", { jewelryCategory: "Studded Kada", settingStyle: "Flush Set" }),
      t("Religious Kada", "Engraved symbols", "a kada with finely engraved religious symbols around it", { jewelryCategory: "Religious Kada", designStyle: "Religious" }),
    ],
  },
};

/**
 * The curated list for an audience and type. A type one audience has no list
 * for borrows the same type from another (a General kada from Men's) before
 * settling for rings.
 */
function curatedTrends(audience, type) {
  return (CURATED[audience] || {})[type] || CURATED.women[type] || CURATED.general[type] || CURATED.men[type] || CURATED.women.Ring;
}

/**
 * What a model with web search is asked, once a month per audience and type.
 *
 * Split in two because of how the search runs: OpenRouter's web plugin
 * searches with the user message itself, so that is a short, plain query —
 * a page of instructions as the query finds articles about anything the
 * instructions happen to mention. Everything else goes in the system
 * message. (Gemini's own search writes its own queries, and reads both.)
 *
 * The allowed option lists come from the builder itself, so the picks a
 * trend returns are values the builder can actually select.
 */
function buildTrendResearchPrompt({ audience, type, monthLabel, options }) {
  const who = audience === "men" ? "men's" : audience === "general" ? "unisex" : "women's";
  const piece = type.toLowerCase();
  const lists = Object.entries(options || {})
    .map(([key, values]) => `- ${key}: ${values.join(" | ")}`)
    .join("\n");

  const system = `You are a fine-jewellery trend analyst. Today is ${monthLabel}.

From the web results — jewellery trade press, fashion and bridal magazines, leading jewellers' new collections — name the 8 most important design trends in ${who} ${piece} jewellery right now (this season and the last few months). Fine and fashion jewellery both count; include the Indian market where a trend is strong there.

A trend is about how the piece itself looks: a stone shape or cut, a setting, a silhouette, a motif, a metal treatment, a way of combining stones. Name each the way jewellers and the press name it — not an invented marketing phrase. Leave out anything that is not the design itself: technology, AI, retail, pricing, marketing, sustainability claims, colour-of-the-year palettes on their own.

For each trend give:
- "label": 2–4 words, the trade's name for it
- "hint": at most 6 words
- "cue": at most two sentences saying exactly what the design looks like — shape, setting, proportions, metal and stones — concrete enough for a designer to draw
- "picks": only the 2–4 builder selections that define the trend, each value copied exactly from these lists (leave out any key that doesn't fit):
${lists}

Then, separately, "trending": for each key in those lists, the 1–3 values that are most in fashion right now for ${who} ${piece}s, copied exactly (leave out a key where nothing stands out).

Answer with only this JSON and nothing else:
{"trends":[{"label":"…","hint":"…","cue":"…","picks":{"key":"value"}}],"trending":{"key":["value"]}}`;

  const query = `Latest ${who} ${piece} design trends ${monthLabel} — what is trending in ${piece}s right now in fine jewellery`;

  return { system, query };
}

module.exports = { curatedTrends, buildTrendResearchPrompt };
