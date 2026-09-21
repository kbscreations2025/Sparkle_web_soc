/**
 * Lifestyle's option lists — who wears the piece, where it goes, how it is
 * framed, and what the scene looks like.
 *
 * Every `value` here is prompt text the backend sends to the model verbatim.
 * That is deliberate: placement and scene are the user's choices, not the
 * model's, and resolving them in the browser is what lets each option say
 * exactly what it will do.
 */

/**
 * The custom model builder's attributes.
 *
 * Several of these are multi-select — the picks are joined into one
 * comma-separated string, which lets the model blend traits and lets
 * Regenerate pick at random from just the outfits chosen rather than the
 * whole wardrobe. Gender and Age stay single-pick.
 */
export const MODEL_ATTRS: { key: string; label: string; options: string[]; note?: string }[] = [
  { key: 'gender', label: 'Gender', options: ['Female', 'Male'] },
  { key: 'body', label: 'Body / Fitness', options: ['Lean, narrow frame', 'Athletic, muscular', 'Softer, rounder frame'] },
  { key: 'skinTone', label: 'Skin Tone', note: 'MST = Monk Skin Tone Scale', options: ['MST 1–2', 'MST 3–4', 'MST 5–6', 'MST 7–8', 'MST 9–10'] },
  { key: 'skinFinish', label: 'Skin Finish', options: ['Soft matte', 'Glowing / dewy', 'Radiant', 'Natural', 'Sun-tanned'] },
  { key: 'hairStyle', label: 'Hair Style', options: ['Long straight', 'Long wavy', 'Curly', 'Short', 'Sleek bun', 'Ponytail'] },
  { key: 'hairColor', label: 'Hair Color', options: ['Black (Level 1)', 'Dark brown (Level 2–3)', 'Medium / light brown (Level 4–5)', 'Dark blonde (Level 6)', 'Blonde (Level 7–8)', 'Light blonde / platinum (Level 9–10)'] },
  { key: 'outfit', label: 'Outfit & Styling', options: ['Classic Evening Gown', 'Off-Shoulder Gown', 'One-Shoulder Gown', 'Halter Neck Dress', 'Backless Evening Dress', 'Strapless Dress', 'Plunging V-Neck Dress', 'Boat Neck Blouse', 'Square Neck Top', 'Cowl Neck Dress', 'Silk Wrap Top', 'Turtleneck Sweater', 'Slip Dress', 'Little Black Dress', 'Tailored Blazer', 'Structured Shirt', 'Anarkali Suit', 'Bridal Ensemble', 'Kanjeevaram Drape', 'Cape Dress', 'Bodycon Dress', 'Sheath Dress', 'Kaftan', 'Jumpsuit (fitted)', 'Wrap Dress', 'Peplum Top', 'Corset Top'] },
  { key: 'age', label: 'Age', options: ['18–24', '25–34', '35–44', '45–54', '55+'] },
  { key: 'height', label: 'Height', options: ['Petite (under 5\'4")', 'Average (5\'4"–5\'7")', 'Tall (5\'8"–5\'11")', 'Very tall (6\'+)'] },
]

/**
 * Where the piece goes — only where the answer isn't in the photograph.
 *
 * A necklace goes round the neck and an earring on an ear; the model can see
 * that from the uploaded piece, and asking cost twenty chips of scrolling
 * for a choice with one sensible answer. What a photo cannot say is *which*
 * finger or *which* wrist, so rings and bracelets keep their list and
 * everything else is left to the piece itself.
 */
