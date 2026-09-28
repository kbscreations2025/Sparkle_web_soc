/**
 * The instruction sheet behind the "New Cleaning" mode — a second built-in
 * prompt, kept in its own file apart from `IMAGE_CLEANING_PROMPT` (in
 * `imageCleaning.js`) rather than a variant of it, the same way Default's own
 * prompt is a plain constant rather than something assembled from flags.
 *
 * PLACEHOLDER: replace this with the actual wording for the new mode. Safe to
 * edit directly, exactly like `IMAGE_CLEANING_PROMPT` — nothing here is
 * interpolated, and it reaches the model exactly as written.
 */
const NEW_CLEANING_PROMPT = `

EDIT THE PROVIDED INPUT IMAGE ONLY.

TASK:
Transform the uploaded jewelry photograph into a premium, ultra-clean, high-end jewelry e-commerce/product advertising photograph.

FIRST PRIORITY — OBJECT IDENTITY:
Accurately identify the jewelry object in the input image and preserve it exactly.

The jewelry itself is the source of truth.

DO NOT redesign, reconstruct, reinterpret, simplify, beautify by changing the design, or generate a different piece of jewelry.

Preserve with maximum fidelity:
- Exact jewelry design
- Exact geometry and proportions
- Exact ring/band shape
- Exact stone count
- Exact stone positions
- Exact stone sizes and relative proportions
- Exact stone shapes and cuts
- Exact prong positions
- Exact setting structure
- Exact metal thickness
- Exact curves and contours
- Exact orientation
- Exact viewing angle
- Exact perspective
- Exact camera viewpoint
- Exact placement of every component

Do not add, remove, move, replace, resize, reshape, or invent any jewelry element.

The final image must unmistakably be the SAME physical jewelry piece shown in the input image.


==================================================
1. BACKGROUND — PURE WHITE PRODUCT BACKGROUND
==================================================

Replace the entire existing background with a completely clean, uniform pure white background.

Background color:
RGB 255, 255, 255
HEX #FFFFFF

Requirements:
- Flat pure white
- Completely uniform
- No gradient
- No vignette
- No gray tint
- No cream tint
- No warm tint
- No cool tint
- No texture
- No paper texture
- No marble texture
- No surface pattern
- No props
- No stands
- No jewelry box
- No hands
- No fingers
- No mannequin
- No holder
- No decorative objects
- No environmental elements

Remove all background distractions from the original photograph.

Do not alter the jewelry while removing the background.

Preserve the jewelry's original position, orientation and proportions.

Create generous, clean white negative space around the jewelry suitable for:
- Luxury jewelry websites
- Instagram advertisements
- Digital advertisements
- E-commerce product listings
- Large TV/display screens
- Premium jewelry-store catalogs


==================================================
2. METAL — IDENTIFY COLOR FROM INPUT IMAGE
==================================================

IMPORTANT:
Detect the actual metal type and color DIRECTLY from the input image.

Do NOT automatically convert the jewelry to yellow gold, white gold, or rose gold.

Determine the original metal appearance from the photograph and preserve that metal identity.

Reference target appearance:

WHITE GOLD:
approximately RGB 180, 180, 180

YELLOW GOLD:
approximately RGB 220, 190, 135

PINK / ROSE GOLD:
approximately RGB 200, 160, 120

These RGB values are visual reference targets, NOT a reason to change the original metal type.

If the input is yellow gold, keep it yellow gold.
If the input is white gold/platinum/silver-colored metal, keep it white metal.
If the input is rose/pink gold, keep it rose/pink gold.

Never change one metal type into another.


==================================================
3. METAL FINISH — PREMIUM LUXURY JEWELRY POLISH
==================================================

Enhance the existing metal without changing its geometry.

Create a realistic, extremely high-end jewelry studio finish.

Improve:
- Metal polish
- Surface smoothness
- Micro-surface cleanliness
- Highlight quality
- Highlight transitions
- Reflectivity
- Edge definition
- Fine detail
- Local contrast
- Perceived material quality
- Natural metallic depth
- Overall sharpness

The metal should appear:
- Mirror polished
- Clean
- Smooth
- Refined
- Premium
- Professionally photographed
- Suitable for luxury jewelry advertising

Remove STRICTLY:
- Scratches
- Micro-scratches
- Deep scratches
- Oxidation
- Tarnish
- Fingerprints
- Dust
- Dirt
- Smudges
- Streaks
- Water spots
- Camera artifacts
- Sensor artifacts
- Unwanted dark patches
- Unwanted black marks
- Dirty reflections


==================================================
4. CAMERA / DSLR / PHOTOGRAPHER REFLECTION REMOVAL
==================================================

This is a CRITICAL RETOUCHING REQUIREMENT.

Inspect every visible metal surface for unwanted reflections caused by:
- DSLR cameras
- Camera bodies
- Camera lenses
- Photographer
- Phone
- Studio equipment
- Tripods
- Black equipment
- Dark clothing
- Light stands
- Reflectors
- Unwanted environmental reflections

REMOVE all recognizable camera, photographer, equipment and black reflections.

Do NOT remove the natural reflective behavior of the metal.

Where an unwanted reflection is removed, reconstruct the area using realistic clean studio-metal reflections.

Replace unwanted dark/black reflections with:
- Natural polished-metal highlights
- Smooth controlled studio reflections
- Realistic soft light transitions
- Clean luxury jewelry lighting

The result must still look physically metallic.

DO NOT make the gold look like plastic, chrome, CGI, liquid metal, or painted material.


==================================================
5. METAL HIGHLIGHTS
==================================================

Create controlled professional jewelry-studio highlights.

Highlights should:
- Follow the actual geometry of the jewelry
- Follow the curvature of the band
- Follow the surfaces of the setting
- Have realistic light falloff
- Be smooth and physically believable
- Define the metal shape
- Increase dimensionality

Avoid:
- Artificial white lines
- Random glowing areas
- Overexposure
- Plastic-looking highlights
- CGI reflections
- Unrealistic mirror patterns
- Excessive bloom
- Halo effects


==================================================
6. DIAMONDS AND GEMSTONES
==================================================

Preserve every original gemstone exactly.

DO NOT:
- Change gemstone shape
- Change gemstone cut
- Change gemstone size
- Change gemstone position
- Change gemstone orientation
- Add gemstones
- Remove gemstones
- Replace gemstones
- Merge gemstones
- Split gemstones

Preserve original shapes such as:
- Round
- Oval
- Emerald
- Cushion
- Pear
- Marquise
- Princess
- Radiant
- Other original cuts

Enhance the existing stones to appear exceptionally clean, brilliant and professionally photographed.


==================================================
7. DIAMOND BRILLIANCE
==================================================

Increase diamond brilliance to a premium luxury-jewelry photography level.

Enhance:
- Facet definition
- Internal reflections
- Light return
- White brilliance
- Transparency
- Crisp facet edges
- Natural contrast between facets
- Clean optical appearance

The center stone should be highly brilliant.

All side stones should also be visibly bright and polished.

However:

DO NOT create artificial glitter.

DO NOT add starburst effects.

DO NOT add random sparkles.

DO NOT add excessive lens flare.

DO NOT create cartoon-like diamond shine.

DO NOT create AI-generated glitter patterns.

DO NOT overexpose the diamonds until the facets disappear.

The diamonds must remain physically believable and optically realistic.

The brilliance should come from realistic facet reflections and light return.


==================================================
8. CENTER STONE
==================================================

Give the primary/center gemstone the highest level of professional clarity and brilliance while preserving its exact original geometry.

Maintain:
- Exact outline
- Exact proportions
- Exact cut
- Exact facet arrangement
- Exact orientation
- Exact position

Enhance its:
- Facet separation
- Internal light return
- White brilliance
- Edge sharpness
- Transparency
- Natural depth

Do not alter its shape or create a different gemstone.


==================================================
9. COLORED GEMSTONES
==================================================

If colored gemstones are present:

Preserve their exact original hue and saturation.

Only perform a subtle professional enhancement.

Do not:
- Change gemstone color
- Shift hue
- Oversaturate
- Make colors neon
- Make gemstones artificially luminous
- Replace the gemstone

Maintain the authentic gemstone appearance while improving clarity, cleanliness and controlled brilliance.


==================================================
10. PRONGS AND SETTINGS
==================================================

Carefully preserve and enhance all prongs and stone-setting details.

Prongs must remain:
- In their original positions
- The original size and shape
- Structurally accurate
- Clearly defined
- Clean
- Polished
- Naturally reflective

Remove dirt, oxidation and unwanted dark artifacts from prongs.

Do not invent additional prongs.

Do not remove existing prongs.

Do not change the setting architecture.


==================================================
11. MICRO DETAIL AND SHARPNESS
==================================================

Produce an EXTRA-SHARP, HIGH-RESOLUTION professional jewelry product image.

Prioritize:
- Extremely crisp jewelry edges
- Fine metal details
- Clean gemstone facets
- Sharp prongs
- Accurate contours
- High micro-contrast
- Fine surface detail
- Professional product-photography clarity

Apply sharpening intelligently.

DO NOT create:
- Oversharpening halos
- Jagged edges
- Artificial outlines
- Excessive local contrast
- Crunchy texture
- AI-generated edge artifacts


==================================================
12. HALLMARKS / ENGRAVINGS / ORIGINAL DETAILS
==================================================

Preserve any visible original hallmark, engraving, stamp, branding mark or tiny manufacturing detail.

For example, if a hallmark or text is visible inside the band, preserve it accurately.

DO NOT invent text.

DO NOT replace text with AI-generated characters.

DO NOT erase genuine manufacturing marks unless they are clearly dirt, reflection artifacts or photographic contamination.

If a tiny original detail is partially obscured by an unwanted reflection, restore it conservatively from the visible source information without inventing new design elements.


==================================================
13. PHOTOGRAPHIC QUALITY
==================================================

The final image should look like it was photographed in a professional luxury jewelry photography studio using:

- High-end macro photography
- Controlled studio lighting
- Professional jewelry light shaping
- Extremely clean optical rendering
- High-resolution camera capture
- Premium commercial retouching

The result should be suitable for:
- Luxury jewelry websites
- Premium e-commerce
- Instagram advertisements
- Social media campaigns
- Jewelry-store digital displays
- TV screens
- Catalogs
- Product marketing


==================================================
14. STRICT PRESERVATION RULE
==================================================

MOST IMPORTANT:

This is an IMAGE RETOUCHING TASK, NOT AN IMAGE GENERATION OR JEWELRY REDESIGN TASK.

Change ONLY:
1. Background
2. Surface cleanliness
3. Metal polish
4. Unwanted reflections
5. Natural metal highlights
6. Diamond/gemstone brilliance
7. Image clarity
8. Professional photographic finish

DO NOT change the jewelry design itself.

The output must contain the SAME jewelry object as the input.

If there is any conflict between "beautification" and preserving the original jewelry, ALWAYS prioritize preserving the original jewelry.


==================================================
15. FINAL QUALITY CONTROL
==================================================

Before producing the final image, perform a strict visual comparison against the input.

Verify:

✓ Same jewelry
✓ Same geometry
✓ Same proportions
✓ Same stone count
✓ Same stone positions
✓ Same stone shapes
✓ Same setting
✓ Same prongs
✓ Same orientation
✓ Same viewing angle
✓ Same metal type
✓ Same metal color identity
✓ Pure #FFFFFF background
✓ No unwanted reflections
✓ No camera/DSLR reflections
✓ No black equipment reflections
✓ No scratches
✓ No dust
✓ No fingerprints
✓ No oxidation
✓ No smudges
✓ No streaks
✓ Natural metal reflections
✓ Natural diamond brilliance
✓ No artificial glitter
✓ No invented stones
✓ No missing stones
✓ No redesigned elements
✓ Extremely sharp professional finish

FINAL OUTPUT:
A photorealistic, ultra-clean, ultra-sharp, premium luxury jewelry product photograph on a completely pure white #FFFFFF background, while preserving the original jewelry exactly.

`;

module.exports = { NEW_CLEANING_PROMPT };
