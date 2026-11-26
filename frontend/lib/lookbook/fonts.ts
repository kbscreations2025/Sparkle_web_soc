import {
  Bebas_Neue,
  Bodoni_Moda,
  Cinzel,
  Cormorant_Garamond,
  DM_Serif_Display,
  Great_Vibes,
  Inter,
  Italiana,
  Jost,
  Josefin_Sans,
  Marcellus,
  Montserrat,
  Pinyon_Script,
  Playfair_Display,
} from "next/font/google";
import type { FontId } from "./types";

/*
 * The typefaces a lookbook can use, self-hosted through next/font so a
 * client's phone never asks Google for them.
 *
 * `preload: false` on all of them. Preloading would fetch every face on
 * every page that imports this module, and a page uses two or three. A font
 * file downloads only once something on screen is set in it, and `swap`
 * shows the fallback meanwhile, so text is never invisible while it loads.
 *
 * Variable fonts carry every weight in one file. The static ones exist in a
 * single weight, and the renderer never asks them for another, because a
 * browser would fake a bold.
 */
// next/font reads these calls at build time, so each takes a plain literal: no shared options object.
const playfair = Playfair_Display({ subsets: ["latin"], display: "swap", preload: false, style: ["normal", "italic"] });
const cormorant = Cormorant_Garamond({ subsets: ["latin"], display: "swap", preload: false, style: ["normal", "italic"] });
const bodoni = Bodoni_Moda({ subsets: ["latin"], display: "swap", preload: false, style: ["normal", "italic"] });
const dmSerif = DM_Serif_Display({ subsets: ["latin"], display: "swap", preload: false, weight: "400", style: ["normal", "italic"] });
const cinzel = Cinzel({ subsets: ["latin"], display: "swap", preload: false });
const marcellus = Marcellus({ subsets: ["latin"], display: "swap", preload: false, weight: "400" });
const italiana = Italiana({ subsets: ["latin"], display: "swap", preload: false, weight: "400" });
const greatVibes = Great_Vibes({ subsets: ["latin"], display: "swap", preload: false, weight: "400" });
const pinyon = Pinyon_Script({ subsets: ["latin"], display: "swap", preload: false, weight: "400" });
const inter = Inter({ subsets: ["latin"], display: "swap", preload: false });
const montserrat = Montserrat({ subsets: ["latin"], display: "swap", preload: false, style: ["normal", "italic"] });
const josefin = Josefin_Sans({ subsets: ["latin"], display: "swap", preload: false });
const jost = Jost({ subsets: ["latin"], display: "swap", preload: false, style: ["normal", "italic"] });
const bebas = Bebas_Neue({ subsets: ["latin"], display: "swap", preload: false, weight: "400" });

export type FontCategory = "serif" | "sans" | "script" | "display";

export type FontOption = {
  id: FontId;
  label: string;
  /** The CSS font-family, fallbacks included. */
  family: string;
  category: FontCategory;
  /** Only variable fonts take a weight other than their one. */
  variable: boolean;
};

export const FONTS: Record<FontId, FontOption> = {
  playfair: { id: "playfair", label: "Playfair Display", family: playfair.style.fontFamily, category: "serif", variable: true },
  cormorant: { id: "cormorant", label: "Cormorant Garamond", family: cormorant.style.fontFamily, category: "serif", variable: true },
  bodoni: { id: "bodoni", label: "Bodoni Moda", family: bodoni.style.fontFamily, category: "serif", variable: true },
  "dm-serif": { id: "dm-serif", label: "DM Serif Display", family: dmSerif.style.fontFamily, category: "serif", variable: false },
  cinzel: { id: "cinzel", label: "Cinzel", family: cinzel.style.fontFamily, category: "display", variable: true },
  marcellus: { id: "marcellus", label: "Marcellus", family: marcellus.style.fontFamily, category: "display", variable: false },
  italiana: { id: "italiana", label: "Italiana", family: italiana.style.fontFamily, category: "display", variable: false },
  "great-vibes": { id: "great-vibes", label: "Great Vibes", family: greatVibes.style.fontFamily, category: "script", variable: false },
  pinyon: { id: "pinyon", label: "Pinyon Script", family: pinyon.style.fontFamily, category: "script", variable: false },
  inter: { id: "inter", label: "Inter", family: inter.style.fontFamily, category: "sans", variable: true },
  montserrat: { id: "montserrat", label: "Montserrat", family: montserrat.style.fontFamily, category: "sans", variable: true },
  josefin: { id: "josefin", label: "Josefin Sans", family: josefin.style.fontFamily, category: "sans", variable: true },
  jost: { id: "jost", label: "Jost", family: jost.style.fontFamily, category: "sans", variable: true },
  bebas: { id: "bebas", label: "Bebas Neue", family: bebas.style.fontFamily, category: "display", variable: false },
};

export const FONT_LIST: FontOption[] = Object.values(FONTS);

/** A font from a saved page, falling back when the id is unknown (an older or edited document). */
export function fontOf(id: string | undefined, fallback: FontId = "inter"): FontOption {
  return FONTS[id as FontId] ?? FONTS[fallback];
}
