/**
 * Lifestyle: a piece of jewellery photographed on a model.
 *
 * Three prompts, because the tool does three things — place one piece,
 * place a whole set, and edit a shot it already produced — plus the one that
 * builds the model herself, before any jewellery exists.
 */

/**
 * The most common failure mode in AI model shots is malformed anatomy — AI
 * renders routinely duplicate or drop a hand/arm, or add extra fingers.
 * Every prompt that renders a model repeats this note.
 */
const ANATOMY_NOTE = `ANATOMY — CRITICAL, DO NOT SKIP: The model is a single ordinary human being with exactly ONE head, exactly TWO arms, and exactly TWO hands — never more, never fewer. Each hand has exactly FIVE fingers, no extra or duplicated fingers, hands, or arms anywhere in the frame, and no fused or floating limbs. Every visible hand, arm, and finger must be anatomically correct, complete, and naturally proportioned for the pose. Before finalizing, count the arms and hands in the image and confirm there are exactly two of each — this is an elegant, aesthetic jewelry brand image and must look flawless, never uncanny or anatomically broken.`;

/**
 * Without an explicit push against them, these are the tells that make a shot read as
 * AI-generated rather than photographed: waxy over-smoothed skin, oversaturated HDR glow,
 * unnaturally perfect symmetry. Repeated on every prompt that renders a model, same as
 * ANATOMY_NOTE above.
 */
const REALISM_NOTE = `REALISM — CRITICAL: This must read as an authentic photograph captured on a real DSLR/mirrorless camera with a fast prime lens, never as a CGI render or an AI-generated image. Skin must show natural, believable texture — visible pores, fine hairs, subtle natural asymmetry and imperfections — never smoothed to a plastic, waxy, or airbrushed finish. Avoid oversaturated colors, artificial HDR glow, or an unnaturally perfect "beauty filter" sheen. Light must behave physically: soft natural falloff, believable shadows, realistic specular highlights on skin and metal. The final image should be indistinguishable from a professionally shot, unedited lifestyle or editorial photograph.`;

/** Used only when the client sends no explicit shot type — see `shotType` below. */
const DEFAULT_SHOT_TYPE = "close-up portrait";
const DEFAULT_SET_SHOT_TYPE = "three-quarter editorial shot, framed to keep every piece in the set clearly visible";
/**
 * Used only if the client sends no scene at all — in normal use the client
 * always resolves one of its theme options (including "Surprise Me") first.
 */
const DEFAULT_SCENE =
  "A softly diffused, elegant neutral setting with warm ambient light that flatters the jewelry without overpowering it — never a flat white or black backdrop.";

function placementToJewelryType(placement) {
  const p = (placement || "").toLowerCase();
  // Ears before rings: "earring" contains "ring", so testing the other way
  // round classified every earring placement as a ring — and prompted for
  // one, bare fingers and all.
  if (p.includes("ear")) return "earrings";
  if (p.includes("ring")) return "ring";
  if (p.includes("neck")) return "necklace";
  if (p.includes("wrist") || p.includes("bangle")) return "bracelet";
  if (p.includes("nose")) return "nose pin";
  if (p.includes("maang") || p.includes("tikka")) return "maang tikka";
  return "jewelry piece";
}

const ALL_FINGERS = ["thumb", "index finger", "middle finger", "ring finger", "pinky finger"];

/** Which finger a placement phrase names, so every other one can be banned by name. */
function targetFingerFor(placement, fallback = "specified finger") {
  const p = (placement || "").toLowerCase();
  if (p.includes("middle")) return "middle finger";
  if (p.includes("index")) return "index finger";
  if (p.includes("pinky")) return "pinky finger";
  if (p.includes("thumb")) return "thumb";
  if (p.includes("ring")) return "ring finger";
  return fallback;
}

