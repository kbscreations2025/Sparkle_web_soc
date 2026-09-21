const { routeTextCall, loadTenantOrThrow } = require("../aiRouting");
const { recordGeneration } = require("../generationService");
const gemini = require("../gemini");
const User = require("../models/user");

/**
 * The body every text-out job shares — Image to Text, and the writing halves
 * of Marketing Kit.
 *
 * The counterpart to generationRunner.js, and separate from it rather than a
 * flag on it: these tools produce no images, so nothing about fanning
 * variations out, previewing partial results or clamping a count applies,
 * and the half of that file which does apply is four lines. What they do
 * share — loading the actor, routing through the tenant's keys, reading a
 * refusal correctly and writing history — is here.
 *
 * A tool supplies `buildParts`, because the interleaving of labels and
 * pictures *is* the prompt for these: Affinity sends "ITEM 1 PHOTO:", the
 * photo, "ITEM 1 SHEET:", the sheet, eight times over, and that labelling is
 * what keeps eight pieces from blurring into one.
 */

/**
 * A model that answers an image with "I'm sorry, I can't…" has not produced a
 * short narrative — it has declined — and storing that as the result would
 * put a refusal in a catalogue. Only the opening words are tested: a
 * legitimate narrative can discuss what a piece cannot do without opening
 * that way.
 */
const REFUSAL_PATTERN = /^(i'?m sorry|i cannot|i can'?t|i apologize|as an ai)/i;

/**
 * Thrown for a run the model answered, but not usefully.
 *
 * `expose` means this message was written for the user and must reach them
 * as-is rather than being re-read as a provider fault. `noRetry` because
 * every attempt would be refused identically — a content filter does not
 * change its mind on the second ask, and retrying only makes the user wait
 * longer for the same answer.
 */
class ModelRefusedError extends Error {
  constructor(message, code = "model_refused") {
    super(message);
    this.code = code;
    this.expose = true;
    this.noRetry = true;
  }
}

/**
 * @param modelId          Named by the tool, not the user — no picker offers a
 *                         choice of writing model.
 * @param buildParts       `({ data }) => Part[]` — the full content list.
 * @param responseSchema   Structured-output contract, where the answer is JSON.
 * @param record           False for a run that shouldn't appear in History.
 * @param inputImages      `[{ image, role }]` to record as this run's inputs.
 * @param historyParams    Extra fields for the generation's `request.params`
 *                         — where a tool records the id of the document this
 *                         run wrote, so History can point at it.
 * @param parse            `({ text, data }) => parsed` — the tool's own
 *                         reading of the answer. Throw a `ModelRefusedError`
 *                         from here to reject a well-formed answer that
 *                         isn't usable; nothing is recorded if you do.
 * @param persist          `({ text, parsed, generationId, … }) => object` —
 *                         stores whatever the run produced, and returns
 *                         fields merged into the job result. Runs after the
 *                         generation exists, so it can link back to it.
 */
async function runTextJob({
  job,
  data,
  setProgress,
  withProgress,
  tool,
  modelId = gemini.DEFAULT_TEXT_MODEL,
  buildParts,
  systemInstruction,
  responseSchema,
  thinkingBudget,
  maxOutputTokens,
  temperature,
  record = true,
  inputImages = [],
  userPrompt = null,
  promptForHistory = null,
  historyParams,
  parse,
  persist,
}) {
  const dbUser = await User.findById(job.userId);
  if (!dbUser) throw new Error("the user who queued this job no longer exists");

  const tenant = await loadTenantOrThrow(dbUser);
  const parts = buildParts({ data });

  const { output } = await withProgress({ from: 20, to: 85, phase: "generating" }, async ({ stepDone }) => {
    const result = await routeTextCall({
      tenant,
      modelId,
      parts,
      systemInstruction,
      responseSchema,
      thinkingBudget,
      maxOutputTokens,
      temperature,
    });
    await stepDone(null);
    return result;
  });

  assertUsable(output);

  await setProgress(88, "saving");

  /*
   * Reading the answer and storing it are two steps, in this order and for
   * two different reasons.
   *
   * `parse` runs first so an answer the tool rejects — unparseable JSON, no
   * items — never becomes a history row at all.
   *
   * `persist` runs last so it can be handed the generation id, which is
   * what links a saved document back to the run that produced it. The
   * document's own id is minted by the caller and passed to both, so the
   * link is written in both directions with one write each rather than a
   * record followed by an update.
   */
  const parsed = (await parse?.({ text: output.text, data })) ?? null;

  let saved = null;
  if (record) {
    saved = await recordGeneration({
      tenant,
      user: dbUser,
      tool,
      conversationId: data.conversationId,
      parentGenerationId: data.parentGenerationId || null,
      model: modelId,
      modelLabel: gemini.labelFor(modelId),
      provider: "gemini",
      prompt: promptForHistory || textOf(parts),
      userPrompt,
      params: historyParams,
      inputImages,
      outputImages: [],
      outputText: output.text,
    });
  }

  const extra =
    (await persist?.({
      text: output.text,
      parsed,
      data,
      dbUser,
      tenant,
      modelId,
      generationId: saved?.generationId ?? null,
    })) ?? {};

  return {
    text: output.text,
    conversationId: saved?.conversationId ?? null,
    generationId: saved?.generationId ?? null,
    model: modelId,
    modelLabel: gemini.labelFor(modelId),
    provider: "gemini",
    ...extra,
  };
}

/**
 * Turns the ways a text run can come back empty into something the user can
 * act on.
 *
 * Unlike an image call, which simply returns nothing when it fails, a
 * stopped text run returns a perfectly well-formed candidate with no content
 * in it. Reported plainly that reads as "the model returned nothing", which
 * is true and useless — the reason is in `finishReason`, and it is the whole
 * difference between "use a clearer photo" and "send fewer pieces".
 */
function assertUsable(output) {
  if (output.blocked) {
    throw new ModelRefusedError(
      "That image was flagged by the content safety filter. Try a clearer product photo on a plain background.",
      "content_filtered"
    );
  }
  if (output.truncated && !output.text) {
    throw new ModelRefusedError(
      "The model ran out of its token budget before finishing. Try fewer pieces at a time.",
      "max_tokens"
    );
  }
  if (!output.text) {
    throw new ModelRefusedError("The model returned no answer. Please try again.", "empty_response");
  }
  if (REFUSAL_PATTERN.test(output.text)) {
    throw new ModelRefusedError(
      "The model declined to analyse this image. Try a cleaner product photo or a different angle.",
      "model_refused"
    );
  }
}

/** The words out of a parts list, for the `finalPrompt` History records. */
function textOf(parts) {
  return parts
    .map((part) => part.text)
    .filter(Boolean)
    .join("\n");
}

module.exports = { runTextJob, ModelRefusedError };
