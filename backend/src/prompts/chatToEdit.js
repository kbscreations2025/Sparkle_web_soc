/**
 * Chat to Edit has no single big prompt the way Image Cleaning does — every
 * turn is instruction-driven, so the prompt is assembled per request rather
 * than sent as-is. These are the fixed parts of that assembly: two safety
 * notes appended to every edit, kept here (not typed inline in the route) so
 * they're easy to find and adjust without hunting through request-handling
 * code.
 */
const { buildReferenceNote } = require("./shared");

const SCALE_NOTE =
  "SCALE: if the image contains jewelry, keep it rendered at true-to-life scale — small and " +
  "delicate, never oversized, chunky, or exaggerated, in correct proportion to the hand, ear, or " +
  "neck it sits on.";

const ANATOMY_NOTE =
  "ANATOMY: if the image contains a person, they must have exactly ONE head, exactly TWO arms, " +
  "and exactly TWO hands with exactly FIVE fingers each — never more, never fewer, no fused, " +
  "duplicated, or floating limbs. Keep every visible body part complete, correct, and naturally " +
  "proportioned.";

/**
 * Each edit runs on the previous result, so any small colour drift compounds
 * turn after turn — in practice a warm, reddish/pink cast creeping into the
 * metal, the white background and skin. Spelled out on every edit; a request
 * that does change a colour ("in rose gold") still wins for that one thing.
 */
const COLOR_NOTE =
  "COLOUR: keep every colour exactly as it is in the first image — the same white balance, colour " +
  "temperature, exposure and saturation; the metal's exact tone (yellow gold stays the same yellow, " +
  "white metal stays neutral); the stones' colours; a white background pure neutral white; skin tones " +
  "unchanged. Do NOT add any warm, red, pink, magenta or orange tint or colour cast anywhere. Only " +
  "change a colour if the instruction explicitly asks for it.";

/**
 * Builds one turn's prompt. `instruction` is whatever the user typed (already
 * carrying any annotation-guidance prefix the client adds); `referenceCount`
 * is how many reference images ride along after the base image, purely as
 * visual inspiration — never to be copied into the result wholesale.
 */
function buildChatEditPrompt(instruction, referenceCount = 0) {
  const referenceNote = buildReferenceNote(referenceCount);

  return (
    `Edit this photograph (the first image) exactly as instructed: ${instruction}.${referenceNote} ` +
    "Keep the same photorealistic quality, composition, and everything not specifically mentioned " +
    `unchanged. Only apply the requested change. ${COLOR_NOTE} ${SCALE_NOTE} ${ANATOMY_NOTE}`
  );
}

// ── Attachments with a job ──────────────────────────────────────────────────

/**
 * What each attached image is FOR. Without a role every attachment was read as
 * "inspiration only — never copy its subject", which is the opposite of what
 * a person means by "set this pear diamond in the ring" or "use this texture":
 * there the reference IS the thing to copy.
 *
 * - `piece`: a product photo of jewellery to put into image 1 — replacing the
 *   piece already there, or worn where it belongs if there is none.
 * - `stone`: a gemstone to set into the jewellery, any shape, fancy cuts included.
 * - `texture`: a surface finish or pattern for the metal.
 * - `scene`: a photo of a hand, model or person who should wear the piece
 *   in image 1. The result is THIS photo, with the piece added.
 * - `marks`: image 1 drawn on — shows where, never drawn into the result.
 * - `inspiration`: an idea to borrow, as every attachment used to be.
 * - `auto`: decided from the message (see `resolveReferenceRoles`).
 */
const REFERENCE_ROLES = ["auto", "piece", "stone", "texture", "scene", "marks", "inspiration"];

/** "on the hand", "wear it", "try on": the message is about a person wearing the piece. */
const WEAR_RE =
  /\b(?:try[\s-]?on|wear|wears|wearing|worn)\b|\b(?:on|onto)\s+(?:the\s+|a\s+|an\s+|my\s+|this\s+|her\s+|his\s+|their\s+)?(?:hands?|fingers?|models?|neck|ears?|wrists?|person|girl|woman|man|lady|bride|ankle)\b/i;
const TEXTURE_RE =
  /\b(?:texture[sd]?|pattern(?:ed)?|finish|hammered|brushed|satin|matte?|florentine|sand[\s-]?blast\w*|engrav\w*|milgrain|filigree|enamel\w*|surface)\b/i;
