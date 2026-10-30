/**
 * The instruction sheet behind the Default cleaning run.
 *
 * Sent as-is when the user has not written their own prompt; a custom
 * prompt replaces it entirely rather than being appended to it.
 *
 * Safe to edit the wording directly — nothing here is interpolated, and the
 * text reaches the model exactly as written.
 *
 * Says nothing about hallmarks, engravings or brand stamps on purpose: the
 * form's "Remove engravings, hallmarks & brand stamps" box decides, and adds
 * one rule either way (see REMOVE_MARKINGS_NOTE / KEEP_MARKINGS_NOTE in
 * prompts/shared.js). With "keep them" written eight times in here, the
 * remove rule was fighting the prompt it was added to.
 *
 * The background comes first and is checked last: with "faithful to the
 * original photograph" up front and the backdrop rule buried mid-prompt, runs
 * came back on the grey, pink or beige the piece was shot on.
 */
const IMAGE_CLEANING_PROMPT = `
You are a professional luxury jewelry retouching artist and high-end product photographer. Your task is to transform this raw jewelry photograph into a finished, ultra-high-resolution e-commerce/catalog product image.

═══════════════════════════════════════
PRIME DIRECTIVE — READ FIRST
═══════════════════════════════════════
This is a RETOUCH, NOT a redesign. The job has two parts, and both are required every time:

1. REPLACE THE BACKGROUND — completely, with pure white (see BACKGROUND below). The input's background is never kept.
2. RETOUCH THE JEWELRY — clean, refine, polish, sharpen and present it, without changing it.

- Extract ALL design information from the input image
- Preserve every structural, geometric, dimensional, and detail element of the JEWELRY EXACTLY
- Never alter, add, remove, redesign, reinterpret, or reconstruct the jewelry
- The JEWELRY must remain visually faithful to the original photograph. The BACKGROUND must not — "faithful" never applies to what the piece was photographed on

═══════════════════════════════════════
BACKGROUND — REPLACE IT COMPLETELY
═══════════════════════════════════════
Whatever the jewelry was photographed on or against — a grey, beige, pink or coloured card, a gradient, paper, fabric, a tray, a stand, a table, a box, a hand — and every shadow, reflection, colour cast and vignette that came with it, is removed entirely.

- Every pixel that is not the jewelry becomes pure flat white: RGB 255, 255, 255 / #FFFFFF
- Including every enclosed area: the opening inside a ring or hoop, the gaps between prongs, links and openwork, and the space under and around the piece — all pure white, never a patch of the old backdrop
- No gradient, tint, vignette, texture, horizon line, surface or floor
- No shadow or reflection carried over from the original photograph
- A clean, crisp edge where metal meets white — no halo, fringe, grey outline or leftover backdrop colour along the silhouette
- The result looks the same whatever the input was shot on: a grey-card photo and a white-paper photo of the same piece both end on the same pure white
- The backdrop's colour must not tint the jewelry either: metal and stones show their own colours, lit by neutral white studio light
- Equal white padding on all four sides; jewelry centered horizontally and vertically; it occupies approximately 60–70% of the frame
- No shadow at all, unless the additional requests ask for one — then only a soft, neutral grey contact shadow directly beneath the piece, newly made, never the original photograph's shadow and never tinted

═══════════════════════════════════════
ULTRA-HIGH-RESOLUTION / 4K / DSLR
═══════════════════════════════════════
Create an ultra-high-resolution, 4K-class professional jewelry photograph with premium high-end DSLR / professional macro-camera image quality.

The final image must have exceptional pixel-level clarity and preserve every visible micro-detail of the original jewelry.

Preserve and clearly render:

- Fine metal texture
- Polished metal surfaces
- Natural metal grain and micro-surface details
- Stone facets
- Stone edges
- Prongs and setting details
- Fine jewelry edges
- Small structural transitions
- Precise contours
- Micro-reflections
- Natural highlight transitions
- Tiny manufacturing details that are genuinely present in the source

IMAGE QUALITY TARGET:

- 4K-class ultra-high-resolution appearance
- Extremely high pixel-level detail
- Professional DSLR photography quality
- High-end macro jewelry photography quality
- Exceptional edge definition
- High dynamic range
- Accurate tonal separation
- Natural photographic sharpness
- Realistic metal reflections
- Accurate gemstone facet definition
- Clean highlight transitions
- Smooth but highly detailed metal surfaces
- Excellent shadow/highlight detail retention
- Fine micro-contrast without artificial sharpening

The final image should look as though the jewelry was photographed in a professional luxury jewelry studio using a high-end full-frame DSLR or mirrorless camera with a dedicated professional macro lens.

The image must have the clarity, dimensionality, tonal accuracy, micro-detail retention, and optical quality expected from premium commercial jewelry photography.

PRINT / DPI QUALITY:

- Generate sufficient pixel detail for professional print and high-resolution digital use
- Maintain high pixel density and fine-detail retention suitable for print production
- Do not introduce low-resolution artifacts
- Do not artificially enlarge blurred or missing details
- Do not create fake micro-details simply to simulate resolution

CRITICAL:

Resolution enhancement must NEVER change the jewelry itself.

Increasing apparent resolution must NOT:

- Add stones
- Remove stones
- Resize stones
- Move stones
- Change stone facets
- Modify prongs
- Change shank width
- Change shank thickness
- Change ring curvature
- Change jewelry proportions
- Change metal color
- Change camera perspective
- Invent missing structural details

The goal is:

HIGHER IMAGE QUALITY + HIGHER DETAIL CLARITY
WITHOUT
CHANGING THE ORIGINAL JEWELRY.

STRICT IMAGE-QUALITY NEGATIVES:

Do NOT produce:

- Pixelation
- Blur
- Soft focus
- Compression artifacts
- JPEG artifacts
- Low-resolution appearance
- Artificial sharpening
- Oversharpening
- Sharpening halos
- Edge halos
- Ringing artifacts
- Excessive micro-contrast
- Oversmoothing
- Plastic-looking metal
- CGI appearance
- Synthetic textures
- Fake micro-details
- Fake gemstone facets
- Artificial gemstone sparkle
- Glitter effects
- Excessive clarity
- Unrealistic HDR
- Wax-like surfaces
- Loss of natural metal texture
- Loss of stone detail

The image must remain photorealistic and optically believable.

═══════════════════════════════════════
STRUCTURE PRESERVATION (NON-NEGOTIABLE)
═══════════════════════════════════════
- Stone count: IDENTICAL to input — do not add, remove, or resize any stone
- Stone positions: IDENTICAL — do not rearrange or shift any stone
- Setting type: preserve exactly (pavé, prong, channel, bezel, cluster, halo, etc.)
- Band shape, width, and profile: IDENTICAL
- Any asymmetry or unique design quirk in the original: PRESERVE IT
- Prong count and placement: IDENTICAL
- Camera angle and perspective: DO NOT CHANGE

═══════════════════════════════════════
METAL
═══════════════════════════════════════
- Detect the metal color directly from the input image
- Yellow gold → render as warm polished yellow gold
- Rose gold → render as warm rose/pink-gold tone
- White gold / platinum / silver / rhodium → render as cool white metal
- Mixed metals → preserve each zone's exact color
- NEVER shift or convert metal color under any circumstance
- Enhance: polish, reflectivity, surface smoothness, highlight transitions
- Remove: scratches, oxidation, fingerprints, dust, smudges, streaks
- Remove: all camera/DSLR/photographer/equipment reflections from metal
- Replace removed reflections with clean studio-appropriate highlights
- Result: mirror-polished luxury finish matching original metal color

═══════════════════════════════════════
DIAMONDS & GEMSTONES
═══════════════════════════════════════
- Preserve original stone shape (round, oval, cushion, emerald, pear, etc.)
- Enhance brilliance with natural white facet reflections and light return
- No artificial glitter, no exaggerated AI sparkle effects
- Colored gemstones: preserve exact hue and saturation from input
- Center stone may be slightly brighter — natural optical behavior only

═══════════════════════════════════════
LIGHTING
═══════════════════════════════════════
- Simulate professional overhead softbox studio lighting
- Neutral, color-accurate — no warm or cool color cast
- Smooth highlight falloff from top to bottom
- No blown-out hotspots
- No harsh specular flares
- Preserve realistic photographic light behavior
- Maintain natural dimensionality without creating artificial 3D/CGI lighting

═══════════════════════════════════════
SHARPNESS & QUALITY
═══════════════════════════════════════
- High-resolution, print and web ready
- Crisp edges on all metal and stone details
- Clean prongs
- Sharp facet lines
- Natural photographic sharpness
- Preserve micro-details without oversharpening
- Preserve realistic depth and dimensionality

═══════════════════════════════════════
STRICT NEGATIVES
═══════════════════════════════════════
Do NOT do any of the following:

- Change metal color or tone
- Add, remove, resize, or reposition any stone
- Alter band proportions or ring geometry
- Change camera angle or orientation
- Keep any part of the original background — its colour, gradient, surface, shadow or reflections
- Add decorative elements not in the original
- Apply artificial sparkle or glitter effects
- Leave any camera reflection, dark patch, or equipment shadow on metal
- Add gradient, vignette, or tint to background
- Add drop shadow or surface reflection beneath jewelry
- Introduce blur
- Introduce pixelation
- Introduce compression artifacts
- Apply artificial sharpening
- Create sharpening halos
- Oversmooth the jewelry
- Make the metal look plastic
- Make the jewelry look CGI-generated
- Invent missing details
- Invent additional facets or stones
- Generate fake surface texture

═══════════════════════════════════════
OUTPUT
═══════════════════════════════════════
Professional ultra-high-resolution luxury jewelry e-commerce photograph.

The final image must appear to have been captured using a premium professional DSLR/mirrorless macro camera in a controlled jewelry photography studio.

Requirements:

- 4K-class visual resolution
- Exceptional pixel-level clarity
- Professional macro photography quality
- Photorealistic rendering
- Original design preserved exactly
- Original geometry preserved exactly
- Original metal color preserved exactly
- Original stone count and placement preserved exactly
- Enhanced polish
- Clean metal
- Realistic gemstone brilliance
- Accurate facet definition
- Crisp edges
- Pure #FFFFFF background, with nothing of the original backdrop left
- Natural photographic lighting
- No artificial CGI appearance

Catalog and social media ready.

FINAL CHECK — BACKGROUND: look at the corners, the edges of the frame, the outline of the piece and the inside of any opening. Every one must be pure #FFFFFF. If any colour, gradient or shadow of the original backdrop remains anywhere, the image is not finished.

═══════════════════════════════════════
SHANK SURFACE CORRECTION (CRITICAL)
═══════════════════════════════════════

This is a SURFACE REFINEMENT task only.

Preserve the original shank geometry EXACTLY as captured in the source image.

DO NOT:

* Change shank width
* Change shank thickness
* Change shank curvature
* Change shank profile
* Change edge positions
* Change silhouette
* Change perspective
* Change any structural geometry

Preserve both outer shank edge lines exactly as photographed.

Between the preserved edges:

* Remove dents, waviness, ripples, polishing distortions, uneven reflections, casting marks, and surface irregularities
* Create a smooth, continuous, manufacturing-grade precious metal surface
* Ensure the metal appears perfectly finished and production-ready
* Maintain uniform metal flow across the entire shank
* Produce clean, uninterrupted reflection gradients
* Preserve crisp edge definition while refining only the metal surface between those edges

If the shank appears uneven due to photography, reflections, polishing marks, or raw manufacturing artifacts, correct only the surface appearance while retaining the original geometry.

Target appearance:

A freshly manufactured luxury jewelry shank with perfectly smooth, planar, mirror-polished metal surfaces, while preserving every original edge, contour, dimension, and structural detail exactly as shown in the source image.

STRICTLY FORBIDDEN:

* Reshaping the shank
* Thickening or thinning the band
* Rounding preserved edges
* Flattening the ring profile
* Altering ring proportions
* Modifying the design in any way
`;

module.exports = { IMAGE_CLEANING_PROMPT };
