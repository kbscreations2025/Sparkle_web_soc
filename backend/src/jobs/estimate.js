const Job = require("../models/job");

/**
 * How long a run is likely to take, from how long recent identical runs
 * actually took.
 *
 * The providers stream no progress of their own — a generate call is one
 * request that returns an image some tens of seconds later, with nothing in
 * between. So a percentage during that call can only ever come from a
 * prediction, and the honest way to make one is to measure this deployment's
 * own history rather than guess a constant.
 */

/** Used until a model has enough history of its own — roughly what an image generation costs. */
const FALLBACK_MS = 30000;

/** Below this many samples the median is noise, so the fallback is the better answer. */
const MIN_SAMPLES = 3;

/** How many recent runs the median is taken over. Short enough to follow a provider getting slower today, long enough not to swing on one outlier. */
const SAMPLE_SIZE = 20;

/**
 * Clamps, so a pathological sample can't produce a nonsense bar — a run that
 * took 40 minutes because a provider hung must not make the next estimate 40
 * minutes.
 */
const MIN_ESTIMATE_MS = 3000;
const MAX_ESTIMATE_MS = 5 * 60 * 1000;

/** Estimates are re-read at most this often; between times they come from memory. */
const CACHE_TTL_MS = 60000;

const cache = new Map();

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * The median duration of recent successful runs of the same type and model.
 *
 * Median rather than mean on purpose: one run that hit a provider timeout and
 * took ten times as long would drag a mean far enough to make every
 * subsequent progress bar crawl, and a median simply ignores it.
 *
 * Keyed by model as well as type because the difference between models is the
 * dominant term — a fast preview model and a pro model are not the same job
 * wearing different labels, and averaging them serves neither.
 *
 * Never throws: a failed lookup returns the fallback. A progress estimate is
 * a nicety, and must not be able to stop a job from running.
 */
async function estimateDurationMs(type, model) {
  const key = `${type}::${model || "default"}`;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  let value = FALLBACK_MS;
  try {
    const recent = await Job.find({ type, "request.model": model, status: "completed", durationMs: { $gt: 0 } })
      .sort({ finishedAt: -1 })
      .limit(SAMPLE_SIZE)
      .select("durationMs")
      .lean();

    if (recent.length >= MIN_SAMPLES) {
      value = Math.min(MAX_ESTIMATE_MS, Math.max(MIN_ESTIMATE_MS, median(recent.map((row) => row.durationMs))));
    }
  } catch (err) {
    console.error(`[estimate] falling back to ${FALLBACK_MS}ms for ${key}:`, err.message);
  }

  cache.set(key, { value, at: Date.now() });
  return value;
}

module.exports = { estimateDurationMs };
