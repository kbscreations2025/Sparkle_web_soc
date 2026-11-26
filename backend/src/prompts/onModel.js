const { ASPECT_TEXT } = require("./textToImage");
const { buildReferenceNote } = require("./shared");
const { ANATOMY_NOTE, REALISM_NOTE, SCALE_NOTE, HANDS_NOTE } = require("./lifestyle");

/**
 * Styled on Model: any mix of jewellery — a matching set, several pendants to
 * layer, rings and bracelets to stack, a charm collection, or a single piece —
 * worn together by one model in a cinematic editorial photograph.
 *
 * By default there is no model photo: the model is created in the shot
 * itself. The person can instead pick one from the model library (shared with
 * Lifestyle and Campaign Kit); then that photo is sent first and she is who
 * wears the pieces (CHOSEN_MODEL_BLOCK). The brand wants the look of its references —
 * candid, sultry jewellery editorials: crops below the chin, a white shirt
 * open in a deep V, parted lips, a hand at the jaw or collarbone. Glamorous
 * and seductive, but an adult who is always dressed: no nudity, no lingerie,
 * nothing explicit — what an ad can run, and what the image model will draw.
 *
 * Every piece is the customer's real product, so it comes back exactly as
 * photographed and at its real size. The ids below are mirrored in the
 * frontend (lib/onModel.ts).
 */

/** What each uploaded piece is, when the person says — "auto" leaves it to the photo. */
const PIECE_TYPES = {
  auto: null,
  ring: "a ring",
  earrings: "earrings",
  necklace: "a necklace",
  pendant: "a pendant",
  bracelet: "a bracelet or bangle",
  charm: "a charm",
  anklet: "an anklet",
};

/** How the pieces are worn together. */
const ARRANGEMENTS = {
  auto: `Wear every piece where it naturally belongs, as one considered look:
- Several necklaces or pendants → layered at clearly graduated lengths, each on its own fine chain, the chains never tangled.
- Several rings → spread across different fingers (one or both hands); stacking bands may share one finger.
- Several bracelets → stacked together on one wrist.
- Charms → threaded together onto one chain worn as a necklace, gathered at its lowest point.
- A pair of earrings → one in each ear, mirrored. An ear stack (two earrings in one ear, lobe and upper ear) only ever happens when two or more SEPARATE earring photos were uploaded — never from one earring photo, even when that photo shows the earring twice.`,
  set: `The pieces are one coordinated set — she wears all of them together, each in its own place (earrings on the ears, necklace at the neck, ring on a finger, bracelet on the wrist…), as one complete, polished look.`,
  layered: `SHOW HOW TO LAYER: every necklace and pendant is worn at once, layered at clearly separated, graduated lengths — one close at the base of the neck (about 38–40 cm), one on the collarbone (about 42–45 cm), one lower on the chest (about 50–60 cm) and so on — each on its own fine chain, the chains lying cleanly without tangling, every pendant visible. A pendant photographed without a chain hangs on a fine chain (about 1 mm) in its own metal. Every pendant keeps its real small size — about a fingertip — and its exact design; layering never makes a pendant bigger or adds stones to it. Any rings, bracelets or earrings uploaded are worn too.`,
  charms: `ALL THE CHARMS ON ONE CHAIN: every charm is threaded onto ONE fine chain worn as a necklace. As on a real necklace, the charms slide down and gather together at the lowest point of the chain in one natural cluster — touching, overlapping only slightly at their edges, the front of every charm visible — never spread out or lined up for display. Any non-charm pieces are worn in their own places.`,
  stacked: `SHOW HOW TO STACK: rings stacked across her fingers — several fingers dressed, stacking bands may share one finger — and bracelets stacked together on one wrist. Her hands are close to the camera, raised near her face or collarbone, so every ring and bracelet reads clearly. Any necklaces or earrings uploaded are worn too.`,
};

