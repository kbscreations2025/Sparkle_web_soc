/**
 * The built-in prompt for "Cleaning in Testing": an e-commerce-ready shot on
 * plain white — polished metal that keeps its real fine texture, crisp
 * prongs and edges, brilliant but natural stones, a soft contact shadow — and
 * one fixed set of metal tones, so a catalogue shot on different days, lights
 * and cameras comes out looking like one set.
 *
 * The tones and the shadow are measured from the catalogue shots this mode
 * is meant to match (yellow-gold midtones ≈ #DEC65F across all of them), not
 * picked by eye. Shorter than the other cleaning prompts on purpose: the
 * trial models follow a tight, ordered brief more reliably than a long
 * checklist.
 */
const STUDIO_CLEANING_PROMPT = `
Retouch this jewellery photograph into a finished e-commerce product image, ready to upload to a jewellery website as it is. This is a RETOUCH of the exact piece shown, not a new design.

1. KEEP THE PIECE IDENTICAL
Same design, shape, proportions, thickness, orientation, camera angle and size. Same number, size, shape, cut and position of every stone and every prong. Keep hallmarks/stamps (e.g. "925", "375") as they are; never invent text. Do not add, remove, move or redesign anything.

2. BACKGROUND AND SHADOW
Replace everything behind the jewellery — stands, foam blocks, glass, props, dust, marks — with a flat, pure white background (#FFFFFF), edge to edge, with no gradient, vignette, texture or tint — and no faint grey band, horizon line or table edge where the stand used to be: the white is exactly the same from top to bottom. Centre the piece with generous white space around it. Any part of the jewellery hidden behind a stand or pushed into a foam block must be completed naturally, matching the visible parts exactly.
Add exactly one shadow: a soft, natural contact shadow directly under the lowest point(s) of the piece, as if it rests on a white surface.
- A piece standing on an edge (earring, pendant, charm): a thin, tight, light-grey line right at its base that fades out almost immediately.
- A ring or bangle: a soft, diffuse light-grey shadow under the band, darkest where it touches (about RGB 200,200,200) and fading smoothly to pure white a short distance below.
No long, hard or directional drop shadows, and nothing else anywhere on the background.

3. METAL — POLISHED, CLEAN AND REAL
Enhance: polish, reflectivity, surface smoothness and highlight transitions.
Remove: scratches, nicks, dents, oxidation and tarnish, fingerprints, dust, smudges, streaks, porosity and casting marks.
Remove every reflection of the camera, DSLR, lens, photographer, phone, stand or other studio equipment from the metal, and replace each one with a clean, studio-appropriate highlight that follows the surface.
Result: a mirror-polished luxury finish in the piece's own metal (see 4), with:
- polished metal surfaces that keep a fine, natural metal texture — the even, natural grain and micro-surface detail of real polished metal. That texture is fine and uniform; scratches, scuffs, pits, blotches and uneven patches are defects and must go everywhere, including on posts, earring backs, clasps and inner surfaces. Remove defects, not texture: never flatten the metal into smooth plastic, chrome or CGI;
- micro-reflections and natural highlight transitions: bright, clean highlights along the top edges and curves, deeper tones in the side planes for depth, and smooth, realistic gradients between them. On yellow gold the deeper tones are rich, saturated amber-gold, never grey or black patches;
- a shank/band that is clean and even all the way round, with crisp edges and a consistent thickness.
Metal enhancement is required, not optional: dull, grey, flat, muddy or matte metal is a failure. The result must look clearly brighter, cleaner and shinier than the input, while still looking like real metal.

4. METAL COLOUR — THE ORIGINAL METAL, ONE CONSISTENT TONE IN EVERY PHOTO
Keep the metal the input shows and render it in these exact tones, so every photo of a collection matches:
- Yellow gold (any yellowish metal, including pale, greenish, brassy, dull or gold-plated): bright, saturated, clean yellow gold. Broad highlights about RGB(245,235,190) #F5EBBE, midtones about RGB(222,198,95) #DEC65F, deep reflections about RGB(170,125,15) #AA7D0F, with only very thin dark lines along edges for definition. Not orange, not copper, not brown, not green, not pale or washed out.
- White gold / platinum / silver: bright, clean, neutral white metal, midtones about RGB(200,201,203), with no yellow or blue cast.
- Rose gold: a soft, even, warm rose gold.
Two-tone pieces stay two-tone: white-gold prongs, heads or pavé channels on a yellow-gold piece stay bright white metal, and blackened settings around black stones stay black. Never change one metal into another.

5. FINE DETAIL — KEEP IT CRISP
Every small part of the piece stays sharp, defined and exactly where it is:
- prongs and setting details — claws, bezels, baskets, galleries, milgrain and pavé beads;
- fine jewellery edges and precise contours — the exact outline of every part;
- small structural transitions — where the band meets the head, prongs meet the setting, or one part joins another — clean and defined, never blurred, melted or merged together.

6. DIAMONDS — SHINY, NATURAL AND REALISTIC
Diamond enhancement is required, not optional: every diamond must look clearly sharper and more brilliant than in the input. Soft, foggy, grey, milky or blurry stones are a failure.
- Ice-white, high-clarity stones with razor-sharp facet edges.
- Strong contrast inside each stone: bright white facets against crisp dark facets, the classic brilliant-cut pattern.
- Several small, bright, pin-point reflections on each stone so it visibly sparkles — the centre stone strongest, every side and pavé stone bright too.
- Prongs crisp and polished around each stone.
Keep it natural and photographic — real diamond optics, the way a macro lens sees them: no cartoon starbursts, no glitter, no large lens flare, no glow halo around the stones. Coloured or black stones keep their exact original colour, only cleaner, sharper and more lustrous.

7. FINISH
Pin-sharp, high-resolution macro product photo in bright, professional jewellery-studio lighting: metal and diamonds shiny but natural and realistic, with high micro-contrast and no artefacts, halos or oversharpening. Output: the same piece, cleaned and polished, in the exact metal tones above, with brilliant sharp diamonds, crisp fine detail and a soft contact shadow, on the same pure white background — ready to upload to an e-commerce listing as it is.
`;

/**
 * Appended when the gold swatch (assets/cleaning/gold-swatch.png) rides along
 * as a second image: a picture of the target tone pins the colour down more
 * tightly than numbers alone, and a swatch has no design a model could copy.
 */
const GOLD_SWATCH_NOTE =
  "IMAGE 2 IS A COLOUR SWATCH, NOT A PHOTO TO EDIT: it shows the exact yellow-gold tones to use (highlight, midtone, deep reflection). " +
  "If the piece is yellow gold, match its gold to this swatch exactly. If the piece is white gold, platinum, silver or rose gold, ignore the swatch. " +
  "Never place the swatch, its shapes or anything from it in the output — the output is only the retouched jewellery from image 1.";

module.exports = { STUDIO_CLEANING_PROMPT, GOLD_SWATCH_NOTE };
