const { ASPECT_TEXT } = require("./textToImage");
const { buildReferenceNote } = require("./shared");
const { HANDS_NOTE } = require("./lifestyle");

/**
 * Charm Shots: separate charm photos threaded together onto ONE chain and
 * photographed in a different setting per image — held in a hand, poured into
 * open palms, draped on stone, dropped on silk…
 *
 * The brief is a real photograph, not an AI picture: real charms slide to the
 * bottom of a chain and bunch together under gravity, overlapping, so that is
 * how they are described — never fanned out or lined up for display, which is
 * what made earlier results read as generated. Light, colour and scale are
 * likewise held to what a camera would really record.
 *
 * Every charm is the customer's real product, so it comes back exactly as
 * photographed. When the brand writes a brief, the brief sets the scene and
 * the variations differ by angle and light instead.
 *
 * Each run picks its scenes (or, with a brief, its angles and light) at
 * random, so two runs on the same charms don't come back looking the same.
 * The scenes live only here; the page doesn't list them.
 */

/** The chain's metal. "match" follows the charms — usually vermeil or gold. */
const CHARM_METALS = {
  match: "in exactly the same metal colour and finish as the charms",
  yellow_gold: "in yellow gold",
  rose_gold: "in rose gold",
  silver: "in sterling silver",
};

/**
 * The scenes a run picks from — a different one per image, chosen at random.
 * They follow the brand's references: a hand dangling the necklace, the
 * necklace poured into open palms, and (from the later set) quiet still lifes
 * — raking sunlight on warm paper, marble flat lays, seamless studio
 * backdrops, colour-block paper — with the necklace small in the frame.
 * `hands: true` marks the scenes with a hand in them, which get HANDS_NOTE.
 */
