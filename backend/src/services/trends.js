const TrendSnapshot = require("../models/trendSnapshot");
const { routeTextCall } = require("../aiRouting");
const { curatedTrends, buildTrendResearchPrompt } = require("../prompts/jewelryTrends");

/**
 * The current jewellery trends for one audience and type — see
 * prompts/jewelryTrends.js for what a trend is.
 *
 * Once a month per organisation, audience and type, a model with live web
 * search is asked what is trending now, and the answer is kept for the month
 * (models/trendSnapshot.js). Until that has happened — or when it can't, for
 * want of a web-capable key — the curated list stands in, so the builder
 * always has something to show.
 *
 * Two readings of the same answer reach the builder:
 *  - `trends`, whole design directions, which a "Trending" design style sends
 *    one per image;
 *  - `trending`, what is in fashion row by row (`{ settingStyle: ["Bezel"] }`),
 *    which the builder flags in each row and which a row's own "Trending"
 *    choice draws from.
 */

/** Flash is plenty for summarising search results, and quick. */
const RESEARCH_MODEL = "gemini-2.5-flash";
const AUDIENCES = new Set(["women", "men", "general"]);
/**
 * How long a builder load waits on a fresh search before showing the curated
 * list. A search typically takes 10–15s, and happens once a month per list.
 */
const WAIT_MS = 20_000;
/** After a failed refresh, how long the curated list stands before trying again. */
const RETRY_AFTER_MS = 6 * 60 * 60 * 1000;
const MAX_TRENDS = 8;
/** A trend's defining selections — enough to say what it is, not a whole design. */
const MAX_PICKS = 4;
/** Flagged options per row — past a few, a flag stops meaning anything. */
const MAX_TRENDING_VALUES = 4;
/** A cue sent with a run: a trend's description plus the row-by-row choices for that image. */
const MAX_CUE_LENGTH = 700;

/** One search per list at a time, however many people open the builder at once. */
const inFlight = new Map();

function periodOf(date) {
  return date.toISOString().slice(0, 7);
}

/**
 * Collapsed whitespace, without the citations a web-grounded answer sprinkles
 * through its text — "[ft.com](https://…)", bare links, "[2]" — which would
 * otherwise travel into the image prompt.
 */
function clip(value, max) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\s*\[[^\]]*\]\(\s*https?:\/\/[^)]*\)/g, "")
    .replace(/\s*\(?\bhttps?:\/\/[^\s)]+\)?/g, "")
    .replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Like `clip`, but a long description ends at its last whole sentence rather than mid-word. */
function clipSentences(value, max) {
  const text = clip(value, Infinity);
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = cut.lastIndexOf(". ");
  return end > max / 2 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "");
}

/**
 * A value as the builder spells it, or null when the row has no such option.
 * "Trending" never counts — it is the builder's own "whatever is in fashion"
 * choice, not something in fashion.
 */
function matchOption(options, key, value) {
  const allowed = options[key];
  if (!allowed || typeof value !== "string") return null;
  const match = allowed.find((option) => option.toLowerCase() === value.trim().toLowerCase());
  return match && match !== "Trending" ? match : null;
}

/** Keeps only picks the builder can actually select. */
function cleanPicks(picks, options) {
  if (!picks || typeof picks !== "object") return {};
  const clean = {};
  for (const [key, value] of Object.entries(picks)) {
    const match = matchOption(options, key, value);
    if (match) clean[key] = match;
    if (Object.keys(clean).length === MAX_PICKS) break;
  }
  return clean;
}

/**
 * What is in fashion row by row: the answer's own `trending` lists first, then
 * whatever the trends' picks add — so a row the answer passed over still gets
 * flagged when a trend implies it.
 */
function trendingOf(trends, explicit, options) {
  const trending = {};
  const add = (key, value) => {
    const match = options ? matchOption(options, key, value) : typeof value === "string" && value !== "Trending" ? value : null;
    // "None" isn't a look to flag — and a row left on "Trending" should get one.
    if (!match || match === "None") return;
    const list = (trending[key] ??= []);
    if (!list.includes(match) && list.length < MAX_TRENDING_VALUES) list.push(match);
  };

  for (const [key, values] of Object.entries(explicit && typeof explicit === "object" ? explicit : {})) {
    for (const value of Array.isArray(values) ? values : [values]) add(key, value);
  }
  for (const trend of trends) for (const [key, value] of Object.entries(trend.picks ?? {})) add(key, value);
  return trending;
}

/**
 * The trends and the row-by-row picture out of a model's answer. Web search
 * can't be combined with structured output, so the JSON is found in the text —
 * it may come wrapped in a code fence or a sentence — and every entry is
 * checked.
 */