/**
 * The colour grade — the look the person picks. "natural" is the default: the
 * clean, warm daylight of the brand's references (modern fine-jewellery
 * campaigns), rather than a heavy film grade.
 */
const TONES = {
  natural:
    "the clean, natural colour of a modern fine-jewellery campaign — soft daylight from a large window or one soft studio light, true-to-life colour with no heavy grade; warm, healthy, sun-kissed skin with a soft natural glow and real texture; quiet neutral backgrounds — pale grey, warm cream or beige, or deep black fabric; the gold reads warm and rich",
  warm_cinematic:
    "a warm cinematic film grade — honeyed highlights, glowing golden skin, soft amber light falling from one side into deep, warm shadows with a faint teal-olive tint, fine 35 mm film grain; like a still from an art-house film",
  soft_editorial:
    "a soft, airy editorial look — creamy whites, warm beige and ivory, gentle daylight from a large window, low contrast and delicate shadows; the calm luxury of a fashion lookbook",
  moody:
    "a moody, low-key cinematic look — one warm key light sculpting her face, neck and hands out of deep shadow, rich blacks and glowing gold; intimate and dramatic",
  golden_hour:
    "outdoors at golden hour — a low sun behind or beside her, warm rim light in her hair, a soft haze, sun-kissed skin; a summer evening's warmth",
  riviera:
    "a sunlit Mediterranean summer — bright natural sun, crisp clean shadows, whitewashed walls and sea-blue tones in the background; relaxed holiday luxury",
  evening:
    "evening glamour — warm tungsten light, a dark background with soft bokeh from city or candle lights, a fine glint on every piece; polished and sophisticated",
};

/**
 * The poses a run picks from — a different one per image, at random. Modelled
 * on the brand's references: tight, candid, intimate crops — full lips, the
 * jaw, the neck, fingertips at the face or neckline — caught mid-moment.
 *
 * `shows` is what each crop can hold: "neck" (necklaces, pendants, charms),
 * "ear" (earrings) and "hand" (rings, bracelets). A run whose pieces are typed
 * gets the poses that can show all of them first — a set of rings isn't
 * given an ear-stack profile — and every shot is told to adapt its crop so
 * no piece is left out.
 */
