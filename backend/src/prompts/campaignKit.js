/**
 * Campaign Kit — Marketing Kit's image half.
 *
 * One run, four shots: two lifestyle (the piece worn by a model) and two
 * studio (the piece alone), each with its own mood. They are four different
 * prompts rather than four variations of one, which is exactly what the
 * shared runner's `buildShots` exists for.
 */

const { ASPECT_TEXT } = require("./textToImage");

/**
 * The single most common failure mode in AI jewelry renders is
 * oversized/chunky jewelry — real pieces are tiny. Every shot repeats this.
 */
const SCALE_NOTE = `SCALE — CRITICAL, THE #1 MISTAKE TO AVOID: Real jewelry is extremely small and delicate. A ring band is only about 1.5–8mm wide; even a large center stone rarely exceeds 8mm across, and most are far smaller. Render the jewelry at this exact true-to-life scale — very, very small and delicate — never oversized, chunky, exaggerated, or looking like a prop or inflated 3D render. If shown worn, it must look genuinely tiny against the hand/ear/neck, in correct proportion to a real finger, earlobe, or collarbone — the way real jewelry actually sits on a real body. Keep every dimension realistically minuscule.`;

/**
 * The second most common failure mode is malformed anatomy. Repeated on
 * every lifestyle shot — the studio shots have no model in them, so sending
 * it there would only dilute the instructions that do apply.
 */
const ANATOMY_NOTE = `ANATOMY — CRITICAL, DO NOT SKIP: The model is a single ordinary human being with exactly ONE head, exactly TWO arms, and exactly TWO hands — never more, never fewer. Each hand has exactly FIVE fingers, no extra or duplicated fingers, hands, or arms anywhere in the frame, and no fused or floating limbs. Every visible hand, arm, and finger must be anatomically correct, complete, and naturally proportioned for the pose. Before finalizing, count the arms and hands in the image and confirm there are exactly two of each — this is a luxury jewelry campaign image and must look flawless and elegant, never uncanny or anatomically broken.`;

/**
 * Jewelry displayed inside a lined box instead of laid on a backdrop.
 * `swatch` is the colour chip the picker renders; only `prompt` is sent.
 */
const BOX_STYLE_OPTIONS = [
  { id: "white-velvet", label: "White Velvet", swatch: "#f2efe9", prompt: "a soft white velvet-lined jewelry box" },
  { id: "cream-velvet", label: "Cream Velvet", swatch: "#e8dcc0", prompt: "a cream velvet-lined jewelry box" },
  { id: "navy-velvet", label: "Navy Blue Velvet", swatch: "#1c2b4a", prompt: "a deep navy blue velvet-lined jewelry box" },
  { id: "black-velvet", label: "Black Velvet", swatch: "#161616", prompt: "a black velvet-lined jewelry box" },
  { id: "charcoal-velvet", label: "Charcoal Velvet", swatch: "#33343a", prompt: "a charcoal grey velvet-lined jewelry box" },
  { id: "burgundy-velvet", label: "Burgundy Velvet", swatch: "#5c1a2b", prompt: "a deep burgundy velvet-lined jewelry box" },
  { id: "emerald-velvet", label: "Emerald Velvet", swatch: "#1f4d3a", prompt: "a rich emerald green velvet-lined jewelry box" },
  { id: "rose-velvet", label: "Rose Pink Velvet", swatch: "#d9a8ab", prompt: "a soft rose pink velvet-lined jewelry box" },
  { id: "champagne-satin", label: "Champagne Satin", swatch: "#e6d3a3", prompt: "a champagne gold satin-lined jewelry box" },
  { id: "gold-velvet", label: "Gold Velvet", swatch: "#a1782e", prompt: "a warm gold velvet-lined jewelry box" },
  { id: "grey-suede", label: "Grey Suede", swatch: "#8a8781", prompt: "a soft grey suede-lined jewelry box" },
  { id: "plum-velvet", label: "Plum Velvet", swatch: "#4a2545", prompt: "a deep plum purple velvet-lined jewelry box" },
];

