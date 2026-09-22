/**
 * Seeds the credit price table with one rule per model × quality, plus a
 * catch-all underneath so nothing is ever unpriced.
 *
 *   node src/scripts/seedPricing.js            # add what's missing
 *   node src/scripts/seedPricing.js --dry-run  # print the table, write nothing
 *   node src/scripts/seedPricing.js --reprice  # also update rates on existing rows
 *
 * Idempotent. A rule is matched on its *shape* — the model, tool, quality and
 * unit it applies to — not on its label, so re-running never duplicates a row
 * and never overwrites a label or a rate you have edited by hand. `--reprice`
 * is the opt-in for pulling provider rates and credit rates back to the
 * values in this file, for when a provider publishes a new price list.
 *
 * ── where the numbers come from ──────────────────────────────────────────
 * `providerRate` is each provider's published list price, per the unit named.
 * Recorded as reference only — nothing bills against it.
 *
 *   Gemini images/video: ai.google.dev/gemini-api/docs/pricing
 *   gpt-image-1:         openai.com pricing, 1024x1024 tier
 *   Checked September 2026. They change; `--reprice` is how you catch up.
 *
 * `creditsPerUnit` is the provider rate marked up by `MARKUP` and converted
 * at `CREDITS_PER_USD`, rounded to a whole credit. It is a *starting point*
 * chosen to be defensible, not a commercial decision — the whole table is
 * editable in the console, which is where the real rates should be set.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const config = require("../config");
const { connectDb } = require("../db");
const CreditPricingRule = require("../models/creditPricingRule");

/** 1 credit = 1 US cent, so a credit balance reads as a dollar figure ÷ 100. */
const CREDITS_PER_USD = 100;

/** What we charge over what we pay. Change it and re-run with --reprice. */
const MARKUP = 2.5;

/** Never price a billable unit at zero — a free tier should be a deliberate rule, not a rounding artefact. */
const credits = (usd) => Math.max(1, Math.round(usd * MARKUP * CREDITS_PER_USD));

/**
 * Every priced combination.
 *
 * `rate` is USD per unit. Image models are per image, video per second of
 * clip, text per request — the unit each provider actually bills on, so the
 * markup is applied to a like-for-like number.
 */
const IMAGE_RULES = [
  // ── Gemini 3 Pro Image ──
  // 1K and 2K share one provider rate ($0.134), so they share one credit
  // price. Not a mistake: Google bills them identically.
  { model: "gemini-3-pro-image", quality: "4K", rate: 0.24, label: "Sparkle 3 Pro Image — 4K" },
  { model: "gemini-3-pro-image", quality: "2K", rate: 0.134, label: "Sparkle 3 Pro Image — 2K" },
  { model: "gemini-3-pro-image", quality: "1K", rate: 0.134, label: "Sparkle 3 Pro Image — 1K" },

  // ── Gemini 3.1 Flash Image ──
  { model: "gemini-3.1-flash-image", quality: "4K", rate: 0.151, label: "Sparkle 3.1 Flash Image — 4K" },
  { model: "gemini-3.1-flash-image", quality: "2K", rate: 0.101, label: "Sparkle 3.1 Flash Image — 2K" },
  { model: "gemini-3.1-flash-image", quality: "1K", rate: 0.067, label: "Sparkle 3.1 Flash Image — 1K" },

  // ── Gemini 2.5 Flash Image ── one size only; see GEMINI_IMAGE_QUALITIES.
  { model: "gemini-2.5-flash-image", quality: "1K", rate: 0.039, label: "Sparkle 2.5 Flash Image — 1K" },

  // ── gpt-image-1 ── quality here is a compute tier, not a resolution.
  // Rates are the 1024x1024 tier; the landscape/portrait sizes cost more,
  // and this app only ever requests the square one.
  { model: "gpt-image-1", quality: "high", rate: 0.167, label: "Sparkle GPT Image — high" },
  { model: "gpt-image-1", quality: "medium", rate: 0.042, label: "Sparkle GPT Image — medium" },
  { model: "gpt-image-1", quality: "low", rate: 0.011, label: "Sparkle GPT Image — low" },
];

/**
 * Veo bills per second, so these are per-second rates and a rule's price is
 * multiplied by the clip length. An 8s Standard clip at 1080p therefore costs
 * 8 × its per-second credits.
 *
 * Only the resolutions this app offers — routes/imageToVideo.js clamps to
 * 720p and 1080p, so Veo's 4K tier is deliberately absent. Lite has no 4K at
 * all.
 */
const VIDEO_RULES = [
  { model: "veo-3.1-generate-preview", quality: "1080p", rate: 0.4, label: "Veo 3.1 Standard — 1080p" },
  { model: "veo-3.1-generate-preview", quality: "720p", rate: 0.4, label: "Veo 3.1 Standard — 720p" },
  { model: "veo-3.1-fast-generate-preview", quality: "1080p", rate: 0.12, label: "Veo 3.1 Fast — 1080p" },
  { model: "veo-3.1-fast-generate-preview", quality: "720p", rate: 0.1, label: "Veo 3.1 Fast — 720p" },
  { model: "veo-3.1-lite-generate-preview", quality: "1080p", rate: 0.08, label: "Veo 3.1 Lite — 1080p" },
  { model: "veo-3.1-lite-generate-preview", quality: "720p", rate: 0.05, label: "Veo 3.1 Lite — 720p" },
];