/** The per-type placement rules — what "worn correctly" means for this kind of piece. */
function jewelrySpecificRules(jewelryType, placement) {
  if (jewelryType === "ring") {
    const targetFinger = targetFingerFor(placement);
    const bareFingers = ALL_FINGERS.filter((finger) => finger !== targetFinger).join(", ");
    const neighbours = targetFinger.includes("middle")
      ? "ring finger (fourth finger) and index finger on either side"
      : "adjacent fingers on either side";

    return `
RING PLACEMENT — CRITICAL:
- The ring goes on the ${targetFinger} ONLY. This is the single allowed finger.
- BARE FINGERS — STRICTLY ENFORCED: The following fingers must have ZERO rings, completely bare skin with no jewelry: ${bareFingers}. No exceptions.
- The ${neighbours} must be 100% bare — if you see yourself about to place anything on them, do not.
- SCALE: The ring outer diameter ≈ 0.8× the width of the ${targetFinger}. Think real-life ring proportions — it is a small band that barely extends beyond the finger's edges.
- The ring band height must be no more than 1/10th of the finger's total length — a thin delicate band, not a wide cuff.
- The ring band encircles the finger's full circumference in 3D — physically worn at the base knuckle, not floating or overlaid flat.
- One ring. One finger. Nothing else.`;
  }

  if (jewelryType === "earrings") {
    return `
EARRING PLACEMENT — CRITICAL:
- Place earrings ONLY at the piercing point specified (lobe or helix/cartilage), NOT floating.
- Drop/dangle earrings hang freely below the lobe or attachment point — they should swing naturally.
- Size earrings proportionally to the ear — a statement earring should read clearly without being oversized.
- If both ears, both earrings must be perfectly mirrored: identical size, height, and angle.`;
  }

  if (jewelryType === "bracelet") {
    return `
BRACELET PLACEMENT — CRITICAL:
- The bracelet must encircle the full wrist circumference, not sit on top of the wrist.
- Size it proportionally to the wrist — it should look naturally worn, not loose or floating.
- The bracelet should appear solid and three-dimensional, following the wrist's curve.`;
  }

  if (jewelryType === "necklace") {
    return `
NECKLACE PLACEMENT — CRITICAL:
- The chain must follow the natural curve of the neck/collarbone — not floating away from the skin.
- The pendant should hang centered at the correct length position as specified.
- Show the full chain drape; avoid cutting it off at the frame edges.`;
  }

  /*
   * No type named, because the browser left it to the photograph — the
   * picker only asks which finger or which wrist, the two things a photo
   * cannot say. So the rules for every other kind are all sent, and the
   * model applies the one matching what it sees.
   */
  return `
PLACEMENT BY KIND — read the reference, then follow the matching rule:
- Necklace: the chain follows the curve of the neck and collarbone against the skin, never floating; show the full drape rather than cropping it at the frame edge.
- Earrings: at the earlobe piercing, not floating; a drop hangs freely below it; a pair is mirrored on both ears at identical size, height and angle.
- Nose pin: a small stud or ring at the nostril piercing point, scaled to the nose.
- Anklet: encircling the full ankle, resting on the bone.
- Whatever the kind: the piece appears on that one body location only. Every other part of the model is bare — no jewellery invented anywhere else in the frame.`;
}

/**
 * One piece, worn by the model.
 *
 * @param shotType Literal framing phrase chosen client-side (e.g. "extreme macro close-up
 *   portrait") — sent per the selected pose. Falls back to DEFAULT_SHOT_TYPE only for the
 *   "No specific pose" option, which deliberately leaves framing up to the model.
 * @param sceneInstruction Literal background + lighting description chosen client-side from
 *   the Scene/Theme step (or resolved from "Surprise Me" before the request was sent).
 */