const CHARM_SCENES = [
  {
    id: "sunbeam",
    label: "Sunbeam on warm paper",
    text: "The necklace lying on smooth warm-beige paper, the chain trailing in from the top of the frame and all the charms gathered together at its lowest point. One band of low late-afternoon sunlight falls diagonally across the paper and over the charms, with the rest of the frame in soft warm shade — the light is the only drama. Shot close, slightly from above.",
  },
  {
    id: "shadow_wall",
    label: "Light and shadow wall",
    text: "The necklace hanging straight down in front of a warm taupe plaster wall, the charms gathered at the bottom of the chain. A crisp diagonal edge of sunlight cuts across the wall behind, half of it bright and warm, half in soft shadow, and the charms catch the light. Framed on the lower part of the chain, the top of the chain leaving the frame.",
  },
  {
    id: "marble",
    label: "Marble flat lay",
    text: "A top-down flat lay on white Carrara marble with soft grey veining: the chain comes in from the top edge in a narrow V and the charms lie together where it meets, small in the frame with plenty of calm marble around them. Soft, even overcast daylight and very gentle shadows.",
  },
  {
    id: "gradient",
    label: "Studio gradient",
    text: "The necklace hanging in front of a seamless studio backdrop that shades smoothly from deep teal at the top to a pale misty grey-green at the bottom. The charms hang together at the bottom of the chain and cast a soft, faint shadow on the backdrop below them. One soft studio light from the side.",
  },
  {
    id: "grey_seamless",
    label: "Soft grey close-up",
    text: "A close-up of the bottom of the necklace hanging against soft, cool pale-grey seamless paper, the charms together in a small bunch, sharp, with the chain above them softening out of focus. Soft, diffused light from one side; quiet, minimal and modern.",
  },
  {
    id: "cream_card",
    label: "Cream still life",
    text: "The necklace laid down on smooth cream card in a relaxed loop, the charms resting together at one end, photographed at a slight angle from above. A single soft light from the upper left gives each charm a small, soft shadow on the card. Minimal, warm, lots of empty space.",
  },
  {
    id: "colour_block",
    label: "Colour-block paper",
    text: "A top-down flat lay across two sheets of matte paper meeting at a diagonal — dusty rose on one side, soft apricot on the other. The chain lies in a long, loose line across the join and the charms sit together at its lowest point. Soft, even daylight, gentle shadows.",
  },
  {
    id: "sage_macro",
    label: "Sage macro",
    text: "A macro close-up of the charms hanging together at the bottom of the chain, in front of a soft out-of-focus background of pale sage and warm linen tones. Warm light from the side catches the edges of the charms. Very shallow depth of field — only the charms are sharp.",
  },
  {
    id: "tabletop",
    label: "Pale tabletop",
    text: "The necklace resting on a smooth, pale grey-white tabletop, the chain in a loose curve and the charms lying together in a small group, seen from a low three-quarter angle. One soft light from behind and to the side, so each charm has a gentle reflection and a soft shadow on the surface. Clean, quiet, editorial.",
  },
  {
    id: "hand",
    label: "Held in hand",
    hands: true,
    text: "A woman's slender bare forearm raised in front of a plain off-white painted wall; the chain hangs from between her fingers in two long lines that meet at the bottom, where all the charms have slid down together into one small natural bunch. Soft daylight from a window to one side, so the wall falls off gently from light to slightly darker. Framed fairly tight on the lower half of the chain so the bunch of charms is sharp and the hand at the top is softer.",
  },
  {
    id: "palms",
    label: "In open palms",
    hands: true,
    text: "Two hands held together, palms up and slightly cupped, the necklace just poured into them: the chain coiled loosely in a small heap and the charms lying close together in a loose little group in the middle of the palms, touching, each one face-up. Dark navy knitwear out of focus behind the hands. Soft window light from above.",
  },
  {
    id: "plinth",
    label: "Stone plinth",
    text: "The necklace draped over the edge of a pale travertine block on a sunny windowsill, the charms hanging together in a bunch just over the edge. Warm late-afternoon sun with soft window-frame shadows across the stone; a warm, peachy plaster wall behind, out of focus.",
  },
  {
    id: "silk",
    label: "Silk drape",
    text: "The necklace dropped casually onto rumpled champagne-pink silk, the chain falling in a loose curve and the charms lying together in a small heap where the curve bottoms out. Soft, diffused daylight; the folds of the silk shift gently from light blush to warm champagne.",
  },
  {
    id: "wall",
    label: "Hung on a painted wall",
    text: "The necklace hanging from a small brass hook on a softly textured wall painted dusty blue, the chain falling straight and all the charms gathered at its lowest point in one bunch, casting a soft small shadow on the wall. Natural daylight, the wall a little brighter at the top than the bottom.",
  },
  {
    id: "worn",
    label: "Worn on the collarbone",
    text: "Worn by a woman, cropped from just below the chin to mid-chest — no face; the chain lies on her collarbone and the charms sit together in a small bunch at the centre, resting on her skin. A soft cream knit top or bare shoulders, warm early-evening daylight.",
  },
  {
    id: "box",
    label: "Velvet jewellery box",
    text: "The necklace resting in an open vintage jewellery box lined with deep emerald velvet, the chain coiled loosely and the charms lying together in a small pile. A soft lamp light from one side, the corners of the box falling into shadow.",
  },
  {
    id: "linen",
    label: "Linen & dried flowers",
    text: "The necklace set down on softly crumpled oat-coloured linen, the chain in a relaxed curve and the charms together in a small heap, with a few dried flowers and a small ceramic dish out of focus at the edges. Gentle morning daylight.",
  },
];

/** When the brief sets the scene, each image still needs to look different: its own framing… */
const COMPOSITIONS = [
  "a close, intimate framing on the bunch of charms",
  "a slightly wider view that shows more of the scene, the necklace small and delicate in it",
  "a low three-quarter angle with a shallow depth of field",
  "a top-down overhead view",
  "a relaxed, slightly off-centre handheld framing",
  "a quiet, centred framing with lots of empty space around the necklace",
  "a macro close-up where only the charms are sharp",
  "the necklace hanging, framed on the lower part of the chain",
];

