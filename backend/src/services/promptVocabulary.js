const Generation = require("../models/generation");

/**
 * Typo correction for History search, from the organization's own words.
 *
 * The dictionary is every word people have typed into a prompt — so it knows
 * "baguette", "milgrain" and "solitaire" where a general English one would
 * not, and it also knows the library's own misspellings: a search for
 * "baguette" over a library where it was typed "Baugtte" corrects towards
 * the word that is actually there, and finds those runs.
 *
 * Built from the stored prompts on first use and kept for a few minutes per
 * organization; a word typed into a new run is searchable straight away
 * (search reads the text itself) and offered as a correction once the
 * dictionary next refreshes.
 */

const TTL_MS = 10 * 60 * 1000;
const cache = new Map();

const tokenize = (text) => String(text ?? "").toLowerCase().match(/[a-z]{3,}/g) ?? [];

/** Every word in the organization's prompts, with how often it is used. */
async function vocabularyFor(tenantId) {
  const key = String(tenantId);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.words;

  const prompts = await Generation.distinct("request.userPrompt", { tenantId, deletedAt: null });
  const words = new Map();
  for (const prompt of prompts) for (const word of tokenize(prompt)) words.set(word, (words.get(word) ?? 0) + 1);
  cache.set(key, { at: Date.now(), words });
  return words;
}

/**
 * Edit distance with swapped neighbours counting as one edit ("daimond" is one
 * away from "diamond", not two). Stops early once past `limit`.
 */
function distance(a, b, limit) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prevPrev = null;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (prevPrev && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, prevPrev[j - 2] + 1);
      }
      row.push(value);
      best = Math.min(best, value);
    }
    if (best > limit) return limit + 1;
    prevPrev = prev;
    prev = row;
  }
  return prev[b.length];
}

/** How much more common a near word must be to win over a rare one that matches as typed. */
const RARE_USES = 2;
const COMMON_FACTOR = 10;

/**
 * Each search word as it should be searched:
 *  - unchanged when words in the library start with it and are in real use —
 *    a half-typed "cent" is on its way to "center", and is left alone;
 *  - else the closest library word, within one edit for a short word and two
 *    for a longer one, the more common word winning a tie.
 * A word the library holds only once or twice ("stoen", typed by someone in a
 * hurry) is itself most likely a typo: it gives way to a near word used ten
 * times as often ("stone"). The page's "search for what I typed instead"
 * still finds that one run.
 * Words with digits are codes, not spellings, and are never touched; nor is
 * anything under four letters, where a guess is more likely wrong than right.
 */
async function correctTerms(tenantId, terms) {
  const words = await vocabularyFor(tenantId);
  const known = [...words.keys()];

  return terms.map((term) => {
    if (term.length < 4 || /\d/.test(term) || !/^[a-z]+$/.test(term)) return term;
    const asTyped = known.filter((word) => word.startsWith(term)).reduce((sum, word) => sum + words.get(word), 0);
    if (asTyped > RARE_USES) return term;

    const limit = term.length <= 5 ? 1 : 2;
    let best = null;
    let bestDistance = limit + 1;
    let bestCount = 0;
    for (const word of known) {
      if (word.startsWith(term)) continue;
      const d = distance(term, word, limit);
      const count = words.get(word);
      if (d < bestDistance || (d === bestDistance && d <= limit && count > bestCount)) {
        best = word;
        bestDistance = d;
        bestCount = count;
      }
    }
    if (!best || bestDistance > limit) return term;
    // Found as typed, if rarely: only a far more common word replaces it.
    return asTyped === 0 || bestCount >= asTyped * COMMON_FACTOR ? best : term;
  });
}

module.exports = { correctTerms };