const POSES = [
  {
    label: "Open shirt, below the chin",
    shows: ["neck", "ear", "hand"],
    text: "CROP: from just below her nose down to mid-chest — her eyes are out of frame. A crisp white shirt unbuttoned into a deep V that frames her neck and collarbones, her fingers resting at her collarbone or lightly tugging the collar open, her hair tucked back so the earlobe shows. Lips softly parted and glossy. Caught mid-moment, as if she just turned.",
  },
  {
    label: "Hand at the jaw",
    shows: ["neck", "ear", "hand"],
    oneEar: true,
    text: "CROP: from the tip of her nose down to her collarbones — her eyes are out of frame. Her head tilted, fingertips trailing along her jaw just under the ear, lips parted, a white shirt open at the throat. Sultry and unposed.",
  },
  {
    label: "Hand on the cheek",
    shows: ["ear", "hand"],
    oneEar: true,
    text: "CROP: the lower half of her face, from just under her eyes to her chin — her eyes are out of frame. Her hand rests softly against her cheek, fingers along the cheekbone with the back of the hand towards the camera, lips softly parted and glossy, her ear and earlobe just behind her fingers; a cream top at the lower edge. Warm window light.",
  },
  {
    label: "Chin on wrist",
    shows: ["ear", "hand"],
    text: "CROP: a close portrait of her face and hand. Her chin resting on her wrist, forearm across the lower frame, a heavy-lidded gaze off-camera, glossy lips, a dark fine-knit top. Intimate, magazine-cover glamour.",
  },
  {
    label: "Lips and a ring",
    shows: ["hand"],
    text: "CROP: an extreme close-up from just below her nose to her chin — her eyes are out of frame. Her full, softly parted lips at the top of the frame and her hand cupping her jaw just below them, the ring turned towards the camera; real skin texture, every detail of the ring sharp.",
  },
  {
    label: "Hands crossed",
    shows: ["hand"],
    text: "CROP: only her hands, close to the camera — no face. One hand laid gently over the other, fingers long and relaxed, against her black top; warm light rakes across the knuckles so the rings and bracelets are the whole picture. Her own short natural nails with a sheer nude polish, real creases at the knuckles.",
  },
  {
    label: "Arms folded at the shoulder",
    shows: ["hand"],
    text: "CROP: from just below her nose down — her lips and chin at the top edge, her eyes out of frame. Below them her forearms cross and her hands rest on her bare shoulder and upper arm, fingers relaxed, the rings in sharp focus. Warm brown-beige background, soft daylight.",
  },
  {
    label: "Hands in her hair",
    shows: ["ear", "hand"],
    oneEar: true,
    text: "CROP: seen from behind and slightly to the side — no face. Both hands raised into a loose low bun at the back of her head, fingers spread through dark hair, the rings on several fingers facing the camera, the nape of her neck and the edge of an ear in frame. Soft pale-grey background.",
  },
  {
    label: "Tucking her hair",
    shows: ["ear", "hand"],
    oneEar: true,
    text: "CROP: a close portrait from her forehead to her shoulder. She tucks her hair behind her ear with one hand, eyes lowered, freckles and real skin texture; the rings on her fingers and fine bracelets on her wrist, an olive fine-knit top. Soft daylight against a pale grey wall.",
  },
  {
    label: "Ear in profile",
    shows: ["ear", "neck"],
    oneEar: true,
    text: "CROP: a side-profile close-up of her ear, cheek and jaw. Her gaze drifting away from the camera, a soft pale-blue knit slipping off a bare shoulder at the lower edge; the earring tack-sharp, the rest of her face falling into soft focus. Glowing skin, clean daylight.",
  },
  {
    label: "Pendant between the fingers",
    shows: ["neck", "hand"],
    text: "CROP: from her chin down to her chest — her face above the chin is out of frame. Her fingers lift the chain towards the camera, holding it between thumb and forefinger just below the neckline so the pendant or charms dangle sharp in front of her softly blurred chest and an ivory robe. Short, natural nails, warm light.",
  },
  {
    label: "Pulling the chain",
    shows: ["neck", "hand"],
    text: "CROP: from the tip of her nose to her collarbones — her eyes are out of frame. Lips softly parted, her fingertips pulling the fine chain gently out to either side at her throat, the pendant centred just below. Clean, soft light on a pale background.",
  },
  {
    label: "Layered on black",
    shows: ["neck", "ear"],
    text: "CROP: from her lips to mid-chest — her eyes are out of frame. A fitted black tee or black V-neck, the necklaces layered against the black fabric and her skin, earrings at her earlobes just in frame. Soft, clean studio daylight on a pale grey background.",
  },
  {
    label: "Deep V shirt",
    shows: ["neck", "ear"],
    text: "CROP: from her chin down to the sternum — her face above the chin is out of frame. A crisp white pleated shirt open into a deep V, dark tousled hair falling over one shoulder and tucked behind the other ear, the pendant lying in the V against her skin.",
  },
  {
    label: "Golden open collar",
    shows: ["neck", "ear"],
    oneEar: true,
    text: "CROP: from just below her nose to her chest — her eyes are out of frame. Warm low sun across her neck and jaw, a cream linen shirt falling open at the collar, her head turned in three-quarter profile so an earring hangs free, fine necklaces glowing on sun-kissed skin.",
  },
  {
    label: "Blazer lapels",
    shows: ["neck", "ear", "hand"],
    text: "CROP: from her chin to her waist — her face above the chin is out of frame. An open black blazer over a black camisole, both hands holding the lapels at her chest with the rings on her fingers, the necklaces lying on her skin, earrings below her hair. Confident and bold.",
  },
  {
    label: "Over the shoulder",
    shows: ["neck", "ear", "hand"],
    oneEar: true,
    text: "CROP: a close portrait from her forehead to her shoulder blade. A seductive glance back over her shoulder, hair swept to one side baring the ear and neck, one hand resting on her shoulder; a silk slip top with thin straps, the shoulder line in frame.",
  },
  {
    label: "Leaning in",
    shows: ["neck", "ear", "hand"],
    text: "CROP: from her lips to her chest — her eyes are out of frame. Leaning towards the camera in a sleeveless chocolate-brown or black top, the necklaces falling forward away from her body, a hand near her chin. An intimate closeness.",
  },
  {
    label: "Hair sweep",
    shows: ["neck", "ear", "hand"],
    text: "CROP: from just under her eyes to her chest — her eyes are out of frame. She sweeps her hair back off her neck with one hand, the other at her neckline, lips parted mid-laugh or mid-breath. A black silk shirt open at the collar.",
  },
];