export const PLACEMENT_GROUPS = [
  {
    group: 'Anything else',
    items: [
      {
        id: 'auto',
        label: 'From the photo',
        // Deliberately names no kind of jewellery: the backend reads the
        // kind out of this text to pick its rules, so a word like "earrings"
        // here would have it prompt for one specific piece.
        value:
          'Determine from the reference photograph what kind of piece this is, and place it on the one body location where such a piece is actually worn, at the position and length that reads as natural for it. Follow the placement rules below for that kind. Every other part of the model stays bare.',
      },
    ],
  },
  {
    group: 'Ring',
    items: [
      { id: 'left-ring', label: 'Left Ring Finger', value: 'Place the ring EXCLUSIVELY on the left ring finger (fourth finger, between middle and pinky). The ring band must encircle the full circumference of the finger at the base, fitting snugly. Size the ring so the band and stone are proportional to this finger\'s diameter — must NOT appear miniaturized. The ring must appear on this single finger ONLY. Do NOT place on any other finger.' },
      { id: 'left-index', label: 'Left Index Finger', value: 'Place the ring EXCLUSIVELY on the left index finger (second finger from thumb). The ring band wraps the base knuckle snugly, proportionally sized to the index finger diameter. The ring must appear on this single finger ONLY.' },
      { id: 'left-middle', label: 'Left Middle Finger', value: 'Place the ring EXCLUSIVELY on the left middle finger (center/longest finger). The ring sits at the base, proportionally sized. The ring must appear on this single finger ONLY. Do NOT place on adjacent fingers.' },
      { id: 'left-pinky', label: 'Left Pinky', value: 'Place the ring EXCLUSIVELY on the left pinky (smallest finger). Scale the ring proportionally smaller to fit the pinky diameter snugly. The ring must appear on this single finger ONLY.' },
      { id: 'left-thumb', label: 'Left Thumb', value: 'Place the ring EXCLUSIVELY on the left thumb. The ring band encircles the base of the thumb, proportionally sized to the wider thumb diameter. The ring must appear on the thumb ONLY.' },
      { id: 'right-ring', label: 'Right Ring Finger', value: 'Place the ring EXCLUSIVELY on the right ring finger (fourth finger). The ring band encircles the base snugly, proportionally sized to this finger\'s diameter. Must appear on this single finger ONLY.' },
      { id: 'right-index', label: 'Right Index Finger', value: 'Place the ring EXCLUSIVELY on the right index finger. The ring wraps the base knuckle proportionally. Must appear on this single finger ONLY.' },
      { id: 'right-middle', label: 'Right Middle Finger', value: 'Place the ring EXCLUSIVELY on the right middle finger. Ring sits at the base, proportionally sized. Must appear on this single finger ONLY.' },
      { id: 'right-pinky', label: 'Right Pinky', value: 'Place the ring EXCLUSIVELY on the right pinky. Scale proportionally smaller for the pinky diameter. Must appear on this single finger ONLY.' },
      { id: 'right-thumb', label: 'Right Thumb', value: 'Place the ring EXCLUSIVELY on the right thumb. Proportionally sized to the wider thumb. Must appear on the thumb ONLY.' },
    ],
  },
  {
    group: 'Bracelet',
    items: [
      { id: 'right-wrist', label: 'Right Wrist', value: 'Place the bracelet on the RIGHT wrist, centered between the wrist bone and the base of the palm. The bracelet encircles the full wrist, proportionally sized to appear naturally worn — not floating or loose.' },
      { id: 'left-wrist', label: 'Left Wrist', value: 'Place the bracelet on the LEFT wrist, centered at the wrist. Encircles the full wrist, proportionally sized and snug.' },
    ],
  },
]

export const ALL_PLACEMENTS = PLACEMENT_GROUPS.flatMap((group) => group.items);

/**
 * Poses. Every one is a tight crop by design — this tool is for jewellery
 * hero shots, not fashion full-lengths.
 *
 * `shot` is the literal framing phrase sent as `shotType`. It replaced a
 * keyword-sniffing heuristic that guessed "full body shot" whenever a pose's
 * own prose happened to contain the word "full" or "body". It is left
 * undefined only on "No specific pose", so the backend can pick its own
 * default — tighter for one piece, roomier for a set.
 */
