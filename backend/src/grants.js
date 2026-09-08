/**
 * The catalogue of grants this application understands. The admin console
 * offers exactly these, and every write validates against them — so a typo
 * like "tool.cleanning.run" fails loudly instead of silently hiding a tool.
 *
 * The tool keys are also the `toolKey` values `dataScope.toolKeys` limits, and
 * they must match the ids in `frontend/lib/nav.ts`. A key on only one side is
 * a tool nobody can reach.
 */
const TOOLS = [
  { key: "cleaning", label: "Image Cleaning" },
  { key: "life_style", label: "Lifestyle" },
  { key: "image_to_video", label: "Image to Video" },
  { key: "text_to_image", label: "Text to Image" },
  { key: "text_to_sketch", label: "Text to Sketch" },
  { key: "sketch_to_image", label: "Sketch to Image" },
  { key: "image_to_text", label: "Image to Text" },
  { key: "image_to_sketch", label: "Image to Sketch" },
  { key: "marketing_kit", label: "Marketing Kit" },
  { key: "chat_to_edit", label: "Chat to Edit" },
];

const TOOL_KEYS = TOOLS.map((tool) => tool.key);

// Grouped so the console can render them as sections rather than one flat list.
const GRANT_GROUPS = [
  {
    id: "tools",
    label: "Tools",
    grants: [
      { grant: "tool.*.run", label: "All tools", hint: "Covers every tool, including ones added later" },
      ...TOOLS.map((tool) => ({ grant: `tool.${tool.key}.run`, label: tool.label })),
    ],
  },
  {
    id: "results",
    label: "Results",
    grants: [
      { grant: "result.read.own", label: "See their own results", hint: "Required for the History page" },
      { grant: "result.read.others", label: "See other people's results", hint: "How far this reaches is set by the data scope" },
    ],
  },
];

const ALL_GRANTS = GRANT_GROUPS.flatMap((group) => group.grants.map((entry) => entry.grant));

/** Returns the entries of `list` that aren't in the catalogue. */
function unknownGrants(list) {
  return (list || []).filter((grant) => !ALL_GRANTS.includes(grant));
}

module.exports = { TOOLS, TOOL_KEYS, GRANT_GROUPS, ALL_GRANTS, unknownGrants };
