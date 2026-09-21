/**
 * Reading a Brand Story narrative back into its parts.
 *
 * The model is asked for six numbered sections (see the prompt in
 * `backend/src/prompts/marketingKit.js`), and this turns that flat text into
 * something that can be laid out — a title, the body sections, and the
 * closing line that is set apart from them.
 *
 * Forgiving by design. A model that numbers its headings, omits the numbers,
 * or adds a colon all parse the same; one that ignores the format entirely
 * still yields `structured: false` and its text intact, so the caller can
 * fall back to rendering it plainly rather than showing nothing.
 */

/** The sections the prompt asks for, in the order it asks for them. */
export const STORY_SECTIONS = [
  "Collection Name",
  "Design Inspiration",
  "Design Philosophy",
  "Design Story",
  "Craftsmanship Narrative",
  "Emotional Closing",
] as const;

export type BrandStorySection = { label: string; text: string };

export type ParsedBrandStory = {
  /** The collection's name, or the first line when the model didn't label one. */
  title: string;
  /** The middle sections, in the order they appeared. */
  sections: BrandStorySection[];
  /** Set apart from the rest — it is the sign-off, not another section. */
  closing: string;
  /** Everything as one block, for an unstructured answer. */
  body: string;
  /** Whether any labelled section was found at all. */
  structured: boolean;
  /** The whole thing as plain text, for Copy and Share. */
  plainText: string;
};

export function parseBrandStory(text?: string | null): ParsedBrandStory {
  const lines = (text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const groups: BrandStorySection[] = [];
  let current: BrandStorySection | null = null;

  for (const line of lines) {
    // "1. Design Story", "Design Story:", or just "Design Story".
    const stripped = line.replace(/^\d+[.)]\s*/, "");
    const matched = STORY_SECTIONS.find((section) => stripped.toLowerCase().startsWith(section.toLowerCase()));

    if (matched) {
      if (current) groups.push(current);
      current = { label: matched, text: stripped.slice(matched.length).replace(/^[:\s—-]+/, "").trim() };
    } else if (current) {
      // A section's prose can run over several lines; join rather than drop.
      current.text = `${current.text} ${line}`.trim();
    }
  }
  if (current) groups.push(current);

  const structured = groups.length > 0;
  const named = groups.find((group) => group.label === "Collection Name");
  const closing = groups.find((group) => group.label === "Emotional Closing")?.text ?? "";
  const sections = groups.filter(
    (group) => group.label !== "Collection Name" && group.label !== "Emotional Closing" && group.text
  );

  /*
   * With no headings at all, the first line is the best guess at a title —
   * but only when it plausibly is one. A model that answers in a single
   * paragraph would otherwise have the whole thing set as a 3xl heading
   * with nothing left underneath it, so a long or lone first line is
   * treated as prose instead.
   */
  const TITLE_MAX = 80;
  const firstLine = lines[0]?.replace(/^\d+[.)]\s*/, "") ?? "";
  const firstLineIsTitle = !structured && lines.length > 1 && firstLine.length <= TITLE_MAX;

  const title = named?.text || (firstLineIsTitle ? firstLine : "");
  const body = structured ? "" : lines.slice(firstLineIsTitle ? 1 : 0).join(" ");

  const plainText = [
    title,
    ...(structured ? sections.map((section) => `${section.label}\n${section.text}`) : body ? [body] : []),
    closing,
  ]
    .filter(Boolean)
    .join("\n\n");

  return { title, sections, closing, body, structured, plainText };
}

/**
 * Whether some text reads as a Brand Story narrative.
 *
 * Used to decide how to present a stored result. Content-based on purpose:
 * History carries the text but not which Marketing Kit surface wrote it, and
 * Affinity's stored output is raw JSON — which finds no headings here and so
 * correctly declines the narrative layout.
 */
export function looksLikeBrandStory(text?: string | null) {
  return parseBrandStory(text).structured;
}
