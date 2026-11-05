/**
 * Presentation — any pile of material turned into a clean deck, then edited
 * by chat.
 *
 * The model writes an *outline*, never coordinates: per slide a layout name
 * and the words, numbers and picture numbers that go in it. The frontend
 * (lib/presentation.ts) lays that out on fixed margins and a type scale, which
 * is what keeps the result looking designed rather than generated. These
 * prompts therefore spend their words on editorial judgement — what to say,
 * in what order, in which layout — and say nothing about placement.
 */

const LAYOUTS = [
  "title",
  "section",
  "bullets",
  "image-left",
  "image-right",
  "image-full",
  "gallery",
  "stats",
  "table",
  "quote",
  "columns",
  "timeline",
  "closing",
];

const PALETTES = ["ivory", "midnight", "minimal", "navy", "emerald", "blush", "charcoal", "terracotta"];
const HEADING_FONTS = ["Georgia", "Didot", "Garamond", "Palatino Linotype", "Cambria", "Helvetica", "Century Gothic", "Gill Sans", "Segoe UI"];
const BODY_FONTS = ["Helvetica", "Arial", "Segoe UI", "Gill Sans", "Century Gothic", "Verdana", "Georgia", "Cambria"];

const STYLES = {
  auto: "Choose the style that best suits the material and its audience.",
  luxury: "Luxury: restrained, editorial and premium — generous space, few words, large photography. Palette ivory or midnight, a serif heading font (Didot, Garamond or Georgia).",
  minimal: "Minimal: Swiss-style clarity — white space, short lines, strong hierarchy. Palette minimal, heading Helvetica or Segoe UI.",
  corporate: "Corporate: confident and data-led, the kind of deck shown to a board or a buyer. Palette navy or charcoal, heading Segoe UI or Helvetica, plenty of stats, tables and columns.",
  bold: "Bold: high contrast and energetic — short punchy titles, big numbers, full-bleed photos. Palette charcoal, midnight or terracotta.",
  editorial: "Editorial: a magazine feature — story-led, pull quotes, image-led spreads. Palette ivory, blush or emerald, a serif heading font.",
};

const LENGTHS = {
  auto: "As many slides as the material genuinely needs — usually 8 to 14. Never pad.",
  short: "5 to 7 slides.",
  medium: "8 to 12 slides.",
  long: "13 to 20 slides.",
};

const PRESENTATION_SYSTEM_INSTRUCTION = `You are a senior presentation designer and business writer at an international agency. You turn raw material — spreadsheets, old decks, documents, notes, photographs — into clear, persuasive, internationally presentable slide decks. You write in polished, plain international English (unless the brief asks for another language), you never invent facts, figures, prices or names that are not in the material, and you keep every slide focused on one idea.`;

const LAYOUT_GUIDE = `LAYOUTS — pick one per slide; each draws only the fields listed:
- "title": the cover. title (the deck's name), subtitle (one line of purpose), body (an optional short eyebrow such as a date or company name), images (optional 1 photo shown on the right half).
- "section": a divider before a group of slides. title, subtitle (optional), images (optional 1 background photo).
- "bullets": title, subtitle (optional), body (optional 1–2 sentence lead), bullets (3–6 points, each under 18 words).
- "image-left" / "image-right": one photo filling half the slide beside title, body and/or bullets (max 5 bullets). images: exactly 1.
- "image-full": one photo across the whole slide with the title and a one-line subtitle over it. images: exactly 1.
- "gallery": title, subtitle (optional), images: 2–6 photos in a grid. Use for showing several products or views.
- "stats": title, stats: 2–4 key figures, each value short ("42%", "₹3.2 Cr", "18 styles") with a label under 10 words, body (optional one-line takeaway).
- "table": title, table.headers (2–7 columns) and table.rows (each row the same length as headers, at most 10 rows per slide — split longer data across several table slides titled "… (2 of 3)"). Keep cells short.
- "quote": quote (one striking sentence), attribution (optional).
- "columns": title, columns: 2–3 columns, each heading + 2–5 short bullets. Use for comparisons, options, before/after, pillars.
- "timeline": title, steps: 3–6 steps in order, each heading (2–5 words) + text (under 22 words). Use for processes, roadmaps, history.
- "closing": the last slide. title (e.g. "Thank you" or a closing line), subtitle/body (contact details or next steps from the material — never invented), images (optional 1 background photo).`;

const WRITING_RULES = `WRITING RULES:
- Structure: cover → (agenda or overview where useful) → sections that tell a logical story → a clear summary or next steps → closing.
- Vary layouts so consecutive slides don't look the same, but always choose the layout that fits the content.
- Titles are short and specific (under 8 words where possible) — say the point, not the topic ("Rings drive 60% of revenue", not "Revenue").
- Every number, price, code, name and date must come from the material. If the material has a table of products or prices, present it faithfully (table or gallery slides), keeping style/design numbers exactly as written.
- Use the photographs: products belong on image, gallery, title or section slides. Refer to a picture only by its number in the IMAGES list (1-based). Never use the same picture on more than two slides. A rendered page of a document is reference material — only place it if it is genuinely presentable.
- Put anything a presenter should say but the slide shouldn't show in "notes".
- Each slide gets an "id": "s1", "s2", … in order.`;