/**
 * Poses for the two lifestyle shots. "Auto" lets the generator vary them;
 * picking one pins the first shot to it while the second still varies, so a
 * pair never comes back as the same photograph twice.
 */
const POSE_OPTIONS = [
  { id: "auto", label: "Auto (Varied)", prompt: "" },
  { id: "hand-near-face", label: "Hand Near Face", prompt: "one hand raised gently near the jaw or cheek, drawing the eye toward the jewelry" },
  { id: "over-shoulder", label: "Over-the-Shoulder", prompt: "looking back over the shoulder with a relaxed, confident gaze" },
  { id: "profile-gaze", label: "Profile Gaze", prompt: "a clean side profile with the chin slightly lifted, eyes looking off-frame" },
  { id: "collarbone-touch", label: "Collarbone Touch", prompt: "fingertips resting lightly at the collarbone, framing a necklace or pendant" },
  { id: "candid-laugh", label: "Candid Laugh", prompt: "a candid, softly laughing moment with natural movement, not posed" },
  { id: "chin-tilt", label: "Chin Tilt", prompt: "chin tilted down with an intense, direct gaze straight into the camera" },
  { id: "walking-motion", label: "Walking Motion", prompt: "mid-stride walking motion with hair and fabric softly in motion" },
  { id: "hand-in-hair", label: "Hand in Hair", prompt: "one hand running through the hair, elbow raised, elegant and dynamic" },
];

/** Styling for the two studio shots. "None" keeps the piece bare on the backdrop. */
const STUDIO_PROP_OPTIONS = [
  { id: "auto", label: "Auto (Varied)", prompt: "" },
  { id: "none", label: "None — Bare", prompt: "" },
  { id: "pearls", label: "Scattered Pearls", prompt: "a few loose pearls scattered tastefully around the piece, not touching or covering it" },
  { id: "flowers", label: "Fresh Flowers", prompt: "a few delicate fresh flower petals or a single small bloom placed softly beside the piece" },
  { id: "ribbon", label: "Silk Ribbon", prompt: "a thin silk ribbon draped elegantly near the piece in a complementary color" },
  { id: "draped-chain", label: "Draped Chain", prompt: "a fine gold chain draped loosely in the background for texture, out of focus" },
  { id: "botanicals", label: "Dried Botanicals", prompt: "a few dried botanical sprigs or leaves arranged minimally near the piece" },
  { id: "mirror", label: "Mirror Reflection", prompt: "placed on a small reflective mirrored surface so the piece is subtly mirrored below" },
  { id: "water", label: "Water Droplets", prompt: "fine water droplets on the surface around the piece catching the studio light" },
  { id: "silk-fabric", label: "Draped Silk", prompt: "a soft swatch of draped silk fabric beneath or behind the piece for texture" },
];

/**
 * The four shots a kit is made of.
 *
 * `needsModel` is what decides whether the model photo is sent with the
 * jewellery for that shot — a studio shot that receives it tends to put a
 * hand in frame, which is the one thing a "jewelry only" brief rules out.
 */
