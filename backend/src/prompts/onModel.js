const { ASPECT_TEXT } = require("./textToImage");
const { buildReferenceNote } = require("./shared");
const { ANATOMY_NOTE, REALISM_NOTE, SCALE_NOTE } = require("./lifestyle");

/**
 * Styled on Model: any mix of jewellery — a matching set, several pendants to
 * layer, rings and bracelets to stack, a charm collection, or a single piece —
 * worn together by one model in a cinematic editorial photograph.
 *
 * Unlike Lifestyle and Campaign Kit there is no model photo: the model is
 * created in the shot itself. She is striking, confident and alluring in the
 * way of a luxury fashion campaign — and, like every model this app renders,
 * always clearly dressed (the brand-safety line Lifestyle's MODESTY_NOTE
 * draws); the allure comes from light, styling, pose and expression.
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
- A pair of earrings → one in each ear, mirrored. Only two DIFFERENT earring designs may share one ear, as an ear stack (lobe and upper ear).`,
  set: `The pieces are one coordinated set — she wears all of them together, each in its own place (earrings on the ears, necklace at the neck, ring on a finger, bracelet on the wrist…), as one complete, polished look.`,
  layered: `SHOW HOW TO LAYER: every necklace and pendant is worn at once, layered at clearly separated, graduated lengths — one close at the base of the neck (about 38–40 cm), one on the collarbone (about 42–45 cm), one lower on the chest (about 50–60 cm) and so on — each on its own fine chain, the chains lying cleanly without tangling, every pendant visible. A pendant photographed without a chain hangs on a fine chain (about 1 mm) in its own metal. Every pendant keeps its real small size — about a fingertip — and its exact design; layering never makes a pendant bigger or adds stones to it. Any rings, bracelets or earrings uploaded are worn too.`,
  charms: `ALL THE CHARMS ON ONE CHAIN: every charm is threaded onto ONE fine chain worn as a necklace. As on a real necklace, the charms slide down and gather together at the lowest point of the chain in one natural cluster — touching, overlapping only slightly at their edges, the front of every charm visible — never spread out or lined up for display. Any non-charm pieces are worn in their own places.`,
  stacked: `SHOW HOW TO STACK: rings stacked across her fingers — several fingers dressed, stacking bands may share one finger — and bracelets stacked together on one wrist. Her hands are close to the camera, raised near her face or collarbone, so every ring and bracelet reads clearly. Any necklaces or earrings uploaded are worn too.`,
};

/** The cinematic colour grade — the look the person picks. */
const TONES = {
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
 * One pose and styling per image, cycled — each keeps her hands near her face
 * or neckline so a ring or bracelet can share the frame with earrings and
 * necklaces. The first follows the brand's own references.
 */
const POSES = [
  {
    label: "Open white shirt",
    text: "She wears a crisp white shirt open at the collar; one hand lifts the edge of the collar or rests lightly at her collarbone. Framed from just below the eyes to mid-chest, head turned slightly so an ear shows.",
  },
  {
    label: "Chin on hand",
    text: "A close portrait: her chin rests lightly on the back of her hand, forearm across the lower frame, gaze soft and off-camera. A fine knit or silk top at the shoulders.",
  },
  {
    label: "Over the shoulder",
    text: "A three-quarter view glancing back over her shoulder, hair swept to one side to reveal the ear and neck, one hand resting on her shoulder. A silk camisole or a softly draped top.",
  },
  {
    label: "Hand in hair",
    text: "Waist-up, one hand running back through her hair at the temple, the other resting at her neckline, eyes meeting the camera with a calm, confident look. An oversized blazer over a silk top.",
  },
  {
    label: "Window light",
    text: "Seated by a tall window, elbow on the sill, fingers resting near her jaw, face turned towards the light. A soft cream knit slipping slightly off one shoulder, its neckline still clearly in frame.",
  },
  {
    label: "Profile",
    text: "A profile portrait, chin lifted, one hand at the nape of her neck, the line of the neck and jaw long and elegant. A black satin top with a clean neckline.",
  },
  {
    label: "Collar close-up",
    text: "A close crop on the neckline and one hand: a softly open linen shirt, her fingers lightly touching the jewellery at her collarbone, the lower half of her face just in frame.",
  },
  {
    label: "Leaning in",
    text: "Leaning on a stone balustrade or table, forearms crossed in front of her, hands near her chin, looking just past the camera. A sleeveless silk top.",
  },
];

/** Real frame shapes for the image API, by the aspect ids the page sends. */
const ASPECT_RATIOS = { square: "1:1", portrait: "4:5", landscape: "16:9", story: "9:16" };

/** The list of pieces, with any type the person gave, so nothing is dropped or merged. */
function pieceList(types, count) {
  return Array.from({ length: count }, (_, i) => {
    const kind = PIECE_TYPES[types[i]];
    return `  ${i + 1}. Image ${i + 1}${kind ? ` — ${kind}` : " — identify its type from the photo"}`;
  }).join("\n");
}

const PLACEMENT_RULES = `HOW EACH KIND IS WORN — AND ITS REAL SIZE
- Ring: at the base of a finger, encircling it in 3D; the band about 1.5–3 mm wide, any stone never wider than the finger.
- Earrings: at the earlobe piercing, never floating; a drop hangs freely. A product photo of earrings usually shows the SAME earring twice (front and side view, or the two of a pair) — that is ONE PAIR: one earring in each ear, mirrored at identical size and height, and NEVER two in the same ear. When only one ear is in frame, only one of the pair shows. A stud is at most a third of the earlobe's width; a drop at most half the ear's height.
- Necklace / pendant: the chain follows the curve of the neck and collarbone against the skin; a pendant is about the size of a fingertip (1–2.5 cm) unless it is clearly a statement piece; the chain fine, about 1 mm.
- Bracelet / bangle: encircling the wrist and fitting closely, about 6 cm across; a chain or tennis band at most a quarter of the wrist's width.
- Charm: a small piece of about 1–2 cm.
- Anklet: encircling the ankle, resting on the bone — frame wider (seated or full length) so it shows.
- Frame as close as the pieces allow while keeping every one of them in the shot: necklaces only → a neckline close-up; earrings with necklaces → a close portrait; rings or bracelets → her hand raised near her face or collarbone so it shares the frame.`;

/** Tasteful allure — the same line every model this app renders keeps. */
const MODEL_BLOCK = `THE MODEL
- One strikingly beautiful adult woman in her mid-twenties to thirties: a toned, graceful figure, glowing natural skin, elegant neck and hands with softly manicured natural nails, hair styled away from her ears and neck wherever jewellery sits.
- A magnetic, confident, quietly captivating presence — the allure of a luxury fashion campaign: a direct, self-assured gaze or a soft, faraway look, relaxed shoulders, a slow, graceful gesture. Elegance, beauty and confidence — never vulgar.
- ALWAYS CLEARLY DRESSED: part of her outfit is visible in every shot (a collar, a neckline, a strap, a sleeve), even in a tight crop; a bare-shouldered crop must never read as unclothed. Never nude, topless or implied nudity, no sheer or see-through fabric over the body, no lingerie or swimwear, no emphasised cleavage, no suggestive pose. The allure comes from the light, the styling, the pose and the expression — never from revealing the body.`;

const FOCUS_BLOCK = `FOCUS
- Every worn piece is tack-sharp, with every stone and metal edge crisp; her skin falls into gentle, natural focus around it and the background into soft bokeh (about f/2–f/2.8 on an 85 mm lens), exactly as a real lens renders it.
- The jewellery is the reason for the photo — the eye lands on it first.`;

const FIDELITY_REMINDER = `REMINDER — every piece's DESIGN comes out identical to its reference photo: shape, stone count, cut, colour, metal and internal proportions. Identical design does NOT mean identical size: the references are close-ups, so on the model each piece is scaled down, as a whole, to its real small size. And EXACTLY the uploaded pieces are worn — each one once, nothing merged, nothing added (no extra rings, earrings, necklaces or watch).`;

const NO_TEXT = "NO TEXT — no words, letters, numbers, logos or watermarks anywhere in the image.";

/** The scene for one image: the chosen grade with this image's pose, or the brand's brief first. */
function sceneBlock({ brief, tone, pose, index, total }) {
  const base = `- Colour and light: ${tone}.\n- Pose and styling for this image: ${pose.text}`;
  if (!brief) return `THE SHOT\n${base}`;
  return `THE SHOT — FROM THE BRAND'S BRIEF (follow it first)
"${brief}"
- Where the brief describes the model, her outfit, the place, the light or the mood, follow it exactly; anything it leaves open comes from below.
${base}
- The brief never changes the jewellery itself, its real size, or the rule that she is clearly dressed.${total > 1 ? `\n- This is image ${index + 1} of ${total}: give it its own pose and framing so it looks clearly different from the others.` : ""}`;
}

/**
 * The run's images: the model wearing every uploaded piece, each image in its
 * own pose. `count` is how many the person asked for.
 */
function buildOnModelShots(options, sourceImages, count) {
  const brief = String(options.description || "").trim();
  const tone = TONES[options.tone] || TONES.warm_cinematic;
  const arrangement = ARRANGEMENTS[options.arrangement] || ARRANGEMENTS.auto;
  const aspect = Object.hasOwn(ASPECT_RATIOS, options.aspect) ? options.aspect : "portrait";
  const types = Array.isArray(options.types) ? options.types : [];
  const n = sourceImages.length;

  const pieces =
    n === 1
      ? `THE JEWELLERY — ONE PIECE
The attached image is one piece of jewellery${PIECE_TYPES[types[0]] ? ` (${PIECE_TYPES[types[0]]})` : ""}. She wears it, and nothing else in jewellery — the shot is built around it.`
      : `THE JEWELLERY — EXACTLY ${n} PIECES, ALL WORN AT ONCE
The ${n} attached images are ${n} separate pieces of jewellery, one per image:
${pieceList(types, n)}
- She wears ALL ${n} together in the one photograph — count them: each appears exactly once. Some may look alike (two pendants, two rings, a pair of earrings across two photos) — they are still separate pieces with their own details: never merge two into one, never drop one, never add one.

HOW THEY ARE WORN
${arrangement}`;

  return Array.from({ length: count }, (_, index) => {
    const pose = POSES[index % POSES.length];
    return {
      id: `look${index + 1}`,
      label: brief ? `Look ${index + 1}` : pose.label,
      prompt: `TASK — A CINEMATIC EDITORIAL PHOTOGRAPH OF A MODEL WEARING THE CUSTOMER'S JEWELLERY

${pieces}

THE PIECES ARE THE CUSTOMER'S REAL PRODUCTS
- Reproduce every piece exactly as photographed: shape, outline, stone count, cut, colour and setting, chain links, clasp, metal colour and internal proportions. Do not redesign, simplify, merge, mirror or recolour anything.
- A photo may show the piece on a white or busy background, sometimes cropped — use only the piece itself.

${PLACEMENT_RULES}
${SCALE_NOTE}

${MODEL_BLOCK}

${sceneBlock({ brief, tone, pose, index, total: count })}

${FOCUS_BLOCK}
${ANATOMY_NOTE}
${REALISM_NOTE}

${NO_TEXT}

Image orientation: ${ASPECT_TEXT[aspect]}.

${FIDELITY_REMINDER}`,
      images: sourceImages,
    };
  });
}

function buildOnModelRefinePrompt({ instruction, referenceCount = 0 }) {
  return (
    `Apply this change to this jewellery editorial photograph (the first image): ${instruction}.` +
    buildReferenceNote(referenceCount) +
    " Keep the model's face, identity and body exactly as they are unless the change is about them. Keep every jewellery piece exactly as it is — same design, stones, metal, size and placement. Keep the colour grade unless the change is about it. She stays clearly dressed: no nudity, no sheer fabric, no lingerie. Add no text. Only apply the requested change. " +
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
