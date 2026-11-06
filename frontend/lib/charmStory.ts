/**
 * Charm Shots' choices. The ids and the scene order must match the backend's
 * prompts/charmStory.js, which describes each to the model.
 */

/** Any number of charms — this only matches the backend's request-size guard. */
export const MAX_CHARMS = 30;

/** How many images one run can make — the backend's MAX_CHARM_IMAGES. */
export const CHARM_COUNT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8];

/**
 * The scenes, one per image, in the order the backend uses them — shown on the
 * page so the person knows where their images will be set.
 */
export const CHARM_SCENES = [
  "Held in hand",
  "In open palms",
  "Stone plinth",
  "Silk drape",
  "Hung on a painted wall",
  "Worn on the collarbone",
  "Velvet jewellery box",
  "Linen & dried flowers",
] as const;

export const CHARM_METALS = [
  { id: "match", label: "Match the charms" },
  { id: "yellow_gold", label: "Yellow gold" },
  { id: "rose_gold", label: "Rose gold" },
  { id: "silver", label: "Silver" },
] as const;
