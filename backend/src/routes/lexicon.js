const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { checkText } = require("../spellcheck");
const { LEXICON_SEED, normalizeTerm, lexiconWordMap } = require("../jewelryLexicon");
const LexiconTerm = require("../models/lexiconTerm");

const router = express.Router();

// Only authentication, no tool permission: spell checking a text box is not a
// generation, and gating it behind one tool's grant would mean the same field
// checks on one page and silently stops on another.
router.use(requireAuth);

/** Matches the cap the client's textarea enforces, with room to spare. */
const MAX_TEXT_LENGTH = 6000;

/**
 * The organisation's saved terms, as display strings. Read on every check —
 * the list is small (tens of words) and indexed by tenant, and caching it here
 * would leave a word invisible to the person who just added it.
 */
async function savedTermsFor(tenantId) {
  if (!tenantId) return [];
  const rows = await LexiconTerm.find({ tenantId }).select("term").lean();
  return rows.map((row) => row.term);
}

/**
 * Spell-checks a prompt against English (both US and British) plus the
 * caller's jewellery lexicon, and returns the character ranges to underline.
 * Called on a typing pause, not per keystroke.
 */
router.post("/check", async (req, res) => {
  const text = typeof req.body?.text === "string" ? req.body.text : "";

  if (text.length > MAX_TEXT_LENGTH) {
    return res.status(400).json({ status: "error", message: "text is too long to check", code: "invalid" });
  }
  if (!text.trim()) return res.json({ status: "success", issues: [] });

  try {
    const allowed = lexiconWordMap(await savedTermsFor(req.dbUser.tenantId));
    res.json({ status: "success", issues: await checkText(text, allowed) });
  } catch (err) {
    // A spellchecker that fails must never cost the user their prompt, so this
    // answers "nothing to underline" rather than an error the field would have
    // to handle.
    console.error("lexicon: could not check text:", err.message);
    res.json({ status: "success", issues: [] });
  }
});

/** The vocabulary, for the client's own use (autocomplete, offline hints). */
router.get("/", async (req, res) => {
  try {
    const saved = await savedTermsFor(req.dbUser.tenantId);
    res.json({ status: "success", terms: [...saved, ...LEXICON_SEED] });
  } catch (err) {
    console.error("lexicon: could not list terms:", err.message);
    res.json({ status: "success", terms: LEXICON_SEED });
  }
});

/** "Add to dictionary" — teaches one word to the whole organisation. */
router.post("/", async (req, res) => {
  const term = typeof req.body?.term === "string" ? req.body.term.trim() : "";
  const normalized = normalizeTerm(term);

  if (!term || normalized.length < 2 || term.length > 80) {
    return res.status(400).json({ status: "error", message: "that is not a word we can save", code: "invalid" });
  }

  try {
    // Upsert, not create: two people adding the same word is ordinary, and the
    // unique index would otherwise turn the second one into an error the user
    // sees for doing nothing wrong.
    await LexiconTerm.updateOne(
      { tenantId: req.dbUser.tenantId, normalized },
      { $setOnInsert: { term, createdByUserId: req.dbUser._id } },
      { upsert: true }
    );
    res.status(201).json({ status: "success", term });
  } catch (err) {
    console.error("lexicon: could not save term:", err.message);
    res.status(503).json({ status: "error", message: "could not save that word", code: "save_failed" });
  }
});

module.exports = router;
