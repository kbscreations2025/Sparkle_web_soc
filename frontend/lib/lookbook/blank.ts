import { DEFAULT_THEME, newCard } from "./defaults";
import { LOOKBOOK_VERSION, type LookbookDesign, type LookbookTheme } from "./types";

/**
 * The one way to start a lookbook for now: a clean slate. A plain light page
 * in one readable font, nothing animating, and a single hero to type over.
 * Everything else is built by the person, card by card.
 */
export const BLANK_THEME: LookbookTheme = {
  ...DEFAULT_THEME,
  templateId: "blank",
  headingWeight: 600,
  headingTracking: -0.015,
  radius: 8,
  gap: 24,
  maxWidth: 1080,
};

/** A new blank page, its hero titled with the lookbook's name when one was typed. */
export function blankDesign(title = ""): LookbookDesign {
  const hero = newCard("hero");
  return {
    version: LOOKBOOK_VERSION,
    theme: structuredClone(BLANK_THEME),
    cards: [
      {
        ...hero,
        // Every other word empty: the builder shows faint prompts where to type, and a
        // word left untyped never reaches the public page.
        eyebrow: "",
        title: title.trim().slice(0, 120),
        subtitle: "",
        height: "auto",
        buttonLabel: "",
        buttonTarget: "none",
        style: { ...hero.style, variant: "stacked", width: "wide", paddingY: 56, fit: "whole" },
        animation: { ...hero.animation, type: "none" },
      },
    ],
    meta: { title: "", description: "" },
  };
}