function buildLifestylePrompt({ placement, poseInstruction, description, shotType, sceneInstruction }) {
  const jewelryType = placementToJewelryType(placement);

  return `Photorealistic image editing. Place the ${jewelryType} from the reference jewelry image onto the female model.

JEWELRY FIDELITY — NON-NEGOTIABLE:
- Every structural detail of the jewelry MUST match the reference exactly: shape, stone settings, filigree, chain links, clasps, color, and proportions.
- Stone count is exact — count every stone in the reference and render that exact same number, in the same positions. Do NOT add, remove, merge, or omit a single stone.
- Do NOT simplify, alter, or hallucinate any part of the jewelry design.
- Gold color, diamond brilliance, gemstone colors, and cut/shape of every stone — must be identical to the reference.
- The jewelry is the hero of this image. A jeweller inspecting the output must be able to confirm every stone, setting, and metal detail matches the reference piece exactly.
${jewelrySpecificRules(jewelryType, placement)}
${ANATOMY_NOTE}
${REALISM_NOTE}
PHOTOGRAPHY:
- Shot type: ${shotType || DEFAULT_SHOT_TYPE} with 85mm f/1.4 lens.
- Scene: ${sceneInstruction || DEFAULT_SCENE}
- Color harmony: the background tones and light's color temperature must complement the jewelry's metal color and gemstone hues, so the piece reads as naturally photographed in this environment — never composited or pasted on top of it.
- Do NOT change the model's face, ethnicity, body proportions, or identity.

PLACEMENT INSTRUCTION: ${placement}
${poseInstruction ? `POSE: ${poseInstruction}` : ""}
${description?.trim() ? `ADDITIONAL NOTES: ${description}` : ""}`;
}

/**
 * A whole set at once — the model wears every uploaded piece, each on its
 * natural body location. Used when more than one jewellery image is sent.
 *
 * Falls back to DEFAULT_SET_SHOT_TYPE rather than DEFAULT_SHOT_TYPE when no
 * pose is chosen: a tight macro crop can't show a ring, necklace and earrings
 * at once. An explicitly chosen pose still overrides it.
 */
function buildLifestyleSetPrompt({ count, placement, poseInstruction, description, shotType, sceneInstruction }) {
  const ringFinger = targetFingerFor(placement, "ring finger");

  return `Photorealistic image editing. The model is shown in the FIRST image. The following ${count} images are each a SEPARATE piece of jewelry from one matching set. Place EVERY one of these ${count} jewelry pieces onto the same female model in a single photograph — she wears the complete set together.

SET PLACEMENT — place each piece on its correct, natural body location:
- Ring → worn on the ${ringFinger} of one hand; every other finger stays completely bare (no extra rings).
- Necklace / pendant → draped naturally around the neck, following the collarbone.
- Earrings → on the earlobes (both ears, mirrored) unless the piece is clearly a single earring.
- Bracelet / bangle → encircling the wrist, sized to sit naturally.
- Nose pin, maang tikka, anklet, brooch → on its natural, anatomically correct location.
- Match each uploaded piece to the body location that fits its type. Do NOT place two different pieces on the same spot.

JEWELRY FIDELITY — NON-NEGOTIABLE (applies to EVERY piece):
- Every structural detail of each piece MUST match its reference exactly: shape, stone settings, filigree, chain links, clasps, metal color, and proportions.
- Stone count is exact for each piece — count every stone in each reference image and render that exact same number, in the same positions. Do NOT add, remove, merge, or omit a single stone on any piece.
- Do NOT simplify, alter, merge, or hallucinate any part of any piece. Each rendered piece must be individually recognisable as its source image.
- Render each piece at realistic, proportional real-life scale for where it is worn — no oversized or floating jewelry.

STRICT — do NOT add any jewelry that was not provided in these ${count} images. Only the uploaded pieces appear on the model — nothing extra.

${ANATOMY_NOTE}
${REALISM_NOTE}
PHOTOGRAPHY:
- Shot type: ${shotType || DEFAULT_SET_SHOT_TYPE} with 85mm f/1.4 lens.
- Scene: ${sceneInstruction || DEFAULT_SCENE}
- Color harmony: the background tones and light's color temperature must complement the jewelry's metal color and gemstone hues, so the set reads as naturally photographed in this environment — never composited or pasted on top of it.
- Do NOT change the model's face, ethnicity, body proportions, or identity.
${poseInstruction ? `POSE: ${poseInstruction}` : ""}
${description?.trim() ? `ADDITIONAL NOTES: ${description}` : ""}`;
}