/** …and its own light. */
const LIGHTS = [
  "soft window daylight from one side",
  "one band of low, warm sunlight falling diagonally across the scene",
  "soft backlight from a window behind",
  "low side light with long, soft shadows",
  "even, soft overcast daylight",
  "warm late-afternoon light",
  "one soft studio light with a gentle shadow",
  "cool, calm morning light",
];

/** A copy of `list` in random order — each run gets its own mix. */
function shuffled(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const CHARM_ASPECT_RATIOS = { square: "1:1", portrait: "4:5", landscape: "16:9", story: "9:16" };

/** Every image: the one necklace, built from the real charms, hanging the way real charms hang. */
function necklaceBlock(count, metal) {
  const plural = count > 1;
  return `ONE NECKLACE, ALL THE CHARMS
- Thread ${plural ? `all ${count} attached charms` : "the attached charm"} onto exactly ONE very thin, delicate chain ${metal} — a dainty fine cable or fine curb chain about 0.8–1 mm thick, the kind of fine everyday chain sold with small charms. In the photo the chain reads as a fine thread of metal next to the charms: never chunky, heavy, wide-linked, paperclip or statement-sized. There is only one chain in the image — never two or more chains, no layering, no second necklace or bracelet. The chain is the only thing added to the jewellery.
- The whole necklace is small, fine and delicate — dainty jewellery, never bold or oversized.
${
  plural
    ? `- HOW REAL CHARMS HANG: each charm hangs from the chain by its own small jump ring, and the rings are free to slide — so, exactly as on a real necklace, gravity has pulled them all down to the lowest point of the chain, where they gather close together in one natural cluster. They touch and nudge each other, sit at slightly different depths, and some are turned a little sideways or tilted — but they overlap only slightly at their edges, so the front of every charm stays clearly visible. When the necklace lies on a surface they lie together in a small, loose group where the chain bottoms out.
- They are NOT spread out along the chain, NOT evenly spaced and NOT lined up in a neat row facing the camera — the grouping looks like it happened naturally, not arranged for display.
- EXACTLY ${count} CHARMS — count them: the finished photo shows all ${count}, each one exactly once. Some charms may look alike (for example two evil eyes, two stars or two initials) — they are still separate pieces, each with its own stones and details: never merge two into one, never drop one, never add one.`
    : "- The charm hangs from the chain by its small jump ring at the chain's lowest point, the way a real pendant settles."
}

THE CHARMS ARE THE CUSTOMER'S REAL PRODUCTS
- ${plural ? `The ${count} attached images are ${count} separate charms, one per image` : "The attached image is one charm"}. A photo may show the charm on a white or busy background, sometimes cropped — use only the charm itself.
- Reproduce every charm exactly as photographed: same shape, outline, engraving, stone colour, stone count and setting, bail, metal colour and proportions — a star keeps its exact number of points, a letter its exact form, a stone its exact cut. Do not redesign, simplify, merge, mirror or recolour anything. Do not invent extra charms or leave any out.
- True-to-life size: these are small charms of about 1–2 cm, in proportion to one another and to the chain — next to a hand, each is about the size of a fingertip or smaller. Bring the camera closer rather than enlarging the charms.`;
}

/** What separates a photograph from a picture that reads as generated. */
const PHOTO_BLOCK = `A REAL PHOTOGRAPH — IT MUST NOT LOOK AI-GENERATED
- Make it look exactly like a real photograph taken by a professional jewellery photographer on a full-frame camera with a 100 mm macro lens at around f/4–f/5.6, in real light — not CGI, not a 3D render, not a digital illustration.
- Natural light only: soft window daylight or one soft light source, with real, gentle shadows. True, natural colours with a soft, slightly muted editorial grade. No glow, bloom or haze, no halo around the metal, no star-shaped sparkle flares, no over-saturated colours, no airbrushed or plastic-smooth surfaces.
- Real-world texture and imperfection: the chain has small natural kinks and twists and does not curve perfectly; skin has real texture, fine lines, pores and natural cuticles; fabric, stone and paper show their real grain and creases; a very faint natural film grain.
- Real depth of field: focus is on the charms; the chain and the background soften gradually. Not everything in the frame is razor-sharp.
- A candid, editorial composition — relaxed and slightly imperfect, not perfectly centred or symmetrical, never staged-looking.
- The charms are the subject of the photo and clearly in focus, but they sit naturally in the scene at their real size.
- Where a person appears: no face.`;

const NO_TEXT = "NO TEXT — no words, letters, numbers, logos or watermarks anywhere in the image.";

/** The scene for one image: a curated one, or the brand's brief with this image's own angle and light. */
function sceneBlock({ brief, scene, composition, light, index, total }) {
  if (!brief) return `THE SCENE\n${scene.text}`;
  return `THE SCENE — FROM THE BRAND'S BRIEF (follow it first)
"${brief}"
- If the brief describes a setting, place, surface, props or a way of showing the necklace, build the image around exactly that, and give this image its own camera angle and light: ${composition}, with ${light} (unless the brief asks for a different light).
- If the brief only asks for a colour, light, mood or detail, apply it to this scene: ${scene.text}
- The brief never changes the charms themselves: it is still exactly one chain, with the charms bunched together naturally.${total > 1 ? `\n- This is image ${index + 1} of ${total}: it must look clearly different from the others.` : ""}`;
}

/**
 * The run's images: all the charms on one chain, each image in its own scene.
 * `count` is how many the person asked for.
 */
function buildCharmStoryShots(options, sourceImages, count) {
  const brief = String(options.description || "").trim();
  const metal = CHARM_METALS[options.metal] || CHARM_METALS.match;
  const aspect = Object.hasOwn(CHARM_ASPECT_RATIOS, options.aspect) ? options.aspect : "portrait";

  // Picked fresh for every run, without repeats until a list runs out.
  const scenes = shuffled(CHARM_SCENES);
  const compositions = shuffled(COMPOSITIONS);
  const lights = shuffled(LIGHTS);

  return Array.from({ length: count }, (_, index) => {
    const scene = scenes[index % scenes.length];
    /*
     * Hands in the held/palms shots came back with long, glossy, AI-looking
     * nails ("softly manicured nails" was all the prompt said), so those shots
     * get the full real-hands note. A brief may put a hand in any shot, so it
     * goes in then too; plain still lifes leave it out so no hand is invited.
     */
    const hands = scene.hands || brief ? `\n\n${HANDS_NOTE}` : "";
    return {
      id: `look${index + 1}`,
      label: brief ? `Look ${index + 1}` : scene.label,
      prompt: `TASK — A REAL PHOTOGRAPH OF A CHARM NECKLACE: ALL THE CHARMS ON ONE CHAIN

${necklaceBlock(sourceImages.length, metal)}

${sceneBlock({
  brief,
  scene,
  composition: compositions[index % compositions.length],
  light: lights[index % lights.length],
  index,
  total: count,
})}

${PHOTO_BLOCK}${hands}

${NO_TEXT}

Image orientation: ${ASPECT_TEXT[aspect]}.`,
      images: sourceImages,
    };
  });
}

function buildCharmStoryRefinePrompt({ instruction, referenceCount = 0 }) {
  return (
    `Apply this change to this jewellery photograph (the first image): ${instruction}.` +
    buildReferenceNote(referenceCount) +
    " Keep every charm exactly as it is — same design, stones, metal and proportions — on the one chain, bunched together as they are. Keep it looking like a real, natural photograph, not AI-generated; any hand keeps real, natural nails — short to medium, real texture, never long, glossy or plastic-looking. Add no text. Only apply the requested change."
  );
}

module.exports = {
  CHARM_METAL_IDS: Object.keys(CHARM_METALS),
  CHARM_ASPECT_RATIOS,
  buildCharmStoryShots,
  buildCharmStoryRefinePrompt,
};
