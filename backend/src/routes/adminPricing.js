const express = require("express");
const mongoose = require("mongoose");
const config = require("../config");
const { requireAuth, requireSuperAdmin } = require("../middleware/auth");
const { logAudit, requestMeta, actorFrom } = require("../auditLog");
const { GENERATION_TOOLS } = require("../generations");
const gemini = require("../gemini");
const openai = require("../openai");
const Tenant = require("../models/tenant");
const CreditPricingRule = require("../models/creditPricingRule");

const { PRICING_UNITS, PRICING_CURRENCIES } = CreditPricingRule;

const router = express.Router();

// Pricing is a super-admin concern only — an org admin must not be able to
// read, let alone change, what their own organization is charged. Applied
// once at the top so no route added below can be left open.
router.use(requireAuth, requireSuperAdmin);

/** Wraps an async handler so a rejection becomes a 500 rather than a hung request. */
const handle = (fn) => (req, res, next) => {
  fn(req, res, next).catch((err) => {
    if (err.name === "ValidationError") {
      return res.status(400).json({ status: "error", message: err.message, code: "invalid" });
    }
    console.error("admin pricing route failed:", err);
    res.status(500).json({ status: "error", message: "something went wrong" });
  });
};

const bad = (res, message) => res.status(400).json({ status: "error", message, code: "invalid" });
const isId = (value) => mongoose.Types.ObjectId.isValid(value);

/**
 * Every model that can be priced, grouped for the console's dropdown.
 *
 * Built from the provider modules rather than written out again, so a model
 * added to `gemini.js` is priceable the moment it exists. The qualities come
 * from the same tables the generation path resolves against, which is what
 * lets the console offer exactly the sizes a given model can actually run at.
 */
function priceableModels() {
  return [
    {
      group: "Image",
      models: gemini.GEMINI_MODELS.map((id) => ({
        id,
        label: gemini.labelFor(id),
        qualities: gemini.qualitiesFor(id),
      })),
    },
    {
      group: "Image (OpenAI)",
      models: openai.OPENAI_MODELS.map((id) => ({
        id,
        label: openai.labelFor(id),
        qualities: openai.qualitiesFor(id),
      })),
    },
    {
      group: "Video",
      models: gemini.GEMINI_VIDEO_MODELS.map((id) => ({
        id,
        label: gemini.videoLabelFor(id),
        // Veo takes a resolution rather than an image size, and the route
        // already clamps it to this pair — see routes/imageToVideo.js.
        qualities: ["1080p", "720p"],
      })),
    },
    {
      group: "Text",
      models: gemini.GEMINI_TEXT_MODELS.map((id) => ({ id, label: id, qualities: [] })),
    },
  ];
}

/** Shapes a rule for the console. */
const toRule = (rule) => ({
  id: rule._id,
  label: rule.label,
  tenantId: rule.tenantId ? String(rule.tenantId) : null,
  tool: rule.tool ?? null,
  modelId: rule.modelId ?? null,
  quality: rule.quality ?? null,
  unit: rule.unit,
  providerRate: rule.providerRate ?? null,
  providerCurrency: rule.providerCurrency,
  creditsPerUnit: rule.creditsPerUnit,
  notes: rule.notes ?? null,
  active: rule.effectiveTo === null,
  effectiveFrom: rule.effectiveFrom,
  effectiveTo: rule.effectiveTo,
  createdAt: rule.createdAt,
  updatedAt: rule.updatedAt,
});

/**
 * Validates and normalizes the writable fields of a rule.
 *
 * Empty string and `null` both mean "wildcard" here — the console sends "" for
 * an unset dropdown, and treating that as the literal value would create a
 * rule that matches a model whose id is the empty string, i.e. nothing.
 *
 * Returns `{ error }` or `{ values }`.
 */
function readRuleFields(body, { partial = false } = {}) {
  const values = {};
  const has = (key) => body[key] !== undefined;
  const blankToNull = (value) => {
    const trimmed = typeof value === "string" ? value.trim() : value;
    return trimmed === "" || trimmed === null || trimmed === undefined ? null : trimmed;
  };

  if (has("label") || !partial) {
    const label = typeof body.label === "string" ? body.label.trim() : "";
    if (!label) return { error: "a label is required" };
    values.label = label;
  }

  if (has("tenantId")) {
    const tenantId = blankToNull(body.tenantId);
    if (tenantId !== null && !isId(tenantId)) return { error: "invalid organization id" };
    values.tenantId = tenantId;
  }

  if (has("tool")) {
    const tool = blankToNull(body.tool);
    if (tool !== null && !GENERATION_TOOLS.includes(tool)) {
      return { error: `tool must be one of: ${GENERATION_TOOLS.join(", ")}` };
    }
    values.tool = tool;
  }

  if (has("modelId")) values.modelId = blankToNull(body.modelId);
  if (has("quality")) values.quality = blankToNull(body.quality);
  if (has("notes")) values.notes = blankToNull(body.notes);

  if (has("unit") || !partial) {
    const unit = body.unit ?? "per_image";
    if (!PRICING_UNITS.includes(unit)) {
      return { error: `unit must be one of: ${PRICING_UNITS.join(", ")}` };
    }
    values.unit = unit;
  }

  if (has("providerCurrency")) {
    const currency = body.providerCurrency || "USD";
    if (!PRICING_CURRENCIES.includes(currency)) {
      return { error: `currency must be one of: ${PRICING_CURRENCIES.join(", ")}` };
    }
    values.providerCurrency = currency;
  }

  if (has("providerRate")) {
    const raw = blankToNull(body.providerRate);
    if (raw === null) {
      values.providerRate = null;
    } else {
      const rate = Number(raw);
      // A provider rate is a fraction of a cent per image in places, so it is
      // deliberately not rounded — only checked for being a real, non-negative
      // number.
      if (!Number.isFinite(rate) || rate < 0) return { error: "provider rate must be zero or more" };
      values.providerRate = rate;
    }
  }

  if (has("creditsPerUnit") || !partial) {
    const credits = Number(body.creditsPerUnit);
    if (!Number.isFinite(credits) || credits < 0) {
      return { error: "credits per unit must be zero or more" };
    }
    values.creditsPerUnit = credits;
  }

  return { values };
}