/**
 * Editing a shot this tool already produced.
 *
 * `jewelryCount` is what separates this from every other tool's refine
 * prompt: the original jewellery photos are re-attached on each turn and
 * named as the ground truth, so the design is re-checked against the real
 * piece rather than against the last generated image, which may already
 * have drifted. The images arrive in a fixed order — the shot being edited,
 * then the jewellery originals, then any style reference — and the wording
 * here is what tells the model which is which.
 */
function buildLifestyleRefinePrompt({ instruction, referenceCount = 0, data = {} }) {
  const jewelryCount = data.jewelryCount ?? 0;
  // The style references are whatever is left after the jewellery originals.
  const styleCount = Math.max(0, referenceCount - jewelryCount);

  const jewelryNote = jewelryCount
    ? ` The ${jewelryCount > 1 ? `${jewelryCount} images` : "image"} immediately after the first photograph — before any style reference — are the ORIGINAL jewelry reference photo(s), the ground-truth design. Use them ONLY to verify and correct the jewelry: exact stone count, cut, color, metal, filigree, and proportions must match these originals exactly, correcting any drift from the prior edit. Do not use them for anything else about the scene.`
    : "";

  const styleNote = styleCount
    ? ` ${styleCount > 1 ? `${styleCount} additional reference images are` : "A further reference image is"} also attached, purely as visual inspiration for the requested change — apply that idea onto the FIRST image, do NOT copy or blend in the reference(s)' own subject, composition or background.`
    : "";

  return `Modify this lifestyle jewelry photograph (the first image): ${instruction}.${jewelryNote}${styleNote} PRESERVE EXACTLY: the model's identity, face, skin tone, hair, body proportions — do NOT change the model in any way. PRESERVE EXACTLY: the background, environment, lighting setup, and scene composition — do NOT alter the background. PRESERVE EXACTLY: the jewelry structure, design, and placement — matching the original jewelry reference(s) exactly. Only apply the single specifically requested change and nothing else. ${ANATOMY_NOTE}`;
}

/*
 * ── The model herself ───────────────────────────────────────────────────────
 * Each outfit maps to the jewelry zone it's chosen to showcase (necklace,
 * earrings, bracelet…) so the styling instruction stays purposeful — the
 * neckline/shoulders/back are open because that's where jewelry is worn,
 * not as an end in itself.
 */