const STONE_RE =
  /\b(?:stones?|diamonds?|gem(?:stone)?s?|solitaires?|cent(?:er|re)\s+stone|rub(?:y|ies)|emeralds?|sapphires?|moissanites?|pear|marquise|oval|cushion|princess|radiant|asscher|heart[\s-]shaped|trillion|baguette|kite|hexagon\w*|fancy[\s-]?(?:cut|shape)\w*|carat|ct)\b/i;
const PIECE_RE =
  /\b(?:replace|swap|switch|instead|exchange)\b|\bthis\s+(?:ring|necklace|pendant|earrings?|bracelet|bangle|piece|design|jewell?e?ry)\b/i;

/**
 * Turns the roles the page sent (one per reference, possibly missing or
 * "auto") into concrete ones. `auto` is read from the message once and
 * applies to every unassigned attachment — a single message rarely means two
 * different things by its unlabelled images.
 *
 * "wear" is its own answer for `auto`: the message says someone should wear
 * the piece, but nothing says which picture is the person and which the piece,
 * so the prompt lets the model tell them apart rather than guessing here.
 */
function resolveReferenceRoles(roles, count, instruction) {
  const text = String(instruction || "");
  const inferred = WEAR_RE.test(text)
    ? "wear"
    : TEXTURE_RE.test(text)
      ? "texture"
      : STONE_RE.test(text)
        ? "stone"
        : PIECE_RE.test(text)
          ? "piece"
          : "inspiration";

  return Array.from({ length: count }, (_, index) => {
    const role = Array.isArray(roles) ? roles[index] : null;
    return REFERENCE_ROLES.includes(role) && role !== "auto" ? role : inferred;
  });
}

/** True when any attachment has a job beyond inspiration — those turns get the role prompt. */
function hasRoleTask(roles) {
  return roles.some((role) => role !== "inspiration" && role !== "marks");
}

/** "image 2", "images 2 and 3", "images 2–4". */
function imageList(numbers) {
  if (numbers.length === 1) return `image ${numbers[0]}`;
  if (numbers.length === 2) return `images ${numbers[0]} and ${numbers[1]}`;
  return `images ${numbers[0]}–${numbers[numbers.length - 1]}`;
}

/** The images that make up one role, as "Image 3 is…" or "Images 3 and 4 are…" — always opening a sentence. */
function describe(numbers, single, several) {
  const list = imageList(numbers);
  return `${list[0].toUpperCase()}${list.slice(1)} ${numbers.length > 1 ? several : single}`;
}

/**
 * COLOR_NOTE for a turn that brings something new in. Its rule "the metal's
 * exact tone stays" is right for an edit and wrong here: a white-gold piece
 * or a pink sapphire arriving in a yellow-gold photo would be pulled towards
 * what it replaces. The photo keeps its colours; what is new keeps its own.
 */
const ROLE_COLOR_NOTE =
  "COLOUR: keep the photo's own colours exactly — the same white balance, colour temperature, exposure and saturation; skin tones and a white background unchanged. Do NOT add any warm, red, pink, magenta or orange tint or colour cast anywhere. Anything new keeps its OWN colours exactly as in its reference — the new piece's metal and stones, the new stone's colour — never shifted towards what it replaces or towards the photo's light. Everything else keeps the colour it has now unless the request asks otherwise.";

const REAL_SIZE =
  "REAL SIZE: real jewellery is small. An adult finger is about 17 mm across, an earlobe about 18 mm tall, a wrist about 55 mm across seen from above. A ring band is 1.5–4 mm wide; a 1 ct round diamond is about 6.5 mm across — two-fifths of a finger's width. Draw the piece at its true size against what it sits on — never at the size it fills its own product photo, where any piece fills the frame however small it really is.";

const PIECE_FIDELITY =
  "Reproduce it exactly: the same design and silhouette, the same stone shapes, colours and count, the same setting and prongs, the same metal colour and finish. Do not simplify, add to or redesign it, and carry nothing over from any piece it replaces.";

function keepThePhoto(which) {
  return `EVERYTHING ELSE STAYS EXACTLY AS IT IS in ${which}: the same framing and crop, the same angle and perspective, the same pose, hands, skin and nails, the same background, props and lighting, the same white balance, exposure and colours. Do not warm, cool, tint, brighten, smooth or retouch anything the request does not mention. Apart from what the request changes, the output must line up with ${which} pixel for pixel.`;
}

const UNDERNEATH =
  "WHERE AN OLD PIECE OR STONE WAS: wherever something removed covered an area the new one does not, show what was underneath — the same skin, metal or background as right beside it, with the same texture and lighting. No outline, ghost, gap or shadow of what was removed may remain.";