const SHOTS = [
  {
    id: "lifestyleWarm",
    label: "Lifestyle — Warm Editorial",
    needsModel: true,
    instruction: ({ aspectNote, description, poseNote }) => `Photorealistic lifestyle jewelry photograph. Place the jewelry from the reference image(s) naturally and accurately onto the model (the first image), matching every structural detail of the jewelry exactly — shape, stone settings, metal color, proportions. Do not simplify or alter the design.
${SCALE_NOTE}
${ANATOMY_NOTE}
STYLE: Warm editorial lifestyle photography — golden-hour glow, soft warm rim light, inviting and aspirational, magazine-cover quality.
POSE: ${poseNote || "a relaxed, elegant pose"}.
BACKGROUND: A softly blurred warm interior or golden outdoor setting that complements the jewelry without competing with it.
Do NOT change the model's face, ethnicity, body proportions, or identity.
Image orientation: ${aspectNote}.
${description ? `ADDITIONAL NOTES: ${description}` : ""}`,
  },
  {
    id: "lifestyleDramatic",
    label: "Lifestyle — Dramatic Mood",
    needsModel: true,
    instruction: ({ aspectNote, description, poseNote }) => `Photorealistic lifestyle jewelry photograph. Place the jewelry from the reference image(s) naturally and accurately onto the model (the first image), matching every structural detail of the jewelry exactly — shape, stone settings, metal color, proportions. Do not simplify or alter the design.
${SCALE_NOTE}
${ANATOMY_NOTE}
STYLE: Dramatic high-fashion editorial mood — deep shadows, a single dramatic rim or spotlight highlighting the jewelry, bold and striking, the calibre of a Cartier or Bulgari campaign.
POSE: ${poseNote || "a confident, intense pose"}.
BACKGROUND: A dark, moody, softly blurred backdrop (charcoal, deep navy, or black) that lets the jewelry catch the light.
Do NOT change the model's face, ethnicity, body proportions, or identity.
Image orientation: ${aspectNote}.
${description ? `ADDITIONAL NOTES: ${description}` : ""}`,
  },
  {
    id: "studioClean",
    label: "Studio — Clean White",
    needsModel: false,
    instruction: ({ aspectNote, description, boxNote, propNote }) => `Photorealistic studio product photograph of the jewelry piece(s) alone (the reference image(s)) — no model, no hands, jewelry only. Preserve every structural detail exactly — shape, stone settings, metal color, proportions; do not simplify or alter the design.
${SCALE_NOTE}
STYLE: Clean commercial product photography, pure white seamless background, soft even studio lighting, sharp focus, true-to-life color, a single elegant fixed hero angle with nothing cropped.
${boxNote ? `PRESENTATION: ${boxNote}` : ""}
${propNote ? `STYLING: Include ${propNote}, kept subtle and secondary — the jewelry stays the clear focal point.` : ""}
Image orientation: ${aspectNote}.
${description ? `ADDITIONAL NOTES: ${description}` : ""}`,
  },
  {
    id: "studioLuxury",
    label: "Studio — Dark Luxury",
    needsModel: false,
    instruction: ({ aspectNote, description, boxNote, propNote }) => `Photorealistic studio product photograph of the jewelry piece(s) alone (the reference image(s)) — no model, no hands, jewelry only. Preserve every structural detail exactly — shape, stone settings, metal color, proportions; do not simplify or alter the design.
${SCALE_NOTE}
STYLE: Dark luxury editorial product photography — deep black or dark velvet backdrop, dramatic directional lighting that makes the stones and metal glint, high-end jewelry-brand campaign quality, the SAME fixed hero angle and framing as the clean-white studio shot, nothing cropped.
${boxNote ? `PRESENTATION: ${boxNote}` : ""}
${propNote ? `STYLING: Include ${propNote}, kept subtle and secondary — the jewelry stays the clear focal point.` : ""}
Image orientation: ${aspectNote}.
${description ? `ADDITIONAL NOTES: ${description}` : ""}`,
  },
];

/** Picks `count` distinct entries at random, skipping the "auto" placeholder. */
function pickRandomDistinct(pool, count) {
  const remaining = pool.filter((option) => option.id !== "auto");
  const picked = [];
  while (picked.length < count && remaining.length > 0) {
    picked.push(remaining.splice(Math.floor(Math.random() * remaining.length), 1)[0]);
  }
  return picked;
}

function promptFor(list, id) {
  return list.find((option) => option.id === id)?.prompt ?? "";
}

/**
 * Resolves the styling picks into one note per shot.
 *
 * Each of the three lists can carry zero, one or two picks — one per shot in
 * its pair. Two picks are used as given; one applies to both shots of the
 * pair; none falls back to a sensible default, which for poses and props
 * means two *different* random picks, so an unstyled kit still comes back as
 * a varied set rather than the same shot twice.
 */
