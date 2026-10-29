/**
 * Product Views — the standard catalogue angles of one piece, from the photos
 * the person already has.
 *
 * The person picks what kind of piece it is, then places each photo they have
 * into the box for its angle; every box left empty is generated, one image
 * each. Each generated view is given all the photos, labelled with the angle
 * they show, so it draws the same piece from the new angle.
 *
 * Rings and bracelets are shot from the same four angles; earrings and
 * pendants are showcased differently, so each category has its own set.
 * View ids are unique across categories.
 */

const VIEWS = [
  // ── Rings & bracelets ──
  {
    id: "three-quarter",
    category: "ring",
    label: "3/4 angle",
    camera:
      "THREE-QUARTER VIEW — the classic e-commerce hero angle, about 45° from the front and slightly above, showing the top of the stone and the side of the setting and band together.",
  },
  {
    id: "front",
    category: "ring",
    label: "Front",
    camera:
      "FRONT VIEW — camera looking straight down at the top of the piece, the main stone facing the camera head-on and centred, the band or body spreading symmetrically to both sides.",
  },
  {
    id: "side",
    category: "ring",
    label: "Side",
    camera:
      "SIDE VIEW — a true side profile at the height of the piece: the setting, basket or gallery under the stone seen from the side, and the shank or body running away from the camera with any side stones visible along it.",
  },
  {
    id: "upright",
    category: "ring",
    label: "Upright",
    camera:
      "UPRIGHT VIEW — the piece standing upright facing the camera so you look through it: for a ring, the full circle of the band with the stone on top, the shoulders and any shank stones visible on both sides.",
  },

  // ── Earrings ──
  {
    id: "earring-pair",
    category: "earrings",
    label: "Pair front",
    camera:
      "PAIR FRONT VIEW — both earrings of the pair side by side, each facing the camera head-on, the same size and level with each other, a small even gap between them, the posts hidden behind.",
  },
  {
    id: "earring-front-side",
    category: "earrings",
    label: "Front + side",
    camera:
      "FRONT AND PROFILE VIEW — the pair shown two ways in one image: on the left one earring facing the camera head-on; on the right the other earring turned 90° into a true side profile, showing the depth of the setting, the post running horizontally away from it and the butterfly back on the post.",
  },

  // ── Pendants ──
  {
    id: "pendant-front",
    category: "pendant",
    label: "Front",
    camera:
      "FRONT VIEW — the pendant hanging straight and facing the camera head-on, centred, its chain rising from the bail or loops up towards both top corners of the frame.",
  },
  {
    id: "pendant-side",
    category: "pendant",
    label: "Side",
    camera:
      "SIDE VIEW — the pendant turned 90° into a true side profile, showing the depth of the setting and gallery, how far the stones stand off the back plate, the bail, and the chain rising up out of the frame.",
  },
];

/** Per kind of piece: what it is called in the prompt, how it is framed, and which photos are enough to start from. */
const CATEGORIES = {
  ring: {
    piece: "piece of jewellery",
    framing: "The whole piece in frame, centred, nothing cropped.",
    // Side and upright alone show too little of the piece to rebuild it from.
    keyViews: ["three-quarter", "front"],
  },
  earrings: {
    piece: "pair of earrings",
    framing: "Both earrings fully in frame, centred as a pair, nothing cropped.",
    keyViews: ["earring-pair", "earring-front-side"],
  },
  pendant: {
    piece: "pendant on its chain",
    framing: "The whole pendant in frame and centred; the chain may run out of the top of the frame.",
    // A side profile hides the face of the pendant.
    keyViews: ["pendant-front"],
  },
};

const CATEGORY_IDS = Object.keys(CATEGORIES);
const VIEW_BY_ID = new Map(VIEWS.map((view) => [view.id, view]));

/** The view ids that belong to one category. */
function viewIdsFor(category) {
  return VIEWS.filter((view) => view.category === category).map((view) => view.id);
}

/** One generated angle: the person's photos as the truth about the piece, this one camera position. */
function buildViewPrompt({ viewId, photoViews = [], notes, category = "ring" }) {
  const view = VIEW_BY_ID.get(viewId) ?? VIEWS[0];
  const kind = CATEGORIES[category] ?? CATEGORIES.ring;
  const photos = photoViews.length
    ? photoViews.map((id, index) => `photo ${index + 1} is its ${(VIEW_BY_ID.get(id)?.label ?? id).toLowerCase()} view`).join(", ")
    : "";

  return [
    `The attached ${photoViews.length > 1 ? "photos show" : "photo shows"} one real ${kind.piece}${photos ? ` — ${photos}` : ""}. Produce a new product photograph of EXACTLY this same piece from a different angle.`,
    view.camera,
    "Keep everything identical to the photos — the same stones with the same shapes, sizes and counts, the same prong count and setting, the same metal colour and finish, the same band profile and details. Do not add, remove, simplify or redesign anything. Where this angle shows a part the photos do not, keep it plain and consistent with what is visible rather than inventing new features.",
    notes ? `Also: ${notes}` : "",
    `Clean white studio background, soft even lighting, a soft natural contact shadow, sharp focus on the whole piece, high-resolution luxury e-commerce product photography. ${kind.framing} Square 1:1 image.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

module.exports = { VIEW_BY_ID, CATEGORIES, CATEGORY_IDS, viewIdsFor, buildViewPrompt };
