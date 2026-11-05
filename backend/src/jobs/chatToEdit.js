const { buildChatEditPrompt, buildReferenceNote, SCALE_NOTE, ANATOMY_NOTE } = require("../prompts");
const { hasRoleTask, buildRolePrompt, orderImages, describeRoles } = require("../prompts/chatToEdit");
const { detectIntent, intentForTool, refineCountFor, applyIntentToPrompt, describeIntent } = require("../prompts/intent");
const { matchColour, wantsColourChange } = require("../services/colorMatch");
const { resolveProviderModel, routeProviderCall } = require("../aiRouting");
const { recordGeneration } = require("../generationService");
const { createLivePreview } = require("../storage/thumbnail");
const { registerJobHandler } = require("./registry");
const { loadJobActor } = require("./actor");
const { toResult, historyPrompt } = require("./generationRunner");

const CHAT_TO_EDIT_JOB = "chatToEdit.generate";
const TOOL = "chat_to_edit";

/**
 * One Chat to Edit turn, run off the request that asked for it — the same
 * work the route used to do while the browser waited: build the turn's
 * prompt(s), call the model, pull each result's colour back where that won't
 * undo the request, and record it. Running here instead puts the turn in the
 * queue rail with a progress bar and a live preview, and lets it outlive a
 * reload or a closed tab.
 *
 * `data` is the BullMQ payload, images already parsed as `{ mimeType, base64 }`:
 *   · `image`       the photo or result this turn edits
 *   · `references`  attachments, each `{ image, role }` (role already resolved)
 *   · `intent`, `count`, `intentLabel`  what the route read the turn as, for
 *                   a turn with no attachment job (see prompts/intent.js)
 */
async function runChatToEditJob({ job, data, setProgress, withProgress }) {
  const { dbUser, tenant } = await loadJobActor(job);
  const { provider, model, quality, modelLabel } = resolveProviderModel(data.requestedModel, data.requestedQuality);

  const instruction = String(data.instruction || "").trim();
  const base = data.image;
  const references = data.references ?? [];
  const parsedReferences = references.map((entry) => entry.image);
  const roles = references.map((entry) => entry.role);

  let prompts;
  let images;
  let intentLabel = data.intentLabel ?? null;
  /** The image each result's colour is pulled back to, or null where matching would undo the request. */
  let colourAnchor = null;

  if (hasRoleTask(roles)) {
    /*
     * An attachment with a job — a piece to put in, a stone to set, a
     * texture, a person to wear it (see prompts/chatToEdit.js). One image:
     * these are precise edits, not a spread of options.
     */
    const { order, colourAnchor: anchor } = orderImages(roles);
    images = order.map((slot) => (slot.role === "base" ? base : parsedReferences[slot.ref]));
    prompts = [buildRolePrompt({ instruction, roles })];
    intentLabel ??= describeRoles(roles);
    // Worn on a scene: the scene's own colours are the truth. A stone swap
    // barely moves the photo's colours, so the base anchors it. A new piece
    // or a texture can change the metal itself — matching the whole frame
    // back would pull the new metal towards the old one.
    const changesMetal = roles.some((role) => role === "piece" || role === "texture" || role === "wear");
    if (anchor.ref !== null) colourAnchor = parsedReferences[anchor.ref];
    else if (!changesMetal && !wantsColourChange(instruction)) colourAnchor = base;
  } else {
    /*
     * What the turn asks for was read in the route, before pricing — "more
     * designs" makes several images, each told to differ; "make it a
     * pendant" or "in rose gold" reshape the prompt. Re-read here only for a
     * job queued without it.
     */
    const intent = intentForTool(data.intent ?? detectIntent(instruction), TOOL);
    const count = Math.max(1, Number(data.count) || refineCountFor(intent, TOOL));
    const basePrompt = buildChatEditPrompt(instruction, parsedReferences.length);
    prompts = Array.from({ length: count }, (_, index) =>
      applyIntentToPrompt({
        basePrompt,
        instruction,
        intent,
        tool: TOOL,
        referenceNote: [buildReferenceNote(parsedReferences.length).trim(), SCALE_NOTE, ANATOMY_NOTE].filter(Boolean).join(" "),
        variationIndex: index,
        variationTotal: count,
      })
    );
    images = [base, ...parsedReferences];
    intentLabel ??= describeIntent(intent, TOOL, count);
    // Each edit is a full redraw, and the redraw drifts warm and pink turn
    // after turn — the prompt alone never stopped it (see colorMatch.js).
    // Not where the turn means to change colour, metal, background or the
    // design itself: there the shift is the request.
    const intended = ["metal", "background", "explore", "type_change"].some((kind) => intent.kinds.includes(kind));
    if (!intended && !wantsColourChange(instruction)) colourAnchor = base;
  }

  const settled = await withProgress({ from: 20, to: 85, phase: "generating", steps: prompts.length }, ({ stepDone }) =>
    Promise.allSettled(
      prompts.map(async (prompt) => {
        const result = await routeProviderCall({
          tenant,
          provider,
          modelId: model,
          prompt,
          quality,
          images: images.map(({ mimeType, base64 }) => ({ mimeType, base64 })),
        });
        const output = colourAnchor ? await matchColour(result.output, colourAnchor) : result.output;
        // Shown while the result is stored, so the wait ends when the model answers.
        const preview = await createLivePreview(Buffer.from(output.base64, "base64"));
        await stepDone(preview?.dataUrl ?? null);
        return { ...result, output };
      })
    )
  );

  const successes = settled.filter((entry) => entry.status === "fulfilled").map((entry) => entry.value);
  if (successes.length === 0) {
    throw settled.find((entry) => entry.status === "rejected")?.reason ?? new Error("The model returned no image");
  }

  await setProgress(88, "saving");

  const saved = await recordGeneration({
    tenant,
    user: dbUser,
    tool: TOOL,
    conversationId: data.conversationId,
    parentGenerationId: data.parentGenerationId,
    model,
    modelLabel,
    quality,
    prompt: historyPrompt(prompts),
    // Shown in the UI and History, kept apart from `prompt` so the anatomy and
    // scale boilerplate never leaks into what the user sees.
    userPrompt: data.displayPrompt?.trim() || instruction,
    inputImages: [
      // A base image on a follow-up turn is a prior result being edited
      // again, not a fresh upload — the role records which happened.
      { image: base, role: data.parentGenerationId ? "edited" : "uploaded" },
      ...parsedReferences.map((ref) => ({ image: ref, role: "reference" })),
    ],
    outputImages: successes.map((entry) => ({ image: entry.output, role: "generated" })),
    // What each reference was used as — "stone", "texture", "scene"… — in the
    // same order as the references above.
    params: references.length ? { referenceRoles: roles } : undefined,
    providerId: successes[0].providerId,
    provider,
  });

  return {
    ...toResult(saved, { model, modelLabel, provider }),
    requestedCount: prompts.length,
    // What the worker settles credits on: only what was delivered is charged.
    deliveredCount: successes.length,
    intentLabel,
  };
}

registerJobHandler(CHAT_TO_EDIT_JOB, runChatToEditJob);

module.exports = { CHAT_TO_EDIT_JOB };