/** The first run's brief. */
function buildPresentationPrompt({ brief, style, length, imageCount, sourceCount }) {
  return `Build a presentation from the material above.

THE USER'S BRIEF: ${brief ? `"${brief}"` : "(none given — infer the purpose and audience from the material and make a clean, internationally presentable deck)"}

STYLE: ${STYLES[style] || STYLES.auto}
LENGTH: ${LENGTHS[length] || LENGTHS.auto}
MATERIAL: ${sourceCount} document${sourceCount === 1 ? "" : "s"} and ${imageCount} picture${imageCount === 1 ? "" : "s"}.${
    !sourceCount && !imageCount ? " There is no material beyond the brief — write the content from the brief, keeping claims general and avoiding specific made-up figures." : ""
  }

THEME: choose "palette" from ${PALETTES.join(", ")}; "headingFont" from ${HEADING_FONTS.join(", ")}; "bodyFont" from ${BODY_FONTS.join(", ")}.

${LAYOUT_GUIDE}

${WRITING_RULES}

ALSO RETURN "imageNotes": one short line per picture, in order (exactly ${imageCount} entries), saying what it shows — e.g. "gold ring with emerald centre stone, front view" — so the deck can be edited later without seeing the pictures again.

Return only the JSON.`;
}

/** A chat edit: the whole outline back, changed as asked and otherwise identical. */
function buildPresentationEditPrompt({ outline, imageNotes, history, instruction }) {
  const pictures = imageNotes.length
    ? imageNotes.map((note, n) => `IMAGE ${n + 1}: ${note || "(no description)"}`).join("\n")
    : "(no pictures)";
  const earlier = history.length
    ? history.map((message) => `${message.role === "user" ? "USER" : "YOU"}: ${message.text}`).join("\n")
    : "(this is the first edit)";

  return `You are editing an existing presentation. Here it is as JSON:

${JSON.stringify(outline)}

PICTURES AVAILABLE (refer to them by number):
${pictures}

EARLIER IN THIS CONVERSATION:
${earlier}

THE USER NOW ASKS: "${instruction}"

Apply exactly what is asked and nothing else:
- Return the WHOLE presentation, every slide, in the same JSON shape.
- Keep every slide the request doesn't concern byte-for-byte identical — same id, same fields, same words. This matters: unchanged slides keep the user's manual edits.
- A changed slide keeps its id. A new slide gets a new id ("n1", "n2", … never reusing one). A removed slide is simply left out.
- "Slide 3" means the third slide in the current order.
- Theme requests ("make it darker", "more corporate colours", "use a serif font") change "theme" only, using the allowed values: palette ${PALETTES.join(", ")}; headingFont ${HEADING_FONTS.join(", ")}; bodyFont ${BODY_FONTS.join(", ")}.
- Never invent facts, prices or names; if the user supplies new facts in their message, use them.

${LAYOUT_GUIDE}

Also return "reply": one or two friendly sentences telling the user what you changed (or, if the request can't be done, why and what you did instead).

Return only the JSON.`;
}

/** Built lazily, like Affinity's, so the API process never loads the Gemini SDK. */
function PRESENTATION_RESPONSE_SCHEMA({ forEdit = false } = {}) {
  const { Type } = require("@google/genai");
  const strings = { type: Type.ARRAY, items: { type: Type.STRING } };
  const slide = {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING },
      layout: { type: Type.STRING, enum: LAYOUTS },
      title: { type: Type.STRING },
      subtitle: { type: Type.STRING },
      body: { type: Type.STRING },
      bullets: strings,
      images: { type: Type.ARRAY, items: { type: Type.INTEGER } },
      stats: {
        type: Type.ARRAY,
        items: { type: Type.OBJECT, properties: { value: { type: Type.STRING }, label: { type: Type.STRING } }, required: ["value", "label"] },
      },
      table: {
        type: Type.OBJECT,
        properties: { headers: strings, rows: { type: Type.ARRAY, items: strings } },
        required: ["headers", "rows"],
      },
      quote: { type: Type.STRING },
      attribution: { type: Type.STRING },
      columns: {
        type: Type.ARRAY,
        items: { type: Type.OBJECT, properties: { heading: { type: Type.STRING }, bullets: strings }, required: ["heading", "bullets"] },
      },
      steps: {
        type: Type.ARRAY,
        items: { type: Type.OBJECT, properties: { heading: { type: Type.STRING }, text: { type: Type.STRING } }, required: ["heading", "text"] },
      },
      notes: { type: Type.STRING },
    },
    required: ["id", "layout", "title"],
  };

  return {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING },
      theme: {
        type: Type.OBJECT,
        properties: {
          palette: { type: Type.STRING, enum: PALETTES },
          headingFont: { type: Type.STRING, enum: HEADING_FONTS },
          bodyFont: { type: Type.STRING, enum: BODY_FONTS },
        },
        required: ["palette", "headingFont", "bodyFont"],
      },
      slides: { type: Type.ARRAY, items: slide },
      ...(forEdit ? { reply: { type: Type.STRING } } : { imageNotes: strings }),
    },
    required: ["title", "theme", "slides", ...(forEdit ? ["reply"] : ["imageNotes"])],
  };
}

module.exports = {
  LAYOUTS,
  PALETTES,
  HEADING_FONTS,
  BODY_FONTS,
  STYLES,
  LENGTHS,
  PRESENTATION_SYSTEM_INSTRUCTION,
  buildPresentationPrompt,
  buildPresentationEditPrompt,
  PRESENTATION_RESPONSE_SCHEMA,
};
