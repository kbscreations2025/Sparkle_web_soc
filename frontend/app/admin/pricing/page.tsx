"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Coins, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
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
import { CELL, HEAD_ROW, TABLE_FRAME } from "@/components/admin/table";
import { cn } from "@/lib/utils";

const FIELD =
  "w-full rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-[12px] text-cream placeholder:text-faint outline-none focus:border-gold/40";

const UNIT_LABELS: Record<PricingUnit, string> = {
  per_image: "per image",
  per_request: "per request",
  per_second: "per second",
};

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

        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-[11px] text-muted">
            <input
              type="checkbox"
              checked={includeRetired}
              onChange={(event) => setIncludeRetired(event.target.checked)}
              className="accent-[var(--color-gold)]"
            />
            Show retired rules
          </label>

          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 rounded-lg border border-gold/30 bg-gold/15 px-3 py-1.5 text-[11px] font-semibold text-gold transition-colors hover:bg-gold/25"
          >
            <Plus size={13} /> New rule
          </button>
        </div>

        {loading ? (
          <p className="flex items-center gap-2 text-sm text-faint">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </p>
        ) : rules.length === 0 ? (
          <p className="text-sm text-muted">
            No pricing rules yet. Start with a wildcard catch-all so nothing is ever unpriced.
          </p>
        ) : (
          <div className={TABLE_FRAME}>
            <table className="w-full min-w-[1100px] border-collapse">
              <thead>
                <tr className={HEAD_ROW}>
                  <th className={CELL}>Label</th>
                  <th className={CELL}>Organization</th>
                  <th className={CELL}>Model</th>
                  <th className={CELL}>Tool</th>
                  <th className={CELL}>Quality</th>
                  <th className={CELL}>Unit</th>
                  <th className={cn(CELL, "text-right")}>Provider rate</th>
                  <th className={cn(CELL, "text-right")}>Our credits</th>
                  <th className={cn(CELL, "text-right")}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr
                    key={rule.id}
                    className={cn(
                      "border-t border-white/5 transition-colors hover:bg-white/[0.03]",
                      // A retired rule stays legible but visibly out of play.
                      !rule.active && "opacity-50"
                    )}
                  >
                    <td className={cn(CELL, "font-medium text-cream")}>
                      <span className="flex items-center gap-2">
                        {rule.label}
                        {!rule.active && (
                          <span className="rounded border border-white/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-faint">
                            Retired
                          </span>
                        )}
                      </span>
                      {rule.notes && (
                        <span className="mt-0.5 block text-[11px] text-faint">{rule.notes}</span>
                      )}
                    </td>
                    <td className={cn(CELL, "text-muted")}>
                      {rule.tenantId ? (orgNames.get(rule.tenantId) ?? "Unknown org") : <Any />}
                    </td>
                    <td className={cn(CELL, "text-muted")}>
                      {rule.modelId ? (modelLabels.get(rule.modelId) ?? rule.modelId) : <Any />}
                    </td>
                    <td className={cn(CELL, "text-muted")}>{rule.tool ?? <Any />}</td>
                    <td className={cn(CELL, "text-muted")}>{rule.quality ?? <Any />}</td>
                    <td className={cn(CELL, "text-muted")}>{UNIT_LABELS[rule.unit]}</td>
                    <td className={cn(CELL, "text-right tabular-nums text-muted")}>
                      {rule.providerRate === null ? (
                        <span className="text-faint">—</span>
                      ) : (
                        (() => {
                          const { primary, secondary } = formatRates(
                            rule.providerRate,
                            rule.providerCurrency,
                            catalogue?.usdToInr ?? 0
                          );
                          return (
                            <>
                              <span className="block">{primary}</span>
                              {secondary && (
                                <span className="block text-[11px] text-faint">{secondary}</span>
                              )}
                            </>
                          );
                        })()
                      )}
                    </td>
                    <td className={cn(CELL, "text-right tabular-nums font-medium text-gold")}>
                      {rule.creditsPerUnit}
                    </td>
                    <td className={cn(CELL, "text-right")}>
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={() => setEditing(rule)}
                          title="Edit this rule"
                          className="rounded border border-white/10 p-1.5 text-muted transition-colors hover:bg-white/[0.07] hover:text-cream"
                        >
                          <Pencil size={13} />
                        </button>
                        {rule.active && (
                          <button
                            onClick={() => handleRetire(rule)}
                            title="Retire this rule"
                            className="rounded border border-white/10 p-1.5 text-muted transition-colors hover:bg-error/[0.12] hover:text-error"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
            <select value={tenantId} onChange={(e) => setTenantId(e.target.value)} className={FIELD}>
              <option value={ANY}>Any (global)</option>
              {catalogue.organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Model">
            <select value={modelId} onChange={(e) => handleModelChange(e.target.value)} className={FIELD}>
              <option value={ANY}>Any model</option>
              {catalogue.models.map((group) => (
                <optgroup key={group.group} label={group.group}>
                  {group.models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>

          <Field label="Tool">
            <select value={tool} onChange={(e) => setTool(e.target.value)} className={FIELD}>
              <option value={ANY}>Any tool</option>
              {catalogue.tools.map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Quality"
            hint={modelId ? undefined : "Pick a model first — the sizes differ per model."}
          >
            <select
              value={quality}
              onChange={(e) => setQuality(e.target.value)}
              disabled={qualityOptions.length === 0}
              className={cn(FIELD, "disabled:opacity-50")}
            >
              <option value={ANY}>Any quality</option>
              {qualityOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Unit" hint="What both rates below are multiplied by.">
          <select
            value={unit}
            onChange={(e) => setUnit(e.target.value as PricingUnit)}
            className={FIELD}
          >
            {catalogue.units.map((option) => (
              <option key={option} value={option}>
                {UNIT_LABELS[option]}
              </option>
            ))}
          </select>
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
              <select
                value={providerCurrency}
                onChange={(e) => setProviderCurrency(e.target.value)}
                className={cn(FIELD, "w-24 shrink-0")}
              >
                {catalogue.currencies.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
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
