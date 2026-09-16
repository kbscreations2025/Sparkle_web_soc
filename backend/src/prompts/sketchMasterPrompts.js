/* ── SKETCH MASTER PROMPTS ────────────────────────────────────────────────────
   Shared by both app/api/text-to-sketch/route.ts and
   app/api/image-to-sketch/route.ts. Pencil, gouache, charcoal and ink are each
   special-cased with their own dedicated master prompt below instead of the
   generic per-style wrapper each route otherwise uses. These are the only
   sketch styles offered in the UI. */

const PENCIL_MASTER_PROMPT = `
Create a highly realistic professional luxury jewellery designer presentation sketch that appears to have been hand-drawn by an experienced jewellery designer during the final refinement stage of a luxury jewellery design review.

The artwork should resemble an authentic designer presentation sheet prepared for internal design approval or a premium client presentation—not a rough sketchbook page, not a CAD drawing, not technical drafting, and never an AI-generated illustration.

The page should communicate the confidence, refinement, and craftsmanship of a senior jewellery designer. Every pencil stroke should feel intentional, naturally drawn, and developed over multiple drawing passes.

The overall appearance should be elegant, clean, believable, and unmistakably handmade.

OVERALL COMPOSITION

Create one dominant hero jewellery drawing occupying most of the page.

Support it with only a few carefully placed secondary studies that reinforce the design.

The composition should contain generous white space with excellent visual balance.

The hero sketch must immediately attract attention while every supporting element remains visually subordinate.

Avoid clutter.

Avoid brainstorming layouts.

Avoid crowded pages.

The presentation should resemble a luxury jewellery design approval sheet.

HERO DRAWING

The main jewellery sketch should appear approximately 95–98% complete.

The proportions should be refined.

Perspective should feel naturally constructed.

Stone placement should be precise.

Metal forms should appear elegant and well resolved.

The drawing should preserve the feel of graphite rather than polished illustration.

Every contour should show subtle evidence of human drawing.

Avoid perfectly clean digital outlines.

Allow natural pressure variation.

Allow tiny overlaps.

Allow occasional double-pass contour corrections.

Some contour lines may become slightly darker after repeated refinement.

CONSTRUCTION LINES (MOST IMPORTANT)

The construction geometry should behave exactly like a professional jewellery designer's underdrawing, similar to the supplied reference images.

The construction layer exists only to explain how the jewellery was built and should never compete with the final drawing.

Use extremely light graphite, approximately 10–20% of the darkness of the finished object.

Construction lines should appear as if they were drawn first with a hard pencil (2H–4H), while the final jewellery was refined later with softer graphite (HB–2B).

The construction geometry must remain behind the finished jewellery, almost fading into the paper.

Include only construction guides that genuinely assist the design:

centre axis
vertical symmetry line
horizontal alignment guides
construction circles
ellipse guides
radial divisions beneath centre stones
gemstone placement arcs
proportion guides
mounting geometry
spacing guides
bezel alignment circles
gallery construction references

These guides should:

remain very thin
remain extremely light
partially disappear beneath darker contours
fade naturally toward the edges
occasionally be partially erased
never dominate the drawing
never have dark outlines
never appear technical or mechanical
never resemble CAD wireframes
never use perfectly even opacity

Many construction lines should stop naturally where the designer refined the drawing instead of extending continuously across the page.

The finished jewellery must always be visually stronger than the construction layer.

When viewed from a distance, the construction lines should almost disappear while still adding authenticity.

LINE QUALITY

The pencil work should display natural graphite variation throughout.

Include:

subtle pressure changes
tapered pencil endings
tiny line corrections
occasional double-pass contours
slight graphite build-up on refined edges
naturally broken pencil strokes
overlapping contour refinement
softer internal lines
darker silhouette edges

Avoid:

vector smoothness
CAD precision
perfectly continuous outlines
mechanically identical line weights
ruler-perfect curves
GRAPHITE TEXTURE

Use authentic graphite rendering.

Include:

visible paper tooth
delicate graphite grain
layered pencil deposits
subtle tonal transitions
light graphite bloom
realistic pencil texture

Graphite should remain clean and refined.

Avoid dirty smudges.

Avoid heavy graphite dust.

Avoid digital airbrush effects.

SHADING

Use restrained graphite rendering.

Apply shading only where necessary to explain volume.

Include:

soft contour shading
localized cast shadows beneath settings
gentle edge darkening
subtle cross-hatching
directional graphite strokes
delicate tonal gradients

Keep the jewellery bright and readable.

Avoid dramatic illustration rendering.

Avoid dark artistic shading.

NO DIMENSIONS, NO HANDWRITTEN NOTES

Do NOT include any dimensions, measurements, measurement arrows, or numbers anywhere on the page (no band width, gallery height, bezel diameter, carat/mm callouts, or similar).

Do NOT include any handwritten design comments, review notes, labels, or annotations of any kind (no "refine shoulder", "adjust bezel", stone/setting callouts, or similar) — no handwriting or text should appear anywhere on the page.

MINI DETAIL STUDIES

Include only a few supporting studies.

Examples:

one side profile
one top view
one prong detail
one setting cross-section
one stone layout

These should remain small and understated.

Avoid multiple design alternatives.

Avoid concept exploration.

Avoid repeated thumbnails.

ERASER EVIDENCE

Show only subtle correction work.

Examples include:

partially erased construction circles
softened guide lines
lightly lifted graphite
faded alignment marks

Corrections should feel intentional and professional.

Never create messy erased areas.

HUMAN IMPERFECTIONS

Introduce believable imperfections without reducing accuracy.

Examples include:

slight pressure variation
tiny contour corrections
naturally overlapping pencil strokes
minor graphite inconsistencies
softened intersections
lightly broken pencil lines

The jewellery itself should remain highly accurate and professionally executed.

PAPER

Use premium white drawing paper with a fine tooth.

The paper should remain clean.

No stains.

No notebook texture.

No decorative backgrounds.

No overlays.

STRICTLY AVOID
AI-generated appearance
CAD rendering
vector artwork
blueprint style
dark construction lines
construction lines equal in weight to the jewellery
excessive guide geometry
brainstorming pages
sketchbook clutter
random scribbles
decorative doodles
repeated concepts
any dimensions, measurements, or measurement arrows
any handwritten notes, review comments, labels, or annotations
typed annotations
ruler-perfect geometry
uniform line weight
over-rendered graphite
dramatic artistic shading
messy erasing
dirty graphite smears
mechanical symmetry
digital illustration style
FINAL VISUAL GOAL

The final image should be indistinguishable from a presentation sketch created by a senior jewellery designer in a luxury jewellery studio.

The hero drawing should appear beautifully refined while the construction geometry quietly reveals the designer's process.

The construction lines must always remain significantly lighter than the finished jewellery, behaving like faint underdrawing rather than visible outlines. They should appear softly embedded within the paper, gently fading beneath the darker contours, exactly as seen in traditional graphite jewellery presentation sketches. From a normal viewing distance, the eye should immediately focus on the finished jewellery, while the delicate construction guides subtly reinforce the authenticity of the hand-drawn process without ever competing for attention. This layered hierarchy between light construction graphite and confident finished pencil work is essential to achieving the look of a genuine luxury jewellery designer's presentation sheet.
`

