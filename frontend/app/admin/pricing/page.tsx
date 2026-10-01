"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ChevronRight, Coins, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import {
  getPricingCatalogue,
  listPricingRules,
  createPricingRule,
  updatePricingRule,
  deletePricingRule,
  type PricingRule,
  type PricingCatalogue,
  type PricingUnit,
} from "@/lib/api";
import { Modal } from "@/components/admin/Modal";
import { COMPACT_CELL as T_CELL, HEAD_ROW, TABLE_FRAME } from "@/components/admin/table";
import { HoverInfo } from "@/components/ui/HoverInfo";
import { cn } from "@/lib/utils";
import { Select } from "@/components/ui/Select";
import { TableFilterBar, FILTER_FIELD as BAR_FIELD } from "@/components/admin/TableFilterBar";

const FIELD =
  "w-full rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-[12px] text-cream placeholder:text-faint outline-none focus:border-gold/40";

const UNIT_LABELS: Record<PricingUnit, string> = {
  per_image: "per image",
  per_request: "per request",
  per_second: "per second",
};

/** Beside the credit figure: what one unit is. */
const UNIT_SHORT: Record<PricingUnit, string> = {
  per_image: "/ image",
  per_request: "/ request",
  per_second: "/ sec",
};

/** The header cells: the compact table's padding, without its sticky positioning. */
const T_HEAD = "px-3 py-1.5";

/** The order the price table's sections appear in — providers, then what each makes. */
/** The one rule for no particular model — always first, never folded. */
const CATCH_ALL = "Catch-all";
const PROVIDER_ORDER = [CATCH_ALL, "Gemini", "OpenAI", "OpenRouter"];
const TYPE_ORDER = ["Image", "Video", "Text"];

/** The wildcard every match dropdown starts on. */
const ANY = "";

/** Reads as "applies to everything" in a cell, rather than an empty gap. */
function Any() {
  return <span className="text-faint">Any</span>;
}

/**
 * A provider rate as both a dollar and a rupee figure.
 *
 * Only one of the two is stored — whichever currency the rate was entered in
 * — and the other is converted at the configured rate. A rate quoted in euros
 * or pounds converts to neither, so it is shown as entered and the second
 * line is left off rather than invented.
 *
 * Dollars keep the full precision they were typed at: a provider rate can be
 * a fraction of a cent, and rounding it to two places would show $0.0031 as
 * $0.00. Rupees round to two, which is fine at ~96× the magnitude.
 */
function formatRates(rate: number, currency: string, usdToInr: number) {
  if (currency === "USD") return { primary: `$${rate}`, secondary: `₹${(rate * usdToInr).toFixed(2)}` };
  if (currency === "INR") return { primary: `₹${rate}`, secondary: `$${(rate / usdToInr).toFixed(4)}` };
  return { primary: `${currency} ${rate}`, secondary: null };
}