function parseResearch(text, options) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return { trends: [], trending: {} };

  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return { trends: [], trending: {} };
  }

  const seen = new Set();
  const trends = (Array.isArray(parsed?.trends) ? parsed.trends : [])
    .map((entry) => ({
      label: clip(entry?.label, 60),
      hint: clip(entry?.hint, 80),
      cue: clipSentences(entry?.cue, 400),
      picks: cleanPicks(entry?.picks, options),
    }))
    .filter((trend) => {
      const key = trend.label.toLowerCase();
      if (!trend.label || trend.cue.length < 20 || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_TRENDS);

  // Stored as the answer gave it; the picks are folded in on the way out.
  return { trends, trending: trendingOf([], parsed?.trending, options) };
}

/** Asks the web what is trending, and keeps the answer for the month. */
async function refresh({ tenant, audience, type, period, options, now }) {
  const filter = { tenantId: tenant._id, audience, type, period };
  try {
    const { system, query } = buildTrendResearchPrompt({
      audience,
      type,
      monthLabel: now.toLocaleString("en-GB", { month: "long", year: "numeric" }),
      options,
    });
    const { output } = await routeTextCall({
      tenant,
      modelId: RESEARCH_MODEL,
      systemInstruction: system,
      prompt: query,
      webSearch: true,
      thinkingBudget: 0,
      maxOutputTokens: 4096,
      temperature: 0.4,
    });

    const research = parseResearch(output.text || "", options);
    if (research.trends.length < 3) throw new Error(`the answer held ${research.trends.length} usable trends`);

    await TrendSnapshot.updateOne(filter, { $set: { ...research, failedAt: null } }, { upsert: true });
    return research;
  } catch (err) {
    console.warn(`trends: could not refresh ${audience} ${type} for ${period}:`, err.message);
    await TrendSnapshot.updateOne(filter, { $set: { failedAt: new Date() }, $setOnInsert: { trends: [] } }, { upsert: true }).catch(
      () => {}
    );
    return null;
  }
}

/**
 * @param options  The builder's own lists, `{ key: [values] }` — what a
 *                 trend's picks and the flagged options may be.
 * @returns {{ trends, trending, source: "web"|"curated", period, refreshing }}
 *   `refreshing` means a search is still running and a later load will
 *   have its answer.
 */
async function getTrends({ tenant, audience, type, options = {} }) {
  const who = AUDIENCES.has(audience) ? audience : "women";
  const now = new Date();
  const period = periodOf(now);
  // Checked against the builder's lists when there are any, like a searched answer.
  const checked = Object.keys(options).length ? options : null;
  const fromWeb = ({ trends, trending }) => ({
    trends,
    trending: trendingOf(trends, trending, checked),
    source: "web",
    period,
    refreshing: false,
  });

  const snapshot = await TrendSnapshot.findOne({ tenantId: tenant._id, audience: who, type, period }).lean();
  if (snapshot?.trends?.length) return fromWeb(snapshot);

  const curatedList = curatedTrends(who, type).map((trend) => (checked ? { ...trend, picks: cleanPicks(trend.picks, checked) } : trend));
  const curated = { trends: curatedList, trending: trendingOf(curatedList, {}, checked), source: "curated", period, refreshing: false };
  if (snapshot?.failedAt && now - snapshot.failedAt < RETRY_AFTER_MS) return curated;

  const key = `${tenant._id}:${who}:${type}:${period}`;
  let pending = inFlight.get(key);
  if (!pending) {
    pending = refresh({ tenant, audience: who, type, period, options, now }).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }

  // The search usually lands within a few seconds; when it doesn't, the
  // curated list is shown now and the search keeps going for the next load.
  let timer;
  const waited = await Promise.race([pending, new Promise((resolve) => (timer = setTimeout(() => resolve(undefined), WAIT_MS)))]);
  clearTimeout(timer);

  if (waited) return fromWeb(waited);
  return { ...curated, refreshing: waited === undefined };
}

/**
 * The trends a Text to Image or Text to Sketch run was asked to follow, as the
 * client sent them — `[{ label, cue }]`, one per image in turn. Bounded, since
 * they go straight into the prompt.
 */
function readTrendCues(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => ({ label: clip(entry?.label, 60), cue: clip(entry?.cue, MAX_CUE_LENGTH) }))
    .filter((entry) => entry.label && entry.cue)
    .slice(0, MAX_TRENDS);
}

module.exports = { getTrends, readTrendCues, trendingOf };