/** Where on her each kind of piece is worn — what a pose's crop has to hold. */
const REGION_BY_TYPE = { ring: "hand", bracelet: "hand", earrings: "ear", necklace: "neck", pendant: "neck", charm: "neck" };

/** A copy of `list` in random order — each run gets its own mix. */
function shuffled(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * This run's poses, one per image, at random — the ones that can show every
 * typed piece first. "auto" pieces don't narrow the choice: the shot adapts
 * its crop to whatever they turn out to be.
 */
function posesFor(types, pieceCount, count) {
  const needed = [...new Set(types.slice(0, pieceCount).map((type) => REGION_BY_TYPE[type]).filter(Boolean))];
  const covers = (pose) => needed.filter((region) => pose.shows.includes(region)).length;
  // A stable sort keeps the random order among poses that cover as much.
  const ranked = shuffled(POSES).sort((a, b) => covers(b) - covers(a));
  return Array.from({ length: count }, (_, index) => ranked[index % ranked.length]);
}

/** Real frame shapes for the image API, by the aspect ids the page sends. */
const ASPECT_RATIOS = { square: "1:1", portrait: "4:5", landscape: "16:9", story: "9:16" };

/**
 * The list of pieces, with any type the person gave, so nothing is dropped or
 * merged. `offset` is how many images come before them (the model photo).
 */
function pieceList(types, count, offset = 0) {
  return Array.from({ length: count }, (_, i) => {
    const kind = PIECE_TYPES[types[i]];
    // Said beside the photo itself: two of the pair in one ear is the mistake tests keep showing.
    const pair =
      types[i] === "earrings"
        ? " — ONE PAIR of one design, even though the photo shows it twice (side and front): one in each ear, never two in the same ear"
        : "";
    return `  ${i + 1}. Image ${i + 1 + offset}${kind ? ` — ${kind}${pair}` : " — identify its type from the photo"}`;
  }).join("\n");
}

const PLACEMENT_RULES = `HOW EACH KIND IS WORN — AND ITS REAL SIZE
- Ring: at the base of a finger, encircling it in 3D; the band about 1.5–3 mm wide, any stone never wider than the finger.
- Earrings: at the earlobe piercing, never floating; a drop hangs freely. A product photo of earrings usually shows the SAME earring twice — once from the side (for a hoop, just a thin line of metal or stones) and once from the front, or the two of a pair — so the two shapes in it are ONE design and ONE PAIR: one earring in each ear, mirrored at identical size and height, and NEVER two in the same ear. When only one ear is in frame, only one of the pair shows. A stud is at most a third of the earlobe's width; a drop at most half the ear's height.
- Necklace / pendant: the chain follows the curve of the neck and collarbone against the skin; a pendant is about the size of a fingertip (1–2.5 cm) unless it is clearly a statement piece; the chain fine, about 1 mm.
- Bracelet / bangle: encircling the wrist and fitting closely, about 6 cm across; a chain or tennis band at most a quarter of the wrist's width.
- Charm: a small piece of about 1–2 cm.
- Anklet: encircling the ankle, resting on the bone — frame wider (seated or full length) so it shows.
- Frame as close as the pieces allow while keeping every one of them in the shot: necklaces only → a neckline close-up; earrings with necklaces → a close crop from her nose or lips down that holds both the earlobes and the neckline; rings or bracelets → her hand raised near her face or collarbone so it shares the frame.`;

/**
 * Her wardrobe, grooming and the closeness of the camera — from the brand's
 * references. Each pose names its own outfit; this is the palette around it.
 * Nails used to be "a nude or soft-pink manicure" (and two poses said "nude,
 * glossy manicure"), which came back as long, glassy, fake-looking nails; they
 * are now her own natural nails, and HANDS_NOTE spells out what real looks like.
 */
const STYLING = `- STYLING: necklines that open the neck and collarbones for the jewellery — a crisp white or pleated shirt unbuttoned into a deep V, a cream linen shirt, a fitted black tee or V-neck, an open black blazer, a fine knit in cream, olive or soft blue slipping off one shoulder, a silk slip top with thin straps, an ivory robe. Natural, glowing make-up, glossy nude lips; her own natural nails, short to medium, bare or in a sheer nude or soft-pink polish.
- INTIMATE AND CLOSE: the camera a hand's length away — her lips, jaw, neck, collarbones and fingertips filling the frame, the sensual closeness of a modern fine-jewellery campaign.`;

/**
 * Sultry editorial glamour, as in the brand's references — and the line it
 * stops at: an adult, always dressed, never explicit.
 */
const MODEL_BLOCK = `THE MODEL
- One strikingly beautiful adult woman, clearly in her mid-twenties to thirties: a toned figure, glowing sun-warmed skin, a long elegant neck, defined collarbones, slender, real hands with her own natural nails, hair styled away from her ears and neck wherever jewellery sits.
- Hot, glamorous and confident — the sultry allure of a high-fashion jewellery campaign: softly parted, glossy lips, a heavy-lidded or knowing gaze, a slow touch at her jaw, neck or collarbone. Seductive in the way a luxury ad is, never vulgar.
- CANDID, NOT POSED: caught mid-movement, like an off-guard frame from a real editorial shoot — a turn of the head, a hand halfway through her hair, a breath, a half-smile. Mostly tight crops below the chin or just under the eyes, the way jewellery campaigns frame it.
${STYLING}
- ALWAYS DRESSED AND NEVER EXPLICIT: part of her clothing is always in frame; no nudity, no exposed breasts or nipples, nothing see-through over the chest, no lingerie or swimwear, no sexual act or pose. The heat comes from the expression, the light, the open neckline and the confidence — not from undressing.`;

/**
 * When the person picks a model from the library: that real person wears the
 * pieces. Her identity is kept; the pose, styling and mood still come from
 * this tool, and the same always-dressed line holds.
 */
const CHOSEN_MODEL_BLOCK = `THE MODEL — THE PERSON IN IMAGE 1
- IMAGE 1 IS THE MODEL, NOT A PIECE OF JEWELLERY. Photograph exactly this person: the same face and features, the same skin tone and complexion, the same hair colour and texture, the same age and body proportions. Anyone who knows her must recognise her. Never swap her for a different person, never change her ethnicity, never make her younger, thinner or different.
- Only the photograph is new: her pose, crop, expression, outfit, light and setting come from the shot described below, not from image 1. Where a crop leaves her eyes out of frame, her lips, jaw, skin, neck and hair are still unmistakably hers.
- Any jewellery she wears in image 1 is NOT part of this shoot — remove it all; she wears only the uploaded pieces.
- Hot, glamorous and confident — the sultry allure of a high-fashion jewellery campaign: softly parted lips, a knowing gaze, a slow touch at her jaw, neck or collarbone. CANDID, NOT POSED: caught mid-movement, like an off-guard frame from a real editorial shoot.
${STYLING}
- ALWAYS DRESSED AND NEVER EXPLICIT: part of her clothing is always in frame; no nudity, no exposed breasts or nipples, nothing see-through over the chest, no lingerie or swimwear, no sexual act or pose.`;

const FOCUS_BLOCK = `FOCUS
- Every worn piece is tack-sharp, with every stone and metal edge crisp; her skin falls into gentle, natural focus around it and the background into soft bokeh (about f/2–f/2.8 on an 85 mm lens), exactly as a real lens renders it.
- The jewellery is the reason for the photo — the eye lands on it first.`;

const FIDELITY_REMINDER = `REMINDER — every piece's DESIGN comes out identical to its reference photo: shape, stone count, cut, colour, metal and internal proportions. Identical design does NOT mean identical size: the references are close-ups, so on the model each piece is scaled down, as a whole, to its real small size. And EXACTLY the uploaded pieces are worn — each one once, nothing merged, nothing added (no extra rings, earrings, necklaces or watch). Earrings are one pair: one in each ear, never two of them in the same ear — when only one ear is in frame, only one earring shows.`;

const NO_TEXT = "NO TEXT — no words, letters, numbers, logos or watermarks anywhere in the image.";

/** The scene for one image: the chosen grade with this image's pose, or the brand's brief first. */
function sceneBlock({ brief, tone, pose, index, total, chosenModel = false, earrings = "no" }) {
  /*
   * Where only one ear is in frame, models kept putting both earrings of the
   * pair on it — every two-in-one-ear result in testing came from such a
   * pose — so those poses say it outright.
   */
  const oneEar =
    pose.oneEar && earrings !== "no"
      ? `- ONE EAR ONLY: in this pose just one of her ears is in frame, so ${earrings === "maybe" ? "if she wears earrings, " : ""}exactly ONE earring shows, in that earlobe — its partner is on the ear we can't see. Never put both earrings of the pair on the visible ear.\n`
      : "";
  const base =
    `- Colour and light: ${tone}.\n- Pose and styling for this image: ${pose.text}\n` +
    oneEar +
    "- The CROP is part of the brief — frame exactly where it says. When it starts at her nose, lips or chin, her eyes are not in the photograph: the intimacy comes from the lips, neck and hands.\n" +
    "- Adapt that pose and crop only as much as it takes to keep EVERY uploaded piece in frame at its real size — raise the hand wearing the rings or bracelets to her face or neckline, tuck her hair behind her ear so the earrings show, open the crop down to the neckline for the necklaces. Never leave a piece out to keep the pose.";
  if (!brief) return `THE SHOT\n${base}`;
  return `THE SHOT — FROM THE BRAND'S BRIEF (follow it first)
"${brief}"
- Where the brief describes ${chosenModel ? "her outfit, hair styling" : "the model, her outfit"}, the place, the light or the mood, follow it exactly; anything it leaves open comes from below.${chosenModel ? "\n- The brief never changes who she is: she stays the person in image 1." : ""}
${base}
- The brief never changes the jewellery itself, its real size, or the rule that she is clearly dressed.${total > 1 ? `\n- This is image ${index + 1} of ${total}: give it its own pose and framing so it looks clearly different from the others.` : ""}`;
}

/**
 * The run's images: the model wearing every uploaded piece, each image in its
 * own pose. `count` is how many the person asked for. `modelImage`, when the
 * person picked one from the library, is sent first and is who wears them;
 * without it the model is created in the shot.
 */
function buildOnModelShots(options, sourceImages, count, { modelImage = null } = {}) {
  const brief = String(options.description || "").trim();
  const tone = TONES[options.tone] || TONES.natural;
  const arrangement = ARRANGEMENTS[options.arrangement] || ARRANGEMENTS.auto;
  const aspect = Object.hasOwn(ASPECT_RATIOS, options.aspect) ? options.aspect : "portrait";
  const types = Array.isArray(options.types) ? options.types : [];
  const n = sourceImages.length;
  const offset = modelImage ? 1 : 0;
  const images = modelImage ? [modelImage, ...sourceImages] : sourceImages;

  const pieces =
    n === 1
      ? `THE JEWELLERY — ONE PIECE
${modelImage ? "Image 2" : "The attached image"} is one piece of jewellery${PIECE_TYPES[types[0]] ? ` (${PIECE_TYPES[types[0]]})` : ""}. She wears it, and nothing else in jewellery — the shot is built around it.`
      : `THE JEWELLERY — EXACTLY ${n} PIECES, ALL WORN AT ONCE
${modelImage ? `Images 2 to ${n + 1}` : `The ${n} attached images`} are ${n} separate pieces of jewellery, one per image:
${pieceList(types, n, offset)}
- She wears ALL ${n} together in the one photograph — count them: each appears exactly once. Some may look alike (two pendants, two rings, a pair of earrings across two photos) — they are still separate pieces with their own details: never merge two into one, never drop one, never add one.

HOW THEY ARE WORN
${arrangement}`;

  // Picked fresh for every run — see posesFor.
  const poses = posesFor(types, n, count);
  // Whether the pieces include earrings: known from a type, or possible behind an "auto".
  const pieceTypes = Array.from({ length: n }, (_, i) => types[i] || "auto");
  const earrings = pieceTypes.includes("earrings") ? "yes" : pieceTypes.includes("auto") ? "maybe" : "no";

  return poses.map((pose, index) => {
    return {
      id: `look${index + 1}`,
      label: brief ? `Look ${index + 1}` : pose.label,
      prompt: `TASK — AN EDITORIAL PHOTOGRAPH OF A MODEL WEARING THE CUSTOMER'S JEWELLERY

${pieces}

THE PIECES ARE THE CUSTOMER'S REAL PRODUCTS
- Reproduce every piece exactly as photographed: shape, outline, stone count, cut, colour and setting, chain links, clasp, metal colour and internal proportions. Do not redesign, simplify, merge, mirror or recolour anything.
- A photo may show the piece on a white or busy background, sometimes cropped — use only the piece itself.

${PLACEMENT_RULES}
${SCALE_NOTE}

${modelImage ? CHOSEN_MODEL_BLOCK : MODEL_BLOCK}

${sceneBlock({ brief, tone, pose, index, total: count, chosenModel: Boolean(modelImage), earrings })}

${FOCUS_BLOCK}
${ANATOMY_NOTE}
${REALISM_NOTE}
${HANDS_NOTE}

${NO_TEXT}

Image orientation: ${ASPECT_TEXT[aspect]}.

${FIDELITY_REMINDER}${modelImage ? "\nAnd the model is the person in image 1 — same face, skin tone and hair." : ""}${
        pose.oneEar && earrings !== "no"
          ? `\n${earrings === "maybe" ? "If she wears earrings: this" : "This"} image shows only one of her ears — ONE earring in it, never two.`
          : ""
      }`,
      images,
    };
  });
}

function buildOnModelRefinePrompt({ instruction, referenceCount = 0 }) {
  return (
    `Apply this change to this jewellery editorial photograph (the first image): ${instruction}.` +
    buildReferenceNote(referenceCount) +
    " Keep the model's face, identity and body exactly as they are unless the change is about them. Keep every jewellery piece exactly as it is — same design, stones, metal, size and placement. Keep the colour grade unless the change is about it. She stays clearly dressed: no nudity, no sheer fabric, no lingerie. Her hands keep real, natural nails — short to medium, real texture, never long, glossy or plastic-looking. Add no text. Only apply the requested change. " +
    ANATOMY_NOTE
  );
}

module.exports = {
  ON_MODEL_PIECE_TYPES: Object.keys(PIECE_TYPES),
  ON_MODEL_ARRANGEMENTS: Object.keys(ARRANGEMENTS),
  ON_MODEL_TONES: Object.keys(TONES),
  ON_MODEL_ASPECT_RATIOS: ASPECT_RATIOS,
  buildOnModelShots,
  buildOnModelRefinePrompt,
};