const FIT =
  "FIT AND LIGHT: worn or set naturally — a ring's band wraps the finger with its far side hidden behind it, earrings sit in the piercing, a chain follows the neck and a pendant hangs under its own weight, a bracelet follows the wrist's curve. Add a soft contact shadow where it touches skin, and light it with the photo's own light so it reflects the same surroundings.";

/**
 * The prompt for a turn whose attachments have jobs to do.
 *
 * `references` is the resolved roles, in the order the images are sent after
 * the base image — except a `scene`, which goes first (see `orderImages`):
 * a model keeps the framing of image 1 far better than of any later one, and
 * in a try-on the person's photo is the one whose framing must survive.
 */
function buildRolePrompt({ instruction, roles }) {
  const { order } = orderImages(roles);
  // Position of each image in what the model receives, 1-based.
  const numbersFor = (role) => order.flatMap((slot, index) => (slot.role === role ? [index + 1] : []));

  const scene = numbersFor("scene");
  const base = order.findIndex((slot) => slot.role === "base") + 1;
  const pieces = numbersFor("piece");
  const stones = numbersFor("stone");
  const textures = numbersFor("texture");
  const marks = numbersFor("marks");
  const ideas = numbersFor("inspiration");
  const wear = numbersFor("wear");

  // In a try-on the jewellery lives in the base image and the scene is image 1;
  // everywhere else the jewellery being changed is image 1 itself.
  const target = scene.length ? `the piece from image ${base}, once it is worn` : "the jewellery in image 1";
  const kept = scene.length ? "image 1 (the scene)" : "image 1";

  const lines = [];

  // ── What each image is.
  if (scene.length) {
    lines.push(
      `Image 1 is a photograph of a person — a hand, a model or part of one: the SCENE. Image ${base} is the JEWELLERY to put on them. ${PIECE_FIDELITY}`
    );
  } else if (wear.length) {
    const all = [1, ...wear];
    lines.push(
      `Among ${imageList(all)}, one is a photograph of a person — a hand, a model or part of one — and the other shows a piece of jewellery. Work out which is which. The result is the PERSON's photograph with them wearing that piece. ${PIECE_FIDELITY}`
    );
  } else {
    lines.push("Image 1 is the photograph being edited.");
  }
  if (pieces.length) lines.push(`${describe(pieces, "is a product photo of the NEW PIECE", "show the NEW PIECE (views of one piece)")}. ${PIECE_FIDELITY}`);
  if (stones.length) lines.push(`${describe(stones, "shows the NEW STONE", "show the NEW STONE (views of one stone)")}.`);
  if (textures.length) lines.push(`${describe(textures, "is a TEXTURE / FINISH reference", "are TEXTURE / FINISH references")}.`);
  if (marks.length) {
    lines.push(
      `${describe(marks, `is a marked-up copy of image ${base}`, `are marked-up copies of image ${base}`)}: the drawn lines, circles and arrows only show WHERE and WHAT to change. Apply the change there, and never draw the marks themselves into the result.`
    );
  }
  if (ideas.length) {
    lines.push(
      `${describe(ideas, "is", "are")} inspiration only — borrow the idea the request refers to, never ${ideas.length > 1 ? "their" : "its"} subject, composition or background.`
    );
  }

  lines.push(`THE REQUEST: "${instruction}". Where it is specific, it wins — but change nothing it does not ask for.`);

  // ── What to do.
  if (scene.length || wear.length) {
    lines.push(
      `TASK: show the person wearing the piece where that kind of jewellery is worn — a ring on a finger, earrings in the ears, a necklace or pendant around the neck, a bracelet or bangle on the wrist — or exactly where the request or marks say. If they already wear a piece in that spot, take it off first. The result is the person's photograph, as it was taken, with the piece added.`,
      REAL_SIZE,
      FIT
    );
  }
  if (pieces.length) {
    lines.push(
      `TASK: put the new piece into ${kept}. If ${kept} already shows a piece of that kind where it goes, take that one out and put the new one in exactly the same place, at the same position, angle and perspective, as if the photo had been taken with the new piece instead. If it shows several pieces, replace only the one the request or marks point to. If there is none, put the new piece where it naturally belongs.`,
      REAL_SIZE,
      FIT
    );
  }
  if (stones.length) {
    lines.push(
      `TASK: set the new stone into ${target}, replacing the stone(s) the request or marks point to — the centre stone when it doesn't say. If there is no stone in that place, add a setting for it there that suits the design.`,
      "THE STONE: copy it exactly — its outline shape (round, oval, pear, marquise, emerald cut, cushion, radiant, princess, asscher, heart, trillion, kite, hexagon or any other fancy shape), its length-to-width proportions, its facet pattern and sparkle, its colour and clarity. Never round it off into a standard round brilliant, and never change its shape to fit the old setting.",
      "THE SETTING: rebuild only the setting around it so it holds this exact shape the way a jeweller would — prongs at its points and along its sides (a V-prong guarding each point of a pear, marquise, heart, trillion or kite), or a bezel that follows its outline — with the head and gallery reshaped to its outline. The stone sits level and centred where the old one was, oriented the way the request says, or along the length of the piece when it doesn't.",
      "ITS SIZE: about the same face-up size as the stone it replaces, unless the request gives a size or carat weight. Keep the band, metal, every other stone and the piece's proportions exactly as they are."
    );
  }
  if (textures.length) {
    /*
     * The reference says what KIND of texture; the message says how it is laid
     * out. Without that split the model copied the reference's layout too — a
     * swatch with horizontal lines gave horizontal lines however plainly the
     * person asked for vertical ones — so "vertical", "finer", "only the top"
     * were ignored. Directions are pinned to the frame and to the band, since
     * "vertical" on a ring is otherwise anyone's guess.
     */
    lines.push(
      `TASK: give the metal of ${target} the texture shown in the texture reference, on the parts the request names, or on all visible metal when it doesn't.`,
      "FROM THE REFERENCE take only its CHARACTER — what kind of texture it is (hammered, brushed, satin, florentine, engraved, milgrain, enamel, sand-blasted, diamond-cut or whatever it shows), its relief and its lustre.",
      "FROM THE REQUEST take how it is LAID OUT, and the request always wins over how the reference happens to be arranged: its direction (vertical, horizontal, diagonal, criss-cross, radial, wavy, following the curve), its spacing and density (fine, wide, tight, sparse), its depth and the size of its marks, and where it goes (the whole piece, only the top, the shoulders, the outer face, alternating sections, inside a polished border). Read directions as the piece is seen in image 1: vertical runs from the top of the frame to the bottom, horizontal from side to side; on a ring band, 'across the band' runs from one edge of the band to the other and 'along the band' follows it around the finger. Where the request says nothing about layout, keep the reference's own.",
      "Apply it as a real jeweller's finish: it follows the curvature and perspective of every surface, catches the photo's own light, and is at a scale that suits a piece of jewellery — fine detail, never oversized. Keep the piece's shape, outline, proportions and every stone exactly as they are, and keep the metal's colour unless the request asks for the reference's colour. Take nothing else from the reference — not its subject, shape or background."
    );
  }
  const tasks = [pieces, stones, textures].filter((list) => list.length).length + (scene.length || wear.length ? 1 : 0);
  if (tasks > 1) lines.push("Apply ALL of the tasks above together, in one image.");

  lines.push(UNDERNEATH, scene.length || !wear.length ? keepThePhoto(kept) : keepThePhoto("the person's photograph"), ROLE_COLOR_NOTE, ANATOMY_NOTE);
  return lines.join("\n\n");
}

/**
 * The order images go to the model in, and which one the result's colour is
 * checked against. A scene leads, the jewellery being worn follows it; any
 * other turn keeps the base image first.
 */
function orderImages(roles) {
  const slots = roles.map((role, index) => ({ role, ref: index }));
  const scene = slots.filter((slot) => slot.role === "scene");
  const rest = slots.filter((slot) => slot.role !== "scene");
  const order = [...scene, { role: "base", ref: null }, ...rest];
  return { order, colourAnchor: scene.length ? { ref: scene[0].ref } : { ref: null } };
}

/** The chat's label for a turn with role attachments, e.g. "New stone · Texture". */
function describeRoles(roles) {
  const labels = {
    piece: "Piece replaced",
    stone: "New stone set",
    texture: "Texture applied",
    scene: "Worn on model",
    wear: "Worn on model",
  };
  return [...new Set(roles.map((role) => labels[role]).filter(Boolean))].join(" · ") || null;
}

module.exports = {
  SCALE_NOTE,
  ANATOMY_NOTE,
  COLOR_NOTE,
  REFERENCE_ROLES,
  buildChatEditPrompt,
  resolveReferenceRoles,
  hasRoleTask,
  buildRolePrompt,
  orderImages,
  describeRoles,
};