function resolveShotNotes({ boxStyles = [], poses = [], studioProps = [] }) {
  const boxes = boxStyles.slice(0, 2).map((id) => promptFor(BOX_STYLE_OPTIONS, id));
  const [boxA, boxB] = boxes.length === 2 ? boxes : [boxes[0] ?? "", boxes[0] ?? ""];

  const chosenPoses = poses.slice(0, 2).filter((id) => id && id !== "auto");
  const [poseA, poseB] =
    chosenPoses.length === 2
      ? chosenPoses.map((id) => promptFor(POSE_OPTIONS, id))
      : chosenPoses.length === 1
        ? [promptFor(POSE_OPTIONS, chosenPoses[0]), promptFor(POSE_OPTIONS, chosenPoses[0])]
        : pickRandomDistinct(POSE_OPTIONS, 2).map((option) => option.prompt);

  const chosenProps = studioProps.slice(0, 2).filter((id) => id && id !== "auto");
  const [propA, propB] =
    chosenProps.length === 2
      ? chosenProps.map((id) => promptFor(STUDIO_PROP_OPTIONS, id))
      : chosenProps.length === 1
        ? [promptFor(STUDIO_PROP_OPTIONS, chosenProps[0]), promptFor(STUDIO_PROP_OPTIONS, chosenProps[0])]
        : pickRandomDistinct(STUDIO_PROP_OPTIONS, 2).map((option) => option.prompt);

  return {
    lifestyleWarm: { poseNote: poseA ?? "" },
    lifestyleDramatic: { poseNote: poseB ?? "" },
    studioClean: { boxNote: boxA, propNote: propA ?? "" },
    studioLuxury: { boxNote: boxB, propNote: propB ?? "" },
  };
}

/**
 * The four prompts for one kit, in shot order.
 *
 * Returned alongside each shot's id, label and whether it wants the model,
 * because the runner needs all three: the label captions the result, and
 * `needsModel` decides which images go with which prompt.
 */
function buildCampaignKitShots({ aspect, description, boxStyles, poses, studioProps }) {
  const aspectNote = ASPECT_TEXT[aspect] || ASPECT_TEXT.square;
  const notes = resolveShotNotes({ boxStyles, poses, studioProps });

  return SHOTS.map((shot) => ({
    id: shot.id,
    label: shot.label,
    needsModel: shot.needsModel,
    prompt: shot.instruction({ aspectNote, description: description || "", ...notes[shot.id] }),
  }));
}

/** Refining one already-generated shot. */
function buildCampaignKitRefinePrompt({ instruction, referenceCount = 0, data = {} }) {
  const referenceNote = referenceCount
    ? ` ${referenceCount > 1 ? `${referenceCount} additional reference images are` : "A second reference image is"} also attached, purely as visual inspiration for the requested change — apply that idea onto the FIRST image, do not copy or blend in the reference(s)' own subject, composition or background.`
    : "";

  // Only a shot with a person in it needs the anatomy warning; adding it to a
  // studio shot of a bare ring is instruction the model has to read past.
  const isLifestyle = String(data.shotLabel || "").toLowerCase().includes("lifestyle");

  return `Modify this jewelry marketing photograph (the first image): ${instruction}.${referenceNote} Keep the same photorealistic quality, composition, and style. Only apply the specifically requested changes. ${SCALE_NOTE}${isLifestyle ? ` ${ANATOMY_NOTE}` : ""}`;
}

module.exports = {
  SCALE_NOTE,
  ANATOMY_NOTE,
  BOX_STYLE_OPTIONS,
  POSE_OPTIONS,
  STUDIO_PROP_OPTIONS,
  SHOTS,
  buildCampaignKitShots,
  buildCampaignKitRefinePrompt,
};