export const POSES: { id: string; label: string; value: string; shot?: string }[] = [
  { id: 'none', label: 'No specific pose', value: '' },
  { id: 'hand-extended', label: 'Hand Extended', value: 'The model extends her hand forward toward the camera with fingers elegantly spread, placing the jewelry in sharp focus at the center of the frame. The hand fills the foreground.', shot: 'extreme macro close-up' },
  { id: 'hand-rest', label: 'Graceful Hand Rest', value: 'The model rests her hand gracefully on a soft surface or her lap, fingers relaxed and natural. Shallow depth of field with the jewelry as the sharp focal point.', shot: 'extreme macro close-up' },
  { id: 'hand-to-face', label: 'Hand to Face', value: 'The model brings her hand delicately close to her cheek, showcasing the jewelry against a softly blurred face in the background. The jewelry is in sharp focus.', shot: 'extreme macro close-up' },
  { id: 'hand-to-neck', label: 'Hand to Collarbone', value: 'The model\'s fingers rest gently at the base of her neck and collarbone, the jewelry framed intimately against her skin. Her face is softly out of focus above the frame.', shot: 'extreme macro close-up' },
  { id: 'candid-cup', label: 'Candid with Cup', value: 'The model holds a warm cup or mug in both hands near her chest, in a quiet, candid, unposed moment. The jewelry catches the light naturally on her hand.', shot: 'extreme macro close-up' },
  { id: 'chin-rest', label: 'Chin Rest Close-Up', value: 'The model\'s fingers rest delicately against her chin or cheek, lips and jawline softly visible just behind. The jewelry on her hand is the sharp focal point in the foreground.', shot: 'extreme macro close-up' },
  { id: 'ear-jaw-macro', label: 'Ear & Jaw Macro', value: 'An extreme macro crop on the ear, jawline, and neck, hair swept back to reveal the piece clearly — photographed with the intimacy of a beauty campaign close-up.', shot: 'extreme macro close-up' },
  { id: 'necklace-macro', label: 'Necklace at Collarbone', value: 'A tight macro crop centered on the collarbone and base of the neck, the pendant or necklace resting naturally against the skin. The face is mostly out of frame.', shot: 'extreme macro close-up' },
  { id: 'dewy-skin', label: 'Dewy Skin Glow', value: 'A macro crop on fresh, dewy skin at the neck or collarbone, as if just after a warm shower — soft light catching both the skin and the jewelry for a spa-like glow.', shot: 'extreme macro close-up' },
  { id: 'floral-macro', label: 'With Floral Accent', value: 'A close macro crop with the jewelry-adorned hand or neck framed alongside a few soft, out-of-focus flower petals — a romantic, delicate editorial mood.', shot: 'extreme macro close-up' },
  { id: 'wrist-raise', label: 'Wrist Raised', value: 'The model raises her wrist elegantly toward the camera in a poised, editorial manner, in close macro crop. The jewelry is front and center.', shot: 'extreme macro close-up' },
  { id: 'front-portrait', label: 'Front Portrait', value: 'A close portrait crop facing the camera, even lighting, jewelry prominently visible against softly blurred features.', shot: 'close-up portrait' },
  { id: 'side-profile', label: 'Side Profile', value: 'A close side-profile crop, ideal for ear, neck, or hair accessories — the jewelry catches the light beautifully.', shot: 'close-up portrait' },
  { id: 'looking-down', label: 'Looking Down', value: 'The model tilts her head slightly downward, camera framing the jewelry from above in an intimate, close editorial crop.', shot: 'close-up portrait' },
]

/**
 * Scene and background themes, sent verbatim as `sceneInstruction`.
 *
 * Every option is deliberately warm or tinted, never a flat black or white
 * backdrop — "Dark Luxury" is charcoal/espresso for exactly that reason.
 * "Surprise Me" carries no value of its own; `resolveScene` picks a real
 * one at generate time.
 */
export const THEMES: { id: string; label: string; value: string }[] = [
  { id: 'random', label: 'Surprise Me', value: '' },
  { id: 'golden-hour', label: 'Golden Hour', value: 'Warm, low-angle natural sunlight streaming in, soft golden tones, with a gently blurred outdoor or window-lit setting behind the model.' },
  { id: 'cozy-home', label: 'Cozy Home', value: 'A warm, softly lit indoor lifestyle setting — a sunlit breakfast table or reading nook — with gently blurred domestic props such as a mug, linen, or a book in the background.' },
  { id: 'dewy-glow', label: 'Dewy Glow', value: 'Fresh, dewy skin with soft water droplets, bright airy light as if just out of a warm shower or spa, clean pale background.' },
  { id: 'floral-editorial', label: 'Floral Editorial', value: 'Soft, out-of-focus flowers such as magnolia or baby\'s breath framing the shot, pastel tones, romantic natural light.' },
  { id: 'silk-drape', label: 'Silk & Linen', value: 'A softly draped silk or linen backdrop in a muted neutral tone, with directional light that skims across the fabric\'s texture.' },
  { id: 'dark-luxury', label: 'Dark Luxury', value: 'A rich, dark backdrop in deep charcoal or espresso brown — never a flat black — with a warm rim light that makes the metal and stones glow dramatically.' },
  { id: 'studio-clean', label: 'Clean Studio', value: 'A seamless, softly graduated neutral studio backdrop in warm ivory to soft grey, with gentle diffused light that keeps the jewelry as the clear focal point.' },
]

/**
 * Resolves "Surprise Me" to one real theme before the request is sent, so
 * the backend always receives a concrete scene — the model is never left to
 * pick for itself.
 */
export function resolveScene(themeId: string): { label: string; value: string } {
  if (themeId !== "random") {
    const theme = THEMES.find((entry) => entry.id === themeId);
    if (theme) return theme;
  }
  const pool = THEMES.filter((entry) => entry.id !== "random");
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Suggested follow-ups, offered until the first refinement comes back. */
export const HINTS = [
  'Change background to outdoor garden',
  'Make lighting warmer, golden hour feel',
  'Zoom in closer on the jewelry',
  'Try a more editorial mood',
  'Soften the background blur',
]
