/**
 * Charm Shots' choices. The ids must match the backend's
 * prompts/charmStory.js, which describes each to the model. The scenes live
 * only there — the backend picks one per image at random.
 */

/** Any number of charms — this only matches the backend's request-size guard. */
export const MAX_CHARMS = 30;

/** How many images one run can make — the backend's MAX_CHARM_IMAGES. */
export const CHARM_COUNT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8];

export const CHARM_METALS = [
  { id: "match", label: "Match the charms" },
  { id: "yellow_gold", label: "Yellow gold" },
  { id: "rose_gold", label: "Rose gold" },
  { id: "silver", label: "Silver" },
] as const;
