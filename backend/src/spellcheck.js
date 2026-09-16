const nspell = require("nspell");
const { normalizeTerm } = require("./jewelryLexicon");

/**
 * Spell checking for the prompt fields.
 *
 * General English first, jewellery second. The dictionaries below are ordinary
 * Hunspell ones, so every English word is covered — "recieve" is corrected to
 * "receive" and "seperate" to "separate" exactly as they would be anywhere else.
 * The jewellery lexicon sits on top of that to stop trade terms being flagged,
 * and to supply the corrections a general dictionary cannot ("pavay" → "pavé",
 * where Hunspell offers "parlay").
 *
 * Both British and American spellings are accepted, as two separate instances.
 * They cannot be merged: nspell's `.dictionary()` folds a second .dic into the
 * first one's affix table, which silently breaks the checker — it then reports
 * every word as correct, made-up ones included.
 *
 * This runs on the server rather than the browser because `dictionary-en` is a
 * Node-only ESM package that reads its .aff/.dic off disk, and the pair is
 * ~1MB that would otherwise be downloaded and parsed by every client. The
 * client debounces, so this is a handful of requests per description.
 */

/** Both dictionaries, parsed once per process — it costs ~300ms each. */
let spellersPromise = null;

function getSpellers() {
  // Deliberately never `.add()`-ed to: these instances are shared by every
  // request in the process, so folding one organisation's saved terms into them
  // would leak that vocabulary to every other tenant. Custom terms are applied
  // per-request through the `allowed` map instead.
  spellersPromise ??= Promise.all([
    import("dictionary-en").then((mod) => nspell(mod.default)),
    import("dictionary-en-gb").then((mod) => nspell(mod.default)),
  ]);
  return spellersPromise;
}

/**
 * Words and numbers with their offsets. Matching digits as part of a token
 * (rather than skipping them) is what lets "18K", "0.5ct" and "f/1.4" be
 * recognised and skipped whole, instead of leaving a bare "K" or "ct" behind
 * to be flagged.
 */
const TOKEN_RE = /[\p{L}\p{N}][\p{L}\p{N}\p{M}'’-]*/gu;
const HAS_DIGIT_RE = /\p{N}/u;

/** Bounds the response — a wall of underlines is noise, and the user fixes the first few anyway. */
const MAX_ISSUES = 60;
/** Corrections offered per misspelling. */
const MAX_SUGGESTIONS = 6;

/** Levenshtein distance, abandoned as soon as it cannot come in at or under `max`. */
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (row[j] < best) best = row[j];
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length];
}

/**
 * Near-misses from the jewellery lexicon, closest first. This is the half a
 * general spellchecker cannot do: "neckless" reaches "Necklace" here, where
 * Hunspell alone offers only "feckless" and "reckless".
 */
function lexiconSuggestions(word, allowed) {
  // Only the very shortest words are held to a single edit. At two edits a
  // 5-letter typo still reaches its target, and results are ranked by distance
  // anyway, so closer matches stay on top.
  const max = word.length <= 4 ? 1 : 2;
  const scored = [];
  for (const [key, display] of allowed) {
    const distance = editDistance(word, key, max);
    if (distance <= max) scored.push({ display, distance });
  }
  return scored
    .sort((a, b) => a.distance - b.distance || a.display.length - b.display.length)
    .slice(0, MAX_SUGGESTIONS)
    .map((candidate) => candidate.display);
}

/**
 * @param text    The prompt to check.
 * @param allowed Normalized → display map of terms that must never be flagged
 *                (the built-in jewellery vocabulary plus the organisation's
 *                saved terms).
 * @returns `[{ from, to, word, suggestions }]` — character offsets into `text`.
 */
async function checkText(text, allowed) {
  const [us, gb] = await getSpellers();
  const issues = [];

  for (const match of text.matchAll(TOKEN_RE)) {
    if (issues.length >= MAX_ISSUES) break;

    const raw = match[0];
    // Edge punctuation the token regex swept up ("gold-", "clients’"). Stripped
    // for the lookup, and its width discounted so the underline lands on the
    // word itself.
    const trimmedStart = raw.replace(/^[-'’]+/, "");
    const word = trimmedStart.replace(/[-'’]+$/, "");
    if (!word) continue;
    const from = (match.index ?? 0) + (raw.length - trimmedStart.length);

    // Anything with a digit is a measurement or a SKU, not a word: 18K, 0.75ct, 85mm.
    if (HAS_DIGIT_RE.test(word)) continue;
    // Trade acronyms — GIA, VVS, IGI, CAD — which no dictionary carries.
    if (word.length <= 5 && word === word.toUpperCase()) continue;

    const normalized = normalizeTerm(word);
    if (normalized.length < 3) continue;
    if (allowed.has(normalized)) continue;

    // nspell is case-aware, so a lowercase spelling of a capitalised-only entry
    // (and vice versa) needs both forms tried before calling it a mistake.
    const known = (speller) => speller.correct(word) || speller.correct(normalized);
    if (known(us) || known(gb)) continue;

    // Domain corrections first — they are the ones a general dictionary misses.
    const candidates = [...lexiconSuggestions(normalized, allowed), ...us.suggest(word), ...gb.suggest(word)];
    const seen = new Set();
    const ranked = candidates.filter((candidate) => {
      const key = normalizeTerm(candidate);
      if (!key || key === normalized || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    issues.push({ from, to: from + word.length, word, suggestions: ranked.slice(0, MAX_SUGGESTIONS) });
  }

  return issues;
}

module.exports = { checkText };
