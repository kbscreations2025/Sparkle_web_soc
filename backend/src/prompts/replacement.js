/**
 * Replacement — the jewellery in a real photo swapped for another piece, with
 * the rest of the photo left exactly as it was taken.
 *
 * The model is told to change only the piece, but it redraws the whole frame
 * anyway, and its redraw drifts: skin and pale backdrops come back pinker. So
 * these words only have to get the piece right — everything around it is put
 * back from the photo's own pixels afterwards (services/photoComposite.js).
 *
 * Size is what the model gets wrong when left to itself. A product shot fills
 * its frame however small the piece really is, and the piece being removed
 * suggests a size of its own. So the size comes from what the person says,
 * and is turned into proportions of the body it is worn on — the one ruler
 * the model can actually see in the photo.
 */
const { ANATOMY_NOTE } = require("./chatToEdit");

const CATEGORIES = {
  ring: {
    piece: "ring",
    named: "a ring",
    label: "ring",
    worn: "on the finger",
    body: "finger",
    fit: "the band wraps around the finger with its far side hidden behind it",
    scale:
      "An adult finger is about 17 mm across — use it as the ruler. A 1.5 mm band is under a tenth of the finger's width and a 3 mm band under a fifth. A round stone of 0.25 ct is about 4 mm across (a quarter of the finger), 0.5 ct about 5 mm (under a third), 1 ct about 6.5 mm (two-fifths), 2 ct about 8 mm (half) and 3 ct about 9.3 mm (over half).",
  },
  earrings: {
    piece: "earring",
    named: "an earring",
    label: "earrings",
    worn: "on the ear",
    body: "earlobe",
    fit: "it sits in the piercing and hangs or rests the way its design does",
    scale:
      "An adult earlobe is about 18 mm tall — use it as the ruler. A 4 mm stud covers under a quarter of the lobe's height, a 6 mm stud about a third and a 10 mm stud over half; a 25 mm drop hangs well below the lobe.",
  },
  necklace: {
    piece: "necklace",
    named: "a necklace",
    label: "necklace",
    worn: "around the neck",
    body: "neck",
    fit: "the chain follows the neck and lies on the skin, and any pendant hangs straight under its own weight",
    scale:
      "The base of an adult neck is about 11 cm across and the collarbones span about 30 cm — use them as the ruler. A 10 mm pendant is about the size of a fingertip, a 20 mm pendant a little larger than a thumbnail, and a 1 mm chain is a fine line.",
  },
  bracelet: {
    piece: "bracelet",
    named: "a bracelet",
    label: "bracelet",
    worn: "on the wrist",
    body: "wrist",
    fit: "it wraps around the wrist following its curve, with its far side hidden behind it",
    scale:
      "An adult wrist is about 55 mm across seen from above — use it as the ruler. A 2 mm tennis bracelet is a fine line about a twenty-fifth of the wrist's width, a 6 mm bangle about a ninth and a 20 mm cuff over a third.",
  },
};

const CATEGORY_IDS = Object.keys(CATEGORIES);

/** The size presets — for a person who would rather pick than type millimetres. */
const SIZES = {
  delicate: (body) =>
    `It is a DELICATE piece: fine, slim metal and small stones — dainty and understated on the ${body}, clearly smaller than a statement piece.`,
  classic: () => "It is an EVERYDAY size: a classic, moderate piece — neither dainty nor oversized.",
  statement: (body) => `It is a STATEMENT piece: bold and substantial, with large stones and generous metal that stand out on the ${body}.`,
};

const SIZE_IDS = Object.keys(SIZES);

/**
 * Everything the model is told about size. The description wins over a preset
 * when both are given, because it is the more specific of the two.
 */
function sizeBlock(kind, { size, description }) {
  const preset = SIZES[size]?.(kind.body);
  const cue = description
    ? `Follow the size in the description exactly — if it says small, fine, thin or delicate, the piece must look small, fine and thin on the ${kind.body}.${preset ? ` ${preset}` : ""}`
    : preset || "Draw it true to life: a delicate piece stays delicate, and nothing is oversized or chunky.";
  return [
    `SIZE: ${cue}`,
    `Take the size from ${description ? "the description" : preset ? "this" : "what a real piece like it measures"} — never from the piece being removed, and never from the product photo, where any piece fills the frame however small it really is. The new piece may be much smaller or much larger than the old one; draw it at its own true size.`,
    kind.scale,
  ].join(" ");
}