const GOUACHE_MASTER_PROMPT = `
PROFESSIONAL LUXURY JEWELLERY GOUACHE RENDERING
Overall Goal

Create an authentic luxury jewellery gouache rendering that is visually indistinguishable from artwork produced by an experienced jewellery designer. The final image must never resemble AI-generated digital art, CGI, vector illustration, 3D rendering, or concept art. Every mark should feel manually created by a skilled human hand over several hours using traditional illustration techniques.

The rendering should communicate craftsmanship, precision, artistic judgment, and subtle human imperfections while preserving the exact jewellery structure.

Paper

Render on premium hot-pressed artist illustration board specifically used for jewellery rendering.

Paper characteristics:

• smooth but not perfectly smooth

• subtle compressed cotton fibers

• ultra fine tooth

• soft natural grain visible only in highlights

• museum-quality archival board

• light warm grey neutral paper

• approximately 300–500 gsm

• slight paper absorbency

• pigment softly settles into microscopic paper texture

• edges of painted regions exhibit tiny natural pigment diffusion

• no digital gradients

• no plastic smoothness

• no synthetic texture overlays

The paper itself should become part of the artwork.

Never use a perfectly flat background.

Tiny paper fibers must remain visible across the entire sheet.

Traditional Medium

The artwork should appear to be created entirely using

Designer Gouache

Opaque Watercolour

Traditional Illustration Gouache

Small amounts of coloured pencil

Graphite

White gouache highlights

Occasional dry brush

Very fine technical brushwork

No digital painting appearance.

No airbrush look.

No Photoshop blending.

No vector edges.

Colour Behaviour

Colours should behave exactly like real gouache pigments.

Characteristics:

Opaque

Velvety

Matte

Rich pigment density

Multiple transparent glazing layers

Visible layering

Pigment accumulation near edges

Natural tonal transitions

Soft brush overlap

Slight colour temperature variation

Tiny pigment inconsistencies

Microscopic variations between adjacent brush strokes

Never use perfectly uniform colour fills.

Brushwork

Brush strokes should remain visible under magnification.

Use:

Series 7 sable brush appearance

Size 000

Size 00

Size 0

Tiny controlled flat brushes

Extremely controlled miniature brush marks

Every filled region should contain subtle evidence of hand painting.

Brush direction should follow jewellery geometry.

Metal follows curvature.

Gemstones follow facets.

Pearls follow sphere.

Feathers follow growth direction.

Leaves follow veins.

Never paint using digital gradient fills.

Human Imperfections

The artwork must intentionally preserve subtle imperfections that exist in real master artwork.

Examples:

Tiny variation in pigment density

Microscopic edge wobble

Slightly uneven pressure

Small differences in brush overlap

Tiny variation in opacity

Very subtle paint pooling

Natural hand rhythm

Slight graphite residue

Nearly invisible construction corrections

Occasional softened edge

Tiny lifted highlights

Natural drying transitions

Nothing should appear mathematically perfect.

Pencil Work

Before painting, the drawing should visibly contain a professionally drafted jewellery sketch.

Use

2H construction

HB refinement

Soft graphite detailing

Very clean drafting

Light erased guidelines, fully absorbed beneath the paint so no construction line, axis, crosshair, or grid mark remains visible in the finished piece

No heavy sketch lines.

No cartoon outlines.

No visible construction lines, symmetry axes, crosshairs, or alignment grid anywhere in the final image.

Metal Rendering

Metal should be painted using layered gouache.

No chrome.

No CGI reflections.

Instead use:

Controlled value shifts

Soft reflected light

Warm and cool transitions

Selective edge highlights

Tiny lost edges

Very soft ambient reflection

Natural oxidation variations

Fine brush modulation

Hand painted reflections

Metal should feel painted rather than rendered.

Diamond Rendering

Diamonds should not look photorealistic.

Instead they should resemble traditional jewellery illustration.

Use

Carefully painted facet planes

Controlled white gouache highlights

Grey value structure

Very subtle cool blue reflections

Tiny sharp sparkle accents

Visible brush construction

Hand-painted brilliance

No digital glow.

No lens flares.

No artificial sparkle effects.

Coloured Gemstones

Gemstones should be painted through transparent glazing.

Multiple pigment layers.

Visible depth.

Internal colour zoning.

Natural inclusions suggested subtly.

Rich saturated centre.

Softer edges.

Painted facets.

White gouache accents.

Tiny reflected colour onto nearby metal.

Pearls

Pearls should appear hand painted.

Soft spherical modelling.

Multiple semi-opaque gouache layers.

Tiny cool reflected light.

Warm core shadow.

Subtle white highlight.

No airbrush.

No CGI sphere.

Decorative Details

Millgrain

Filigree

Engraving

Micro pavé

Feathers

Leaves

Petals

All decorative details must be painted individually with miniature brushwork.

Nothing should repeat identically.

Tiny human variation between decorative motifs.

Colour Palette

Muted artist pigments.

Never oversaturated.

Typical pigments:

Titanium White

Ivory Black

Payne's Grey

Neutral Tint

Burnt Umber

Raw Umber

Yellow Ochre

Permanent Rose

Alizarin Crimson

Opera Rose (very sparingly)

Ultramarine

Cerulean

Viridian

Permanent Green

Emerald Green

Cobalt Blue

Indigo

Naples Yellow

Transparent Oxide Brown

The palette should resemble real gouache paint rather than digital RGB colours.

Lighting

Soft north-light studio illumination.

No HDR.

No dramatic CGI lighting.

No bloom.

Controlled shadow.

Painted reflected light.

Matte appearance.

Natural artist interpretation.

Composition

Centered jewellery.

Large surrounding paper margin.

Museum presentation.

Balanced composition.

Professional design-sheet appearance.

No decorative background.

No props.

No unnecessary elements.

Finish

The final artwork should resemble a museum-quality jewellery design board produced for luxury maisons.

It should look as though it has been hand painted over many hours by an experienced jewellery gouache artist.

The viewer should notice:

subtle paper tooth beneath every painted area
layered gouache pigment rather than digital gradients
visible but controlled brush direction
slight variations in opacity from overlapping strokes
natural drying edges where gouache has settled
tiny imperfections that reveal the rhythm of a human hand
carefully painted facet planes instead of photorealistic reflections
crisp yet organic edges without vector-like precision
restrained colour harmony using traditional artist pigments
an overall feeling of craftsmanship, patience, and manual execution
Negative Prompt

Do not generate:

AI-generated illustration style
digital painting
CGI rendering
3D render
photorealistic product render
airbrush gradients
vector illustration
concept art
anime style
cartoon style
comic style
cell shading
perfectly uniform colour fills
plastic-looking metal
mirror-like chrome reflections
excessive bloom or glow
HDR lighting
lens flares
fake sparkle effects
repeated ornamental patterns
mathematically perfect symmetry in brushwork
perfectly clean edges without natural paint variation
smooth digital gradients
texture overlays that appear artificial
oversaturated colours
watercolor bleeding inconsistent with gouache
thick black outlines
text, signatures, logos, watermarks, borders, or frames
visible construction lines, symmetry axes, crosshairs, alignment grids, or any other underdrawing geometry left visible in the final image
`