/** The dropdown contents the console needs to build its form. */
router.get(
  "/catalogue",
  handle(async (req, res) => {
    const tenants = await Tenant.find({ deletedAt: null }).select("name slug").sort({ name: 1 }).lean();

    res.json({
      status: "success",
      units: PRICING_UNITS,
      currencies: PRICING_CURRENCIES,
      // So the console can show a dollar rate in rupees too — see config.js.
      usdToInr: config.usdToInr,
      tools: GENERATION_TOOLS,
      models: priceableModels(),
      organizations: tenants.map((tenant) => ({
        id: String(tenant._id),
        name: tenant.name,
        slug: tenant.slug,
      })),
    });
  })
);

/** Every rule, newest first. Retired ones only when explicitly asked for. */
router.get(
  "/",
  handle(async (req, res) => {
    const includeRetired = req.query.includeRetired === "true";
    const filter = includeRetired ? {} : { effectiveTo: null };

    const rules = await CreditPricingRule.find(filter).sort({ createdAt: -1 }).exec();
    res.json({ status: "success", rules: rules.map(toRule) });
  })
);

router.post(
  "/",
  handle(async (req, res) => {
    const { error, values } = readRuleFields(req.body || {});
    if (error) return bad(res, error);

    const rule = await CreditPricingRule.create({
      ...values,
      createdByUserId: req.dbUser?._id ?? null,
    });

    logAudit({
      ...actorFrom(req),
      ...requestMeta(req),
      tenantId: rule.tenantId,
      action: "pricing_rule.created",
      status: "success",
      targetType: "creditPricingRule",
      targetId: String(rule._id),
      message: `created pricing rule "${rule.label}"`,
      metadata: {
        modelId: rule.modelId,
        tool: rule.tool,
        quality: rule.quality,
        unit: rule.unit,
        creditsPerUnit: rule.creditsPerUnit,
        providerRate: rule.providerRate,
      },
    });

    res.status(201).json({ status: "success", rule: toRule(rule) });
  })
);

router.patch(
  "/:id",
  handle(async (req, res) => {
    const { id } = req.params;
    if (!isId(id)) return bad(res, "invalid rule id");

    const rule = await CreditPricingRule.findById(id);
    if (!rule) return res.status(404).json({ status: "error", message: "pricing rule not found" });

    const { error, values } = readRuleFields(req.body || {}, { partial: true });
    if (error) return bad(res, error);

    const before = { creditsPerUnit: rule.creditsPerUnit, providerRate: rule.providerRate };
    rule.set(values);
    await rule.save();

    logAudit({
      ...actorFrom(req),
      ...requestMeta(req),
      tenantId: rule.tenantId,
      action: "pricing_rule.updated",
      status: "success",
      targetType: "creditPricingRule",
      targetId: String(rule._id),
      message: `updated pricing rule "${rule.label}"`,
      // Both sides of a rate change, so the audit log alone answers "what did
      // this cost before?" — the row itself only ever holds the current price.
      metadata: { before, after: { creditsPerUnit: rule.creditsPerUnit, providerRate: rule.providerRate } },
    });

    res.json({ status: "success", rule: toRule(rule) });
  })
);

/**
 * Retires a rule rather than deleting the row: a charge made under it must
 * stay explainable after the rule stops applying. `?purge=true` is the
 * escape hatch for a rule created by mistake that never priced anything.
 */
router.delete(
  "/:id",
  handle(async (req, res) => {
    const { id } = req.params;
    if (!isId(id)) return bad(res, "invalid rule id");

    const purge = req.query.purge === "true";
    const rule = await CreditPricingRule.findById(id);
    if (!rule) return res.status(404).json({ status: "error", message: "pricing rule not found" });

    if (purge) {
      await rule.deleteOne();
    } else {
      if (rule.effectiveTo) return bad(res, "that rule is already retired");
      rule.effectiveTo = new Date();
      await rule.save();
    }

    logAudit({
      ...actorFrom(req),
      ...requestMeta(req),
      tenantId: rule.tenantId,
      action: purge ? "pricing_rule.deleted" : "pricing_rule.retired",
      status: "success",
      targetType: "creditPricingRule",
      targetId: String(rule._id),
      message: `${purge ? "deleted" : "retired"} pricing rule "${rule.label}"`,
      metadata: { creditsPerUnit: rule.creditsPerUnit, providerRate: rule.providerRate },
    });

    res.json({ status: "success", rule: toRule(rule) });
  })
);

module.exports = router;
