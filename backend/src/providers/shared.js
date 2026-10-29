/**
 * What every provider module needs identically. Each had grown its own copy
 * of the retry loop and the video polling loop (and OpenAI and OpenRouter
 * their own copy of the same error reader), so a policy change was a change
 * someone had to remember to make three times.
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The pause before a transient failure is tried once more on the same key. */
const RETRY_DELAY_MS = 2000;

/**
 * Runs `fn`, and once more after a pause when it fails with an error the
 * calling provider's `classifyError` reads as transient. Moving on to the
 * tenant's next key once this gives up is aiRouting.js's job, not this one's.
 */
async function withRetry(fn, classifyError) {
  try {
    return await fn();
  } catch (err) {
    if (!classifyError(err).retryable) throw err;
    await sleep(RETRY_DELAY_MS);
    return fn();
  }
}

/**
 * `{ message, code, retryable }` for an error from an OpenAI-shaped API —
 * OpenAI's own SDK and OpenRouter's endpoints both carry an HTTP status and an
 * `error.message`. Same shape gemini.js's `classifyError` produces, so
 * aiRouting.js can treat every provider's failure identically; see that
 * function for what `retryable` controls.
 *
 * `explainOther(raw, code)` lets a provider word the leftover case itself
 * rather than fall back to "something went wrong"; returning null keeps the
 * fallback.
 */
function classifyApiError(err, providerLabel, explainOther) {
  const code = typeof err?.status === "number" ? err.status : undefined;
  const raw = err?.error?.message || err?.message || String(err);
  const text = `${raw} ${code ?? ""}`.toLowerCase();

  if (code === 429 || code === 500 || code === 503 || text.includes("overloaded") || text.includes("rate limit") || text.includes("quota")) {
    return { message: "This model is under heavy load right now. Please try again shortly.", code, retryable: true };
  }

  if (text.includes("timeout") || text.includes("timed out") || text.includes("econnreset") || text.includes("aborted") || text.includes("network")) {
    return { message: "The request timed out. Please try again.", code, retryable: true };
  }

  if (text.includes("safety") || text.includes("content_policy") || text.includes("content policy") || text.includes("blocked") || text.includes("moderation")) {
    return {
      message: "That request was blocked by the content safety filter. Try adjusting the image or instructions.",
      code,
      retryable: false,
    };
  }

  if (code === 401 || code === 403 || text.includes("api key") || text.includes("incorrect api key") || text.includes("permission")) {
    return { message: `One of this organization's ${providerLabel} keys was rejected.`, code, retryable: false };
  }

  if (code === 400 || text.includes("invalid")) {
    return { message: "The request could not be processed. Please adjust the input and try again.", code, retryable: false };
  }

  return explainOther?.(raw, code) ?? { message: "Something went wrong talking to the model.", code, retryable: false };
}

/**
 * Images first, in order, with the prompt last, as Gemini-style content parts
 * — the order Gemini documents as most reliable for image-conditioned
 * generation, and the one every caller's prompt assumes.
 */
function promptParts(images, prompt) {
  return [...images.map(({ mimeType, base64 }) => ({ inlineData: { mimeType, data: base64 } })), { text: prompt }];
}

/**
 * `finishReason` values that mean the model was stopped by a safety or policy
 * filter rather than finishing its answer. Checked on text responses, where —
 * unlike an image response — a stopped run still returns a well-formed
 * candidate with no usable content, and would otherwise read as "the model
 * returned nothing" with no explanation. OpenRouter passes the same values
 * through as `native_finish_reason`.
 */
const BLOCKED_FINISH_REASONS = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"]);

/** How often a video job is polled. */
const VIDEO_POLL_INTERVAL_MS = 5000;
/**
 * ~10 minutes. The Next route this replaces capped out at ~290s because a
 * serverless function had to answer within 300s; a queue worker has no such
 * ceiling, so the limit here is "when is it fair to call this hung" rather
 * than "when does the platform kill us".
 */
const VIDEO_MAX_POLLS = 120;

class VideoTimeoutError extends Error {
  constructor() {
    super("The video is taking longer than expected. Try a shorter duration or a faster model.");
    this.code = "video_timeout";
    // Written for the user, and not worth retrying: another attempt is
    // another ten minutes of waiting for the same verdict, on the most
    // expensive call this app makes.
    this.expose = true;
    this.noRetry = true;
  }
}

/**
 * Refreshes a long-running video job with `poll` until `isDone` says so,
 * reporting each poll through `onPoll` — the only signal a run produces, and
 * without it the progress bar would have nothing but the clock to go on.
 *
 * @throws {VideoTimeoutError} once the ceiling passes with the job unfinished.
 * @returns The job's last state.
 */
async function pollVideo(job, { poll, isDone, onPoll, provider }) {
  for (let count = 0; !isDone(job) && count < VIDEO_MAX_POLLS; count++) {
    await sleep(VIDEO_POLL_INTERVAL_MS);
    job = await poll(job);
    // Best-effort: a progress push that throws must not lose the video.
    try {
      await onPoll?.(count + 1, VIDEO_MAX_POLLS);
    } catch (err) {
      console.error(`[${provider}] video poll progress failed:`, err.message);
    }
  }
  if (!isDone(job)) throw new VideoTimeoutError();
  return job;
}

module.exports = { withRetry, classifyApiError, promptParts, BLOCKED_FINISH_REASONS, pollVideo };