const CHARCOAL_MASTER_PROMPT = `
Create a museum-quality handmade charcoal jewellery drawing that looks unmistakably created by an experienced traditional artist over several hours—not by AI.

The artwork must resemble a professional charcoal study executed on heavyweight cold-pressed white drawing paper using vine charcoal, willow charcoal, compressed charcoal sticks, charcoal pencils (HB–8B equivalent), kneaded eraser lifting techniques, blending stumps, tissue blending and dry brush dusting.

ABSOLUTE GOAL
Every stroke should appear intentional, imperfect, confident and naturally human. The artwork should immediately resemble a portfolio piece from a professional fine art charcoal illustrator or jewellery concept artist.

ARTISTIC PHILOSOPHY
Never fully render the drawing. Allow parts of the jewellery to remain suggestive. Some edges disappear. Some forms dissolve into paper. Some areas contain unfinished charcoal indications. The viewer should mentally complete missing information. The drawing should breathe. Avoid digital perfection.

LINE QUALITY
Use naturally varied charcoal strokes. Pressure constantly changes. Never use uniform outlines. Build forms with overlapping strokes. Allow broken charcoal texture. Visible grain from paper. Occasional accidental charcoal skips. Tiny hand tremors. Natural pressure inconsistencies. Random charcoal dust. Lost construction marks. Light searching lines underneath final drawing. Some erased corrections remain visible. Avoid smooth vector lines.

EDGE CONTROL
Only 10–20% of edges are crisp. Most edges are soft. Many edges disappear completely. Metal reflections merge into paper. Some gemstones fade softly. Back portions of jewellery remain unfinished. Necklace chains gradually dissolve. Ring interiors lose definition. Bracelet interiors become atmospheric. The drawing should feel alive.

VALUE STRUCTURE
Maximum contrast only at the focal point. Use approximately 5% deepest compressed charcoal blacks, 15% dark charcoal, 35% middle values, 30% soft charcoal haze, 15% untouched white paper. Never over-darken everything. Allow paper white to function as light. Avoid equal contrast across the drawing.

CHARCOAL APPLICATION
Use vine charcoal for early block-in, compressed charcoal for darkest accents, charcoal pencil for structural edges, soft charcoal powder for gradients, kneaded eraser for highlights. Visible charcoal particles. Natural smudging. Charcoal dust accumulation. Paper tooth visible everywhere. Never create digitally smooth gradients.

LIGHTING
Single directional studio light. Strong light hierarchy. Deep core shadows. Soft reflected light. Subtle bounce light. Large shadow masses. Never outline highlights. Highlights are lifted with eraser—not painted.

JEWELLERY SURFACES
Treat jewellery as sculptural forms. Render planes—not outlines. Polished metals should be suggested using charcoal value transitions instead of white reflections. Bright reflections are created by preserved paper. Never over-render mirror reflections. Metal feels heavy. Edges transition gradually. Reflections break naturally. Dark reflected shapes remain soft.

DIAMONDS & GEMSTONES
Draw gemstones as faceted forms. Never use sparkle effects. Never draw stars. Never add artificial glows. Each facet receives different charcoal value. Paper white creates brilliance. Small lifted highlights. Internal facets remain believable. Different stones have slightly different values.

DEPTH
Highest detail only in focal area. Medium detail around it. Minimal rendering elsewhere. Background fades naturally. Perspective created through value—not outlines.

COMPOSITION
Large breathing space. Comfortable margins. Professional portfolio layout. No decorative backgrounds. Only faint charcoal atmosphere if needed.

TEXTURE
Visible charcoal grain. Paper tooth everywhere. Broken texture. Dry brush effects. Random charcoal dust. Natural smears. Finger blending marks. Soft stump blending. Tiny imperfections. Nothing mechanically repetitive.

HUMAN IMPERFECTIONS
Extremely subtle asymmetry. Microscopic line wobble. Natural correction marks. Visible erased construction. Tiny charcoal fingerprints. Slight pressure changes. Uneven blending. Random charcoal deposits. Occasional ghost lines. These imperfections should feel accidental—not designed.

NEGATIVE PROMPT
No AI rendering. No digital painting. No smooth gradients. No airbrush. No CGI. No vector lines. No perfect symmetry. No equal line weight. No over-sharpening. No photobash. No glossy rendering. No lens effects. No bloom. No HDR. No glowing gemstones. No fake sparkles. No artificial texture overlays. No repetitive strokes. No mechanical shading. No uniformly finished surfaces. No plastic appearance. No perfectly clean paper. No mathematical precision. No hyper-clean edges. No synthetic charcoal texture. No computer-generated crosshatching.

FINAL FEELING
The drawing should convince experienced charcoal artists that it was created entirely by hand over multiple sittings. It should contain the confidence, restraint, imperfections, decision-making, value hierarchy, and expressive mark-making found in master charcoal atelier studies. The image should feel like an original physical artwork scanned from paper, preserving every nuance of charcoal dust, paper tooth, erased highlights, unfinished passages, and naturally evolving hand movements.
`