const KEEP_THE_PHOTO = (kind) =>
  `EVERYTHING ELSE STAYS EXACTLY AS IT IS: the same framing and crop, the same pose, the same ${kind.body}, skin and nails, the same background and lighting, the same white balance, exposure and colours. Do not warm, cool, tint, brighten, smooth or retouch anything. Apart from the jewellery, the output must line up with image 1 pixel for pixel.`;

const UNDERNEATH = (kind) =>
  `WHERE THE OLD PIECE WAS: wherever the old ${kind.piece} covered something the new one does not, show what was underneath — the same skin tone, texture, creases and lighting as the skin right beside it, and the same background where it showed background. No outline, ghost, gap, dent or shadow of the old piece may remain.`;

/**
 * The first turn: take the worn piece off, put the new one on.
 *
 * Image 1 is always the photo. Image 2 is the new piece's product shot when
 * there is one; without it, the description alone says what the piece is.
 * `change` is an instruction typed in the chat on the original photo, which
 * redoes the swap with it.
 */
function buildReplacePrompt({ category = "ring", size, description, hasPiece, change }) {
  const kind = CATEGORIES[category] ?? CATEGORIES.ring;
  return [
    `Image 1 is a real photograph of ${kind.named} being worn ${kind.worn}.${hasPiece ? ` Image 2 is a product photo of a different ${kind.piece}: the NEW piece.` : ""}`,
    `TASK: take off the ${kind.piece} that is being worn in image 1 and put the new piece on in exactly the same place — the same ${kind.body}, the same position and perspective — as if the photo had been taken with the new piece on instead.`,
    hasPiece
      ? "THE NEW PIECE is the one in image 2. Reproduce it exactly: the same design, stone shapes, stone colours and stone count, the same setting and prongs, the same metal colour and finish. Do not simplify, add to or redesign it, and do not carry anything over from the piece being removed."
      : `THE NEW PIECE: ${description}. Draw it exactly as described; where the description is silent, keep it simple and elegant rather than inventing extra detail. Do not carry anything over from the piece being removed.`,
    hasPiece && description ? `The person describes the new piece as: "${description}". Treat this as the truth about it — above all about its size.` : "",
    sizeBlock(kind, { size, description }),
    UNDERNEATH(kind),
    `FIT: worn naturally — ${kind.fit}, with a soft contact shadow where it touches the skin, lit by the same light as the rest of the photo and reflecting the same surroundings.`,
    change ? `ALSO: ${change}` : "",
    KEEP_THE_PHOTO(kind),
    ANATOMY_NOTE,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * A follow-up on a result: image 1 is the photo with the new piece already on,
 * then the product shot (if any), then whatever the person attached in the chat.
 */
function buildChangePrompt({ category = "ring", description, hasPiece, change, referenceCount = 0 }) {
  const kind = CATEGORIES[category] ?? CATEGORIES.ring;
  const firstReference = hasPiece ? 3 : 2;
  return [
    `Image 1 is a real photograph of ${kind.named} being worn ${kind.worn}.${hasPiece ? ` Image 2 is the product photo of that ${kind.piece} — the truth about its design.` : ""}`,
    `CHANGE: ${change}`,
    `Change only the ${kind.piece}, and only as asked. Keep its design faithful to ${hasPiece ? "image 2" : description ? `this description: "${description}"` : "how it looks in image 1"} except where the change says otherwise, and keep its size as it is unless the change is about size. ${kind.scale}`,
    `If the change makes the piece smaller or moves it, show what was underneath exactly as it looks right beside it — no outline or shadow of where it was.`,
    referenceCount
      ? `${referenceCount > 1 ? `Images ${firstReference}–${firstReference + referenceCount - 1} are references` : `Image ${firstReference} is a reference`} for the change only — borrow the idea, never their subject, composition or background.`
      : "",
    KEEP_THE_PHOTO(kind),
    ANATOMY_NOTE,
  ]
    .filter(Boolean)
    .join("\n\n");
}

module.exports = { CATEGORIES, CATEGORY_IDS, SIZE_IDS, buildReplacePrompt, buildChangePrompt };