export default function PricingPage() {
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [catalogue, setCatalogue] = useState<PricingCatalogue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [includeRetired, setIncludeRetired] = useState(false);

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<PricingRule | null>(null);

  const loadRules = useCallback(async (withRetired: boolean) => {
    const result = await listPricingRules(withRetired);
    if (result.status === "success") setRules(result.rules ?? []);
    else setError(result.message || "Could not load the price table");
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Neither depends on the other, so one round-trip's worth of waiting.
    Promise.all([listPricingRules(includeRetired), getPricingCatalogue()])
      .then(([list, cat]) => {
        if (cancelled) return;
        if (list.status === "success") setRules(list.rules ?? []);
        else setError(list.message || "Could not load the price table");
        if (cat.status === "success") setCatalogue(cat);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Could not reach the server");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [includeRetired]);

  const orgNames = useMemo(() => {
    const map = new Map<string, string>();
    catalogue?.organizations.forEach((org) => map.set(org.id, org.name));
    return map;
  }, [catalogue]);

  const modelLabels = useMemo(() => {
    const map = new Map<string, string>();
    catalogue?.models.forEach((group) =>
      group.models.forEach((model) => map.set(model.id, model.label))
    );
    return map;
  }, [catalogue]);

  const [ruleQuery, setRuleQuery] = useState("");
  const ruleNeedle = ruleQuery.trim().toLowerCase();
  const visibleRules = useMemo(
    () =>
      ruleNeedle
        ? rules.filter((rule) =>
            [
              rule.label,
              rule.tenantId ? orgNames.get(rule.tenantId) : "any organization",
              rule.modelId ? modelLabels.get(rule.modelId) ?? rule.modelId : "any model",
              rule.tool ?? "any tool",
            ]
              .join(" ")
              .toLowerCase()
              .includes(ruleNeedle)
          )
        : rules,
    [rules, ruleNeedle, orgNames, modelLabels]
  );

  /*
   * Two levels, so the table reads like the product: who serves the model
   * (Gemini, OpenAI, OpenRouter), then what it makes (Image, Video, Text).
   * Both come from the catalogue group a model sits in — "Video (OpenRouter)"
   * — and a model missing from the catalogue is placed by its id and unit
   * instead. A rule for no particular model is the catch-all, on its own.
   */
  /* Folded providers. A search unfolds everything, so a match is never hidden. */
  const [collapsedProviders, setCollapsedProviders] = useState<Set<string>>(() => new Set());
  const isCollapsed = (provider: string) => provider !== CATCH_ALL && !ruleNeedle && collapsedProviders.has(provider);
  const toggleProvider = (provider: string) =>
    setCollapsedProviders((current) => {
      const next = new Set(current);
      if (next.has(provider)) next.delete(provider);
      else next.add(provider);
      return next;
    });

  const groupedRules = useMemo(() => {
    const placeOf = new Map<string, { provider: string; type: string }>();
    catalogue?.models.forEach((group) => {
      const [, type, provider] = group.group.match(/^(\w+)(?: \((.+)\))?/) ?? [];
      group.models.forEach((model) => placeOf.set(model.id, { provider: provider ?? "Gemini", type: type ?? "Other" }));
    });
    const typeByUnit: Record<PricingUnit, string> = { per_image: "Image", per_second: "Video", per_request: "Text" };
    const guessProvider = (id: string) => (id.includes("/") ? "OpenRouter" : id.startsWith("gpt") ? "OpenAI" : "Gemini");

    const tree = new Map<string, Map<string, PricingRule[]>>();
    for (const rule of visibleRules) {
      const place = !rule.modelId
        ? { provider: CATCH_ALL, type: "" }
        : (placeOf.get(rule.modelId) ?? { provider: guessProvider(rule.modelId), type: typeByUnit[rule.unit] });
      const types = tree.get(place.provider) ?? new Map<string, PricingRule[]>();
      types.set(place.type, [...(types.get(place.type) ?? []), rule]);
      tree.set(place.provider, types);
    }

    const rank = (order: string[], name: string) => order.indexOf(name) + 1 || order.length + 1;
    return [...tree.entries()]
      .sort(([a], [b]) => rank(PROVIDER_ORDER, a) - rank(PROVIDER_ORDER, b) || a.localeCompare(b))
      .map(([provider, types]) => ({
        provider,
        count: [...types.values()].reduce((sum, rules) => sum + rules.length, 0),
        sections: [...types.entries()]
          .sort(([a], [b]) => rank(TYPE_ORDER, a) - rank(TYPE_ORDER, b))
          .map(([type, rules]) => ({ type, rules })),
      }));
  }, [visibleRules, catalogue]);

  async function handleRetire(rule: PricingRule) {
    if (!confirm(`Retire "${rule.label}"? It stops pricing new runs but stays on record.`)) return;
    const result = await deletePricingRule(rule.id);
    if (result.status === "success") await loadRules(includeRetired);
    else setError(result.message || "Could not retire that rule");
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto max-w-[1400px] space-y-5">
        {error && (
          <p className="rounded-lg border border-error/20 bg-error/[0.08] px-3 py-2 text-xs text-error">
            {error}
          </p>
        )}

        {loading ? (
          <p className="flex items-center gap-2 text-sm text-faint">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </p>
        ) : rules.length === 0 ? (
          <p className="text-sm text-muted">
            No pricing rules yet. Start with a wildcard catch-all so nothing is ever unpriced.
          </p>
        ) : (
          <div>
          <TableFilterBar
            query={ruleQuery}
            onQuery={setRuleQuery}
            placeholder="Search label, organization, model or tool"
            onReset={() => {
              setRuleQuery("");
              setIncludeRetired(false);
            }}
            canReset={Boolean(ruleNeedle) || includeRetired}
            count={`${ruleNeedle ? `${visibleRules.length}/` : ""}${rules.length} rules`}
            trailing={
              <button
                onClick={() => setAdding(true)}
                className="flex h-[30px] shrink-0 items-center gap-1.5 rounded-lg border border-gold/30 bg-gold/15 px-3 text-[11px] font-semibold text-gold transition-colors hover:bg-gold/25"
              >
                <Plus size={13} /> <span className="hidden sm:inline">New rule</span>
              </button>
            }
          >
            <label
              title="Show retired rules"
              className={cn(
                BAR_FIELD,
                "flex shrink-0 cursor-pointer items-center gap-1.5",
                includeRetired && "border-gold/30 text-gold"
              )}
            >
              <input
                type="checkbox"
                checked={includeRetired}
                onChange={(event) => setIncludeRetired(event.target.checked)}
                className="accent-[var(--color-gold)]"
              />
              <span className="hidden sm:inline">Retired</span>
            </label>
          </TableFilterBar>
          <div className={cn(TABLE_FRAME, "rounded-t-none")}>
            <table className="w-full min-w-[860px] border-collapse">
              <thead>
                <tr className={HEAD_ROW}>
                  <th className={T_HEAD}>Rule</th>
                  <th className={T_HEAD}>Organization</th>
                  <th className={T_HEAD}>Model</th>
                  <th className={T_HEAD}>Tool</th>
                  <th className={T_HEAD}>Quality</th>
                  <th className={cn(T_HEAD, "text-right")}>Provider rate</th>
                  <th className={cn(T_HEAD, "text-right")}>Credits</th>
                  <th className={cn(T_HEAD, "w-16 text-right")} />
                </tr>
              </thead>
              <tbody>
                {visibleRules.length === 0 && (
                  <tr>
                    <td colSpan={8} className={cn(T_CELL, "py-4 text-center text-faint")}>
                      No rules match that search.
                    </td>
                  </tr>
                )}
                {groupedRules.map(({ provider, count, sections }) => (
                  <Fragment key={provider}>
                    {/* Provider, then what it makes — so a long price table
                        reads as sections rather than one undifferentiated list. */}
                    {/* The catch-all is one rule that underpins all the others,
                        so it sits first with no header and never folds away. */}
                    {provider !== CATCH_ALL && (
                    <tr
                      className="cursor-pointer select-none border-t border-gold/20 bg-gold/[0.08] transition-colors hover:bg-gold/[0.12]"
                      onClick={() => toggleProvider(provider)}
                      aria-expanded={!isCollapsed(provider)}
                    >
                      <td colSpan={8} className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-gold">
                        <span className="flex items-center gap-1.5">
                          <ChevronRight
                            size={13}
                            className={cn("shrink-0 transition-transform", !isCollapsed(provider) && "rotate-90")}
                          />
                          {provider}
                          <span className="font-medium text-faint">{count}</span>
                        </span>
                      </td>
                    </tr>
                    )}
                    {!isCollapsed(provider) && sections.map(({ type, rules: inGroup }) => (
                    <Fragment key={type}>
                    {type && (
                      <tr className="border-t border-white/5 bg-gold/[0.03]">
                        <td colSpan={8} className="py-1 pl-6 pr-3 text-[10px] font-semibold uppercase tracking-wider text-muted">
                          {type}
                          <span className="ml-1.5 font-medium text-faint">{inGroup.length}</span>
                        </td>
                      </tr>
                    )}
                    {inGroup.map((rule) => {
                      const rates =
                        rule.providerRate === null
                          ? null
                          : formatRates(rule.providerRate, rule.providerCurrency, catalogue?.usdToInr ?? 0);
                      return (
                        <tr
                          key={rule.id}
                          className={cn(
                            "border-t border-white/5 transition-colors hover:bg-gold/[0.04]",
                            // A retired rule stays legible but visibly out of play.
                            !rule.active && "opacity-50"
                          )}
                        >
                          <td className={cn(T_CELL, "font-medium text-cream")}>
                            <span className="flex items-center gap-1.5">
                              <span className="truncate">{rule.label}</span>
                              {/* The rationale is a sentence; it lives behind the
                                  icon so every row stays one line tall. */}
                              {rule.notes && <HoverInfo text={rule.notes} />}
                              {!rule.active && (
                                <span className="shrink-0 rounded border border-white/10 px-1 py-px text-[9px] uppercase tracking-wide text-faint">
                                  Retired
                                </span>
                              )}
                            </span>
                          </td>
                          <td className={cn(T_CELL, "text-muted")}>
                            {rule.tenantId ? (orgNames.get(rule.tenantId) ?? "Unknown org") : <Any />}
                          </td>
                          <td className={cn(T_CELL, "whitespace-nowrap text-muted")}>
                            {rule.modelId ? (modelLabels.get(rule.modelId) ?? rule.modelId) : <Any />}
                          </td>
                          <td className={cn(T_CELL, "text-muted")}>{rule.tool ?? <Any />}</td>
                          <td className={cn(T_CELL, "text-muted")}>{rule.quality ?? <Any />}</td>
                          <td className={cn(T_CELL, "whitespace-nowrap text-right tabular-nums text-muted")}>
                            {rates ? (
                              <>
                                {rates.primary}
                                {rates.secondary && <span className="ml-1.5 text-[10px] text-faint">{rates.secondary}</span>}
                              </>
                            ) : (
                              <span className="text-faint">—</span>
                            )}
                          </td>
                          <td className={cn(T_CELL, "whitespace-nowrap text-right tabular-nums")}>
                            <span className="font-semibold text-gold">{rule.creditsPerUnit}</span>
                            <span className="ml-1 text-[10px] text-faint">{UNIT_SHORT[rule.unit]}</span>
                          </td>
                          <td className={cn(T_CELL, "text-right")}>
                            <div className="inline-flex items-center gap-0.5">
                              <button
                                onClick={() => setEditing(rule)}
                                title="Edit this rule"
                                className="rounded p-1 text-muted transition-colors hover:bg-gold/[0.08] hover:text-cream"
                              >
                                <Pencil size={12} />
                              </button>
                              {rule.active && (
                                <button
                                  onClick={() => handleRetire(rule)}
                                  title="Retire this rule"
                                  className="rounded p-1 text-muted transition-colors hover:bg-error/[0.12] hover:text-error"
                                >
                                  <Trash2 size={12} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    </Fragment>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          </div>
        )}
      </div>

      {adding && catalogue && (
        <Modal onClose={() => setAdding(false)} className="max-w-2xl">
          <RuleForm
            catalogue={catalogue}
            onClose={() => setAdding(false)}
            onSaved={async () => {
              setAdding(false);
              await loadRules(includeRetired);
            }}
          />
        </Modal>
      )}

      {editing && catalogue && (
        <Modal onClose={() => setEditing(null)} className="max-w-2xl">
          {/* Keyed on the rule so opening a different row starts a fresh form
              rather than reusing the previous one's state. */}
          <RuleForm
            key={editing.id}
            catalogue={catalogue}
            rule={editing}
            onClose={() => setEditing(null)}
            onSaved={async () => {
              setEditing(null);
              await loadRules(includeRetired);
            }}
          />
        </Modal>
      )}
    </div>
  );
}

/**
 * Create and edit share one form: the fields are identical, and the only
 * difference is whether it POSTs or PATCHes. Two copies drifted the moment a
 * field was added to one of them.
 */
function RuleForm({
  catalogue,
  rule,
  onClose,
  onSaved,
}: {
  catalogue: PricingCatalogue;
  rule?: PricingRule;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [label, setLabel] = useState(rule?.label ?? "");
  const [tenantId, setTenantId] = useState(rule?.tenantId ?? ANY);
  const [modelId, setModelId] = useState(rule?.modelId ?? ANY);
  const [tool, setTool] = useState(rule?.tool ?? ANY);
  const [quality, setQuality] = useState(rule?.quality ?? ANY);
  const [unit, setUnit] = useState<PricingUnit>(rule?.unit ?? "per_image");
  const [providerRate, setProviderRate] = useState(
    rule?.providerRate === null || rule?.providerRate === undefined ? "" : String(rule.providerRate)
  );
  const [providerCurrency, setProviderCurrency] = useState(rule?.providerCurrency ?? "USD");
  const [creditsPerUnit, setCreditsPerUnit] = useState(
    rule ? String(rule.creditsPerUnit) : ""
  );
  const [notes, setNotes] = useState(rule?.notes ?? "");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Only the sizes the chosen model can actually run at — an empty list means
  // "any model", where no size can be offered because they differ per model.
  const qualityOptions = useMemo(() => {
    if (!modelId) return [];
    for (const group of catalogue.models) {
      const found = group.models.find((entry) => entry.id === modelId);
      if (found) return found.qualities;
    }
    return [];
  }, [catalogue, modelId]);

  /**
   * The rate restated in the other currency, shown under the field as you
   * type — so a dollar figure from a provider's price list can be sanity
   * checked in rupees without leaving the form.
   */
  const convertedRate = useMemo(() => {
    const parsed = Number(providerRate);
    if (providerRate.trim() === "" || !Number.isFinite(parsed)) return null;
    const { primary, secondary } = formatRates(parsed, providerCurrency, catalogue.usdToInr);
    if (!secondary) return null;
    return `${primary} ≈ ${secondary} at ₹${catalogue.usdToInr}/$`;
  }, [providerRate, providerCurrency, catalogue.usdToInr]);

  function handleModelChange(next: string) {
    setModelId(next);
    // The previously-picked size may not exist on the new model, and a rule
    // naming a size its model can't produce would never match anything.
    setQuality(ANY);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");

    const body = {
      label: label.trim(),
      tenantId: tenantId || null,
      modelId: modelId || null,
      tool: tool || null,
      quality: quality || null,
      unit,
      providerRate: providerRate.trim() === "" ? null : providerRate.trim(),
      providerCurrency,
      creditsPerUnit: creditsPerUnit.trim(),
      notes: notes.trim() || null,
    };

    try {
      const result = rule
        ? await updatePricingRule(rule.id, body)
        : await createPricingRule(body);

      if (result.status === "success") await onSaved();
      else setError(result.message || "Could not save that rule");
    } catch {
      setError("Could not reach the server");
    } finally {
      setSaving(false);
    }
  }

  const canSave = label.trim() !== "" && creditsPerUnit.trim() !== "";

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-medium text-cream">
            {rule ? `Edit "${rule.label}"` : "New pricing rule"}
          </p>
          <p className="mt-0.5 text-[11px] text-faint">
            Leave a match field on “Any” to make it a wildcard.
          </p>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 rounded border border-white/10 px-2 py-1 text-[11px] text-muted transition-colors hover:text-cream"
        >
          Close
        </button>
      </div>

      {error && <p className="text-[11px] text-error">{error}</p>}

      <form onSubmit={handleSubmit} className="space-y-3">
        <Field label="Label" hint="Your name for this rule — it appears on the charges it prices.">
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="e.g. 3 Pro @ 4K — standard"
            autoFocus
            className={FIELD}
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Organization" hint="Any = applies to every customer.">
            <Select
              value={tenantId}
              onChange={setTenantId}
              options={[
                { value: ANY, label: "Any (global)" },
                ...catalogue.organizations.map((org) => ({ value: org.id, label: org.name })),
              ]}
              className={FIELD}
            />
          </Field>

          <Field label="Model">
            <Select
              value={modelId}
              onChange={handleModelChange}
              options={[
                { value: ANY, label: "Any model" },
                ...catalogue.models.flatMap((group) =>
                  group.models.map((model) => ({ value: model.id, label: model.label, group: group.group }))
                ),
              ]}
              className={FIELD}
            />
          </Field>

          <Field label="Tool">
            <Select
              value={tool}
              onChange={setTool}
              options={[{ value: ANY, label: "Any tool" }, ...catalogue.tools.map((key) => ({ value: key, label: key }))]}
              className={FIELD}
            />
          </Field>

          <Field
            label="Quality"
            hint={modelId ? undefined : "Pick a model first — the sizes differ per model."}
          >
            <Select
              value={quality}
              onChange={setQuality}
              disabled={qualityOptions.length === 0}
              options={[{ value: ANY, label: "Any quality" }, ...qualityOptions.map((option) => ({ value: option, label: option }))]}
              className={cn(FIELD, "w-full disabled:opacity-50")}
            />
          </Field>
        </div>

        <Field label="Unit" hint="What both rates below are multiplied by.">
          <Select
            value={unit}
            onChange={(next) => setUnit(next as PricingUnit)}
            options={catalogue.units.map((option) => ({ value: option, label: UNIT_LABELS[option] }))}
            className={FIELD}
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Provider rate"
            hint={
              convertedRate ??
              "What the provider charges us. Reference only — nothing bills against it."
            }
          >
            <div className="flex gap-2">
              <Select
                value={providerCurrency}
                onChange={setProviderCurrency}
                options={catalogue.currencies.map((code) => ({ value: code, label: code }))}
                className={cn(FIELD, "w-24 shrink-0")}
              />
              <input
                value={providerRate}
                onChange={(event) => setProviderRate(event.target.value)}
                type="number"
                min={0}
                step="any"
                placeholder="0.24"
                className={FIELD}
              />
            </div>
          </Field>

          <Field label="Our credits" hint="What the customer is charged. This is the number that bills.">
            <input
              value={creditsPerUnit}
              onChange={(event) => setCreditsPerUnit(event.target.value)}
              type="number"
              min={0}
              step="any"
              placeholder="12"
              className={FIELD}
            />
          </Field>
        </div>

        <Field label="Notes" hint="Optional — why the rate is where it is.">
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={2}
            className={cn(FIELD, "resize-none")}
          />
        </Field>

        <button
          type="submit"
          disabled={saving || !canSave}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-gold/30 bg-gold/15 px-3 py-2 text-[11px] font-semibold text-gold transition-colors hover:bg-gold/25 disabled:opacity-50"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Coins size={12} />}
          {rule ? "Save changes" : "Create rule"}
        </button>
      </form>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-faint">{label}</span>
      {children}
      {hint && <span className="block text-[10px] leading-tight text-faint">{hint}</span>}
    </label>
  );
}