const INK_MASTER_PROMPT = `
Create an authentic hand-drawn ink line illustration exactly as if produced by an experienced jewellery concept artist working traditionally on paper.

The artwork must NEVER resemble AI-generated line art.

Instead, it should feel like an original drawing created over time by a skilled illustrator using black archival ink, technical pen, fountain pen, dip pen, fineliner, or ballpoint.

The drawing should contain genuine evidence of human thought, observation and hand movement.

----------------------------------------------------
DRAWING PROCESS
----------------------------------------------------

The illustration should appear built gradually.

Start with extremely light construction thinking that subtly influences the final drawing.

Do not erase every guide mentally—allow tiny traces of planning.

Some contours should be drawn once.

Others should be slightly corrected.

Certain lines may overlap by fractions of a millimeter.

Corners should not connect perfectly.

Tiny alignment imperfections should naturally exist.

----------------------------------------------------
LINE QUALITY
----------------------------------------------------

Line weight must constantly change.

Some contours:

• thick
• thin
• broken
• fading
• reinforced
• barely visible

Pressure should naturally vary.

No digital smoothness.

No vector precision.

No mathematically clean curves.

Allow tiny hand tremors.

Occasional pen skips.

Slight ink pooling at slow turns.

Natural drying inconsistencies.

Some strokes should end abruptly.

Others should taper softly.

Never make every contour equally dark.

----------------------------------------------------
HATCHING
----------------------------------------------------

All shading must be produced only with hand-made ink techniques.

Use:

Directional hatching

Cross hatching

Loose parallel strokes

Contour hatching

Feathering

Broken hatching

Sparse texture lines

Never use smooth digital gradients.

Never use airbrush.

Never use grayscale fills.

Hatching density should naturally vary.

Some regions heavily built.

Others almost untouched.

Stroke directions should follow the jewellery form.

Around curves:

allow hatching to bend.

Around gemstones:

allow lighter spacing.

Metal surfaces:

minimal shading.

Deep cavities:

dense cross hatching.

----------------------------------------------------
JEWELLERY DESIGN THINKING
----------------------------------------------------

The jewellery should feel designed by an experienced jewellery artist.

Preserve:

stone placement

prongs

bezels

micro pavé

engraving

filigree

gallery

metal thickness

symmetry

manufacturable proportions

Every decorative element should appear intentionally drawn.

Avoid repeated identical motifs.

Tiny variations between repeated stones are encouraged.

Small inconsistencies make the illustration believable.

----------------------------------------------------
DETAIL PRIORITY
----------------------------------------------------

Render only important areas completely.

Secondary areas may remain lightly indicated.

Some edges may disappear into white paper.

Some ornamentation may only be suggested.

Avoid fully outlining everything.

Use selective focus.

----------------------------------------------------
INK TEXTURE
----------------------------------------------------

Ink should naturally show:

minor feathering

slightly darker overlaps

occasional dry pen texture

paper tooth interaction

tiny ink accumulations

micro inconsistencies

No perfectly solid digital blacks.

----------------------------------------------------
PAPER
----------------------------------------------------

Natural white drawing paper.

Visible paper grain.

Subtle paper fibers.

No artificial texture overlays.

No dramatic stains.

No digital canvas.

No background graphics.

----------------------------------------------------
COMPOSITION
----------------------------------------------------

Leave generous white space.

The drawing should breathe.

Avoid perfectly centered placement.

Allow natural sketchbook composition.

----------------------------------------------------
HUMAN IMPERFECTIONS
----------------------------------------------------

Include subtle evidence of real drawing:

tiny overshoots

slight corrections

unfinished areas

hesitation marks

confident long strokes

quick gesture lines

minor asymmetry

tiny proportion adjustments

occasional double contour

small intersections

natural rhythm

No ruler-perfect geometry.

----------------------------------------------------
LIGHT
----------------------------------------------------

Do not shade everything equally.

Artist decides where to place contrast.

High contrast near focal jewellery.

Minimal rendering elsewhere.

Use white paper as the brightest highlight.

----------------------------------------------------
STYLE
----------------------------------------------------

Professional jewellery concept illustration.

Luxury design studio sketch.

Traditional ink illustration.

Editorial fashion sketch quality.

Museum sketchbook quality.

Handcrafted artistic aesthetic.

----------------------------------------------------
NEGATIVE PROMPT
----------------------------------------------------

NO AI line art

NO vector appearance

NO perfect symmetry

NO perfectly clean contours

NO digital smoothing

NO uniform line weight

NO generated texture

NO procedural cross hatching

NO mirrored details

NO mechanical repetition

NO synthetic gradients

NO photoreal rendering

NO CGI

NO plastic appearance

NO over-clean edges

NO excessive ornament repetition

NO identical gemstones

NO mathematical perfection

NO perfectly closed contours everywhere

NO flawless geometry

The final artwork must convince even experienced illustrators that it was created manually by a professional jewellery artist using real ink on paper over multiple drawing sessions.


traditional ink sketchbook illustration,
museum-quality concept drawing,
visible artist decision making,
organic pen pressure,
imperfect human rhythm,
non-uniform contour hierarchy,
natural observational drawing,
editorial ink illustration,
luxury jewellery concept sketch,
real fineliner texture,
dip pen rendering,
fountain pen character,
broken contour lines,
directional cross hatching,
paper grain interaction,
unfinished artistic edges,
confident yet imperfect craftsmanship,
authentic analogue drawing,
hand-built illustration,
looks scanned from an original artwork,
indistinguishable from a manually inked drawing.
`

module.exports = { PENCIL_MASTER_PROMPT, GOUACHE_MASTER_PROMPT, CHARCOAL_MASTER_PROMPT, INK_MASTER_PROMPT };
