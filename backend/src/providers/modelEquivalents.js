/**
 * Which OpenRouter model id serves the same model as a native Gemini/OpenAI
 * id, so an OpenRouter key can stand in when that provider's own keys are
 * missing or exhausted — see aiRouting.js's `imageCandidatesFor`.
 *
 * Confirmed against OpenRouter's own Playground export for each model
 * (same way gpt-image-2/1's payload shape was confirmed) rather than
 * guessed — a model absent here has no known OpenRouter equivalent and is
 * left out of the fallback entirely instead of being tried and failing.
 */
const OPENROUTER_EQUIVALENTS = {
  gemini: {
    "gemini-3-pro-image": "google/gemini-3-pro-image",
    "gemini-3.1-flash-image": "google/gemini-3.1-flash-image",
  },
  openai: {
    "gpt-image-1": "openai/gpt-image-1",
  },
};

/** The OpenRouter id that can serve `modelId` in place of `provider`'s own key, or undefined if there isn't one. */
function openrouterEquivalentFor(provider, modelId) {
  return OPENROUTER_EQUIVALENTS[provider]?.[modelId];
}

module.exports = { openrouterEquivalentFor };