const OUTFIT_SHOWCASE = {
  "Classic Evening Gown": "a floor-length neckline that keeps the collarbone and throat elegantly open for a statement necklace",
  "Off-Shoulder Gown": "bare shoulders and collarbone, ideal for showcasing a necklace and earrings together",
  "One-Shoulder Gown": "one bare shoulder and an open neckline, elegant for a necklace or a single statement earring look",
  "Halter Neck Dress": "an open back and shoulders with a high halter neckline, striking for a bold necklace or backless jewelry accent",
  "Backless Evening Dress": "a fully open back, elegant for a back-drop necklace or a dramatic full-body jewelry editorial",
  "Strapless Dress": "bare shoulders and collarbone with a clean straight neckline, classic for necklace and bracelet focus",
  "Plunging V-Neck Dress": "a deep V neckline that draws the eye to a long pendant necklace",
  "Boat Neck Blouse": "a wide horizontal neckline that beautifully frames the collarbone for a delicate necklace",
  "Square Neck Top": "a clean square neckline that frames the collarbone and décolletage for a pendant or choker",
  "Cowl Neck Dress": "a soft draped cowl neckline that pools elegantly, framing a layered or pendant necklace",
  "Silk Wrap Top": "a soft draped neckline with bare forearms, elegant for bracelet and ring close-ups",
  "Turtleneck Sweater": "a high covered neckline that keeps the focus entirely on the hands, ears and hair — ideal for ring, earring or hairpiece close-ups",
  "Slip Dress": "delicate thin straps and a low neckline with bare shoulders, ideal for layered necklaces and earrings",
  "Little Black Dress": "a timeless scoop neckline and bare shoulders, versatile for almost any jewelry piece",
  "Tailored Blazer": "a sharp open collar, polished and modern, ideal for a minimal necklace or elegant earrings",
  "Structured Shirt": "a crisp open collar with bare forearms, clean and modern for a minimal pendant, watch or bracelet",
  "Anarkali Suit": "an elegant embellished neckline with graceful bare or bangled arms, ideal for traditional necklace, jhumka and bangle sets",
  "Bridal Ensemble": "a richly embellished neckline, open décolletage and adorned arms, perfect for full traditional bridal jewelry — necklace, maang tikka, jhumkas and bangles",
  "Kanjeevaram Drape": "a traditional silk saree drape with a sleeveless blouse and bare arms, perfect for temple necklaces, jhumkas, maang tikka and bangles",
  "Cape Dress": "a fluid caped silhouette with an open neckline, dramatic and editorial for a statement necklace or earrings",
  "Bodycon Dress": "a sleek fitted silhouette with an open neckline and bare arms, modern for a necklace, bracelet or ring focus",
  "Sheath Dress": "a clean tailored sheath with a simple neckline and bare arms, elegant for a minimal necklace or bracelet",
  Kaftan: "a flowing kaftan with a soft open neckline and draped sleeves, relaxed-luxe for statement earrings or a necklace",
  "Jumpsuit (fitted)": "a sharp fitted jumpsuit with an open neckline and bare arms, modern and confident for a necklace, bracelet or ring",
  "Wrap Dress": "a softly crossed V wrap neckline, flattering for a pendant necklace and bracelet",
  "Peplum Top": "a structured neckline with a defined waist and bare or bangled forearms, elegant for necklace and bracelet pairings",
  "Corset Top": "a structured sweetheart neckline with bare shoulders and collarbone, striking for a statement necklace and earrings",
};

const OUTFIT_FALLBACK = Object.keys(OUTFIT_SHOWCASE);

/**
 * Model photos are always portrait — this is a base plate meant to have
 * jewelry placed on it afterwards, never a landscape/square shot. Randomized
 * between the two allowed ratios for variety.
 */
const MODEL_ASPECTS = ["tall 4:5 portrait aspect ratio", "tall 9:16 vertical aspect ratio"];

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * A clean, jewellery-ready base model from the chosen attributes.
 *
 * Framing keeps face, neckline, ears and both hands visible so a ring,
 * necklace or earring can be placed onto it afterwards, and the model is
 * generated WITHOUT any jewellery so nothing conflicts later.
 *
 * Returns the outfit alongside the prompt because it may have been chosen at
 * random here, and the saved model records what it is actually wearing.
 */