/**
 * The text-out models, which the tool picks rather than the user — Image to
 * Text and the writing halves of Marketing Kit.
 *
 * Priced per request, because these routes return no images and a per-image
 * rule would leave them permanently free. The rate is an estimate of a
 * typical call (~2k tokens in, ~1k out) at each model's published token
 * price, since a rule cannot see a token count. Revise it once you have real
 * usage to average.
 */
const TEXT_RULES = [
  { model: "gemini-2.5-pro", rate: 0.0125, label: "Gemini 2.5 Pro — text, per request" },
  { model: "gemini-2.5-flash", rate: 0.0031, label: "Gemini 2.5 Flash — text, per request" },
];

function buildRules() {
  return [
    ...IMAGE_RULES.map((entry) => ({
      label: entry.label,
      modelId: entry.model,
      quality: entry.quality,
      unit: "per_image",
      providerRate: entry.rate,
      creditsPerUnit: credits(entry.rate),
    })),
    ...VIDEO_RULES.map((entry) => ({
      label: entry.label,
      modelId: entry.model,
      quality: entry.quality,
      unit: "per_second",
      providerRate: entry.rate,
      creditsPerUnit: credits(entry.rate),
      notes: "Per second of clip — an 8s render costs eight times this.",
    })),
    ...TEXT_RULES.map((entry) => ({
      label: entry.label,
      modelId: entry.model,
      quality: null,
      unit: "per_request",
      providerRate: entry.rate,
      creditsPerUnit: credits(entry.rate),
      notes: "Estimated from a typical call (~2k tokens in, ~1k out).",
    })),
    {
      /*
       * The floor. It exists so an unpriced model — one released after this
       * table was written — bills at something rather than nothing, and it is
       * deliberately set above every real rule so that happening is visible
       * on the invoice rather than silent.
       *
       * No providerRate: there is no provider to quote, because this rule
       * exists precisely for the case where we don't know which model ran.
       */
      label: "Catch-all — unpriced model",
      modelId: null,
      quality: null,
      unit: "per_image",
      providerRate: null,
      creditsPerUnit: 60,
      notes: "Fallback for any model with no rule of its own. Priced high on purpose.",
    },
  ];
}

/** A rule's identity for seeding: what it matches, not what it is called. */
const shapeOf = (rule) => ({
  tenantId: null,
  modelId: rule.modelId ?? null,
  tool: rule.tool ?? null,
  quality: rule.quality ?? null,
  unit: rule.unit,
});

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const reprice = process.argv.includes("--reprice");
  const rules = buildRules();

  console.log(
    `\n  ${rules.length} rules · markup ${MARKUP}× · 1 credit = $${(1 / CREDITS_PER_USD).toFixed(2)} · ₹${config.usdToInr}/$\n`
  );
  console.log(
    "  " +
      "LABEL".padEnd(38) +
      "UNIT".padEnd(14) +
      "USD".padStart(10) +
      "INR".padStart(10) +
      "CREDITS".padStart(10)
  );
  for (const rule of rules) {
    const usd = rule.providerRate === null ? "—" : `$${rule.providerRate}`;
    // Rupees are shown for reading only — nothing is stored in INR. The
    // dollar figure is what the provider publishes and what gets saved.
    const inr = rule.providerRate === null ? "—" : `₹${(rule.providerRate * config.usdToInr).toFixed(2)}`;
    console.log(
      "  " +
        rule.label.padEnd(38) +
        rule.unit.padEnd(14) +
        usd.padStart(10) +
        inr.padStart(10) +
        String(rule.creditsPerUnit).padStart(10)
    );
  }
  console.log("");

  if (dryRun) {
    console.log("  --dry-run: nothing written.\n");
    return;
  }

  await connectDb();

  let created = 0;
  let repriced = 0;
  let skipped = 0;

  for (const rule of rules) {
    const shape = shapeOf(rule);
    // Only live rules count as "already there": a rule that was retired on
    // purpose should not block seeding its replacement.
    const existing = await CreditPricingRule.findOne({ ...shape, effectiveTo: null });

    if (!existing) {
      await CreditPricingRule.create({ ...shape, ...rule });
      created += 1;
      continue;
    }

    if (!reprice) {
      skipped += 1;
      continue;
    }

    const unchanged =
      existing.providerRate === rule.providerRate && existing.creditsPerUnit === rule.creditsPerUnit;
    if (unchanged) {
      skipped += 1;
      continue;
    }

    // Deliberately leaves `label` and `notes` alone — those are the operator's
    // words, and a reprice should not undo an edit made in the console.
    existing.providerRate = rule.providerRate;
    existing.creditsPerUnit = rule.creditsPerUnit;
    await existing.save();
    repriced += 1;
  }

  console.log(`  created ${created} · repriced ${repriced} · unchanged ${skipped}\n`);
  if (!reprice && skipped > 0) {
    console.log("  Run with --reprice to pull existing rows back to the rates above.\n");
  }
}

main()
  .catch((err) => {
    console.error("seedPricing failed:", err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.connection.close());