function buildLifestyleModelPrompt(attrs = {}, notes) {
  const gender = (attrs.gender || "Female").toLowerCase();
  const isFemale = gender === "female";

  // Outfit may be a comma-separated multi-select. Picked at random from the
  // user's chosen subset (or the full wardrobe if nothing was picked) so
  // regenerating gives real variety instead of the same default look.
  const chosen = String(attrs.outfit ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const outfit = pickRandom(chosen.length > 0 ? chosen : OUTFIT_FALLBACK);
  const showcase = OUTFIT_SHOWCASE[outfit] ?? "an elegant neckline that keeps the collarbone and shoulders open for jewelry";
  const aspectNote = pickRandom(MODEL_ASPECTS);

  const presence = isFemale
    ? "- She is strikingly elegant and beautiful — refined feminine features, graceful posture, radiant confident poise, the calibre of model featured in a high-end jewelry campaign (Cartier / Tiffany / Bulgari style editorial)."
    : "- He has a distinguished, well-groomed, confident presence, the calibre of model featured in a high-end jewelry campaign.";

  const proportions = isFemale
    ? "- Naturally curvy, well-balanced feminine proportions with an elegant hourglass-leaning silhouette and at least a medium, naturally full bust — never flat-chested — in harmony with the rest of her figure."
    : "- Naturally athletic, well-balanced proportions with a confident, broad-shouldered silhouette.";

  const hands = isFemale
    ? "- Hands are elegant and unmistakably feminine: slender, graceful fingers with smooth skin, neatly manicured natural nails, softly tapered fingertips, relaxed graceful hand positioning — the kind of hand a ring or bracelet should look beautiful on."
    : "- Hands are clean, well-groomed and naturally proportioned, relaxed and confidently posed.";

  const hairDetail = [attrs.hairColor, attrs.hairStyle].filter(Boolean).join(", ");
  const hairFraming = isFemale ? ", swept elegantly away from the ears and neckline so earrings and necklaces stay fully visible" : "";

  const lines = [
    `A photorealistic professional studio photograph of a single ${attrs.age ? `${attrs.age} ` : ""}${gender} fashion model for a luxury jewelry lookbook.`,
    "",
    "PRESENCE:",
    presence,
    "",
    "APPEARANCE:",
    attrs.skinTone ? `- Skin tone: ${attrs.skinTone}.` : "",
    attrs.skinFinish
      ? `- Skin finish: ${attrs.skinFinish} — luminous, healthy, well-hydrated complexion with realistic skin texture and visible pores; never plastic or airbrushed flat.`
      : "- Skin finish: smooth, luminous, healthy complexion with realistic texture — never plastic or airbrushed flat.",
    hairDetail ? `- Hair: ${hairDetail}, glossy and well-styled${hairFraming}.` : `- Hair glossy and well-styled${hairFraming}.`,
    attrs.body
      ? `- Body type / build: ${attrs.body} physique — toned, elegant proportions, natural and in proportion, carried with confidence.`
      : "- Toned, elegant, naturally proportioned physique carried with confidence.",
    attrs.height ? `- Height / stature: ${attrs.height}.` : "",
    proportions,
    "",
    "HANDS (critical — this is where rings and bracelets will be placed):",
    hands,
    "",
    "OUTFIT & STYLING:",
    `- Wearing an elegant ${outfit.toLowerCase()}, tastefully tailored and well-fitted — sophisticated and editorial, never explicit.`,
    `- The silhouette shows ${showcase}.`,
    "",
    ...(notes?.trim() ? ["ADDITIONAL DETAILS — apply exactly, in addition to everything above:", `- ${notes.trim()}`, ""] : []),
    "FRAMING & POSE:",
    `- Image orientation: ${aspectNote}. Do NOT generate a square or landscape image — the frame must be portrait.`,
    "- Elegant three-quarter body shot. The face, neckline/collarbone, both ears and both hands must be clearly visible and unobstructed so jewelry can be placed later.",
    "- Graceful, natural pose with a calm, confident, alluring expression, facing the camera.",
    "",
    "PHOTOGRAPHY:",
    "- Soft, flattering studio lighting; clean seamless light-grey / off-white background.",
    "- High-end editorial quality, ultra sharp focus, true-to-life colours and skin detail — the standard of a premium jewelry brand campaign.",
    "",
    "STRICT — do NOT include any jewelry: no rings, no earrings, no necklace, no bracelet, no watch, no piercings, no accessories. Elegantly and tastefully dressed as described above — sophisticated editorial fashion, never explicit or revealing beyond the described silhouette. No text, no logo, no watermark. Just the model on a plain background.",
  ];

  return { prompt: lines.filter((line) => line !== "").join("\n"), outfit };
}

module.exports = {
  ANATOMY_NOTE,
  REALISM_NOTE,
  buildLifestylePrompt,
  buildLifestyleSetPrompt,
  buildLifestyleRefinePrompt,
  buildLifestyleModelPrompt,
  OUTFIT_SHOWCASE,
};
