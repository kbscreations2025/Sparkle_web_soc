"use client";

import { Fragment, useEffect, useState, type FormEvent } from "react";
import { ChevronDown, ChevronRight, KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import {
  listOrganizations,
  getGrantCatalogue,
  listAiProviders,
  addAiProvider,
  updateAiProvider,
  deleteAiProvider,
  type Organization,
  type AiProvider,
} from "@/lib/api";
import { CELL, HEAD_ROW, TABLE_FRAME, NESTED_TABLE_FRAME } from "@/components/admin/table";
import { cn } from "@/lib/utils";

export default function ApiKeysPage() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [openId, setOpenId] = useState<string | null>(null);
  const [providers, setProviders] = useState<Record<string, AiProvider[]>>({});
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  /** The provider names the backend accepts — it owns the list, we just render it. */
  const [providerNames, setProviderNames] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    // Fetched together: neither depends on the other, so one round-trip's worth
    // of waiting rather than two.
    Promise.all([listOrganizations(), getGrantCatalogue()])
      .then(([orgs, catalogue]) => {
        if (cancelled) return;
        if (orgs.status === "success") setOrganizations(orgs.organizations ?? []);
        else setError(orgs.message || "Could not load organizations");
        if (catalogue.status === "success") setProviderNames(catalogue.providers ?? []);
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
  }, []);

  async function loadProviders(orgId: string) {
    setLoadingProviders(true);
    try {
      const result = await listAiProviders(orgId);
      if (result.status === "success") {
        setProviders((current) => ({ ...current, [orgId]: result.providers ?? [] }));
      } else {
        setError(result.message || "Could not load API keys");
      }
    } catch {
      setError("Could not reach the server");
    } finally {
      setLoadingProviders(false);
    }
  }

  async function toggleOpen(orgId: string) {
    if (openId === orgId) {
      setOpenId(null);
      return;
    }
    setOpenId(orgId);
    setAddingTo(null);
    await loadProviders(orgId);
  }

  function openAddForm(orgId: string) {
    if (openId !== orgId) toggleOpen(orgId);
    setAddingTo(orgId);
  }

  async function handleToggle(orgId: string, entry: AiProvider) {
    const result = await updateAiProvider(orgId, entry.id, { enabled: !entry.enabled });
    if (result.status === "success") await loadProviders(orgId);
    else setError(result.message || "Could not update that key");
  }

  async function handleDelete(orgId: string, entry: AiProvider) {
    const result = await deleteAiProvider(orgId, entry.id);
    if (result.status === "success") await loadProviders(orgId);
    else setError(result.message || "Could not delete that key");
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="space-y-1">
          <h1 className="font-serif text-2xl text-cream md:text-3xl">API Keys</h1>
          <p className="max-w-2xl text-sm text-muted">
            Expand an organization to manage its AI provider keys. Keys are encrypted at rest — only a
            short hint is ever shown here.
          </p>
        </header>

        {error && (
          <p className="rounded-lg border border-error/20 bg-error/[0.08] px-3 py-2 text-xs text-error">
            {error}
          </p>
        )}

        {loading ? (
          <p className="flex items-center gap-2 text-sm text-faint">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </p>
        ) : organizations.length === 0 ? (
          <p className="text-sm text-muted">No organizations yet.</p>
        ) : (
          <div className={TABLE_FRAME}>
            <table className="w-full min-w-[760px] border-collapse">
              <thead>
                <tr className={HEAD_ROW}>
                  <th className={cn(CELL, "w-10")} />
                  <th className={CELL}>Organization</th>
                  <th className={CELL}>Slug</th>
                  <th className={cn(CELL, "text-center")}>Keys</th>
                  <th className={cn(CELL, "text-right")}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {organizations.map((org) => {
                  const isOpen = openId === org.id;
                  return (
                    <Fragment key={org.id}>
                      <tr
                        className="cursor-pointer border-t border-white/5 transition-colors hover:bg-white/[0.03]"
                        onClick={() => toggleOpen(org.id)}
                      >
                        <td className={cn(CELL, "text-faint")}>
                          {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                        </td>
                        <td className={cn(CELL, "font-medium text-cream")}>{org.name}</td>
                        <td className={cn(CELL, "text-muted")}>/{org.slug}</td>
                        <td className={cn(CELL, "text-center tabular-nums text-cream")}>
                          {/* Once expanded, the live list is the source of truth. */}
                          {providers[org.id]?.length ?? org.aiProviderCount}
                        </td>
                        <td className={cn(CELL, "text-right")}>
                          <div
                            className="inline-flex items-center gap-1"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <button
                              onClick={() => openAddForm(org.id)}
                              title="Add a key"
                              className="rounded border border-white/10 p-1.5 text-muted transition-colors hover:bg-white/[0.07] hover:text-cream"
                            >
                              <Plus size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>

                      {isOpen && (
                        <tr className="border-t border-white/5">
                          <td colSpan={5} className="bg-surface-deep/30 px-4 py-4">
                            <div className="space-y-3">
                              {addingTo === org.id && (
                                <AddKeyForm
                                  orgId={org.id}
                                  orgName={org.name}
                                  providerNames={providerNames}
                                  onAdded={() => {
                                    setAddingTo(null);
                                    loadProviders(org.id);
                                  }}
                                  onClose={() => setAddingTo(null)}
                                />
                              )}

                              {loadingProviders && !providers[org.id] ? (
                                <p className="flex items-center gap-2 text-[12px] text-faint">
                                  <Loader2 size={12} className="animate-spin" /> Loading keys…
                                </p>
                              ) : (
                                <ProviderRows
                                  entries={providers[org.id] ?? []}
                                  onToggle={(entry) => handleToggle(org.id, entry)}
                                  onDelete={(entry) => handleDelete(org.id, entry)}
                                />
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function ProviderRows({
  entries,
  onToggle,
  onDelete,
}: {
  entries: AiProvider[];
  onToggle: (entry: AiProvider) => Promise<void>;
  onDelete: (entry: AiProvider) => Promise<void>;
}) {
  if (entries.length === 0) {
    return <p className="px-1 py-2 text-[12px] text-muted">No keys added for this organization yet.</p>;
  }

  return (
    <div className={NESTED_TABLE_FRAME}>
      <table className="w-full min-w-[560px] border-collapse">
        <thead>
          <tr className={HEAD_ROW}>
            <th className={CELL}>Provider</th>
            <th className={CELL}>Label</th>
            <th className={CELL}>Key</th>
            <th className={CELL}>Enabled</th>
            <th className={cn(CELL, "text-right")}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-t border-white/5">
              <td className={cn(CELL, "font-medium text-cream")}>{entry.provider}</td>
              <td className={cn(CELL, "text-muted")}>{entry.label}</td>
              <td className={cn(CELL, "font-mono text-muted")}>{entry.keyHint}</td>
              <td className={CELL}>
                <button
                  onClick={() => onToggle(entry)}
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-colors",
                    entry.enabled
                      ? "border-success/30 bg-success/10 text-success"
                      : "border-white/15 bg-white/[0.06] text-faint"
                  )}
                >
                  {entry.enabled ? "Enabled" : "Disabled"}
                </button>
              </td>
              <td className={cn(CELL, "text-right")}>
                <button
                  onClick={() => onDelete(entry)}
                  title="Delete this key"
                  className="rounded border border-error/20 p-1.5 text-error/70 transition-colors hover:bg-error/10 hover:text-error"
                >
                  <Trash2 size={13} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AddKeyForm({
  orgId,
  orgName,
  providerNames,
  onAdded,
  onClose,
}: {
  orgId: string;
  orgName: string;
  providerNames: string[];
  onAdded: () => void;
  onClose: () => void;
}) {
  const [provider, setProvider] = useState(providerNames[0] ?? "");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    if (!label.trim() || !apiKey.trim()) return;

    setAdding(true);
    setError("");
    try {
      const result = await addAiProvider(orgId, { provider, label: label.trim(), apiKey: apiKey.trim() });
      if (result.status !== "success") {
        setError(result.message || "Could not add that key");
        return;
      }
      setLabel("");
      setApiKey("");
      setProvider(providerNames[0] ?? "");
      onAdded();
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-gold/20 bg-surface-deep/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12px] font-medium text-cream">Add a key to {orgName}</p>
        <button
          onClick={onClose}
          className="shrink-0 rounded border border-white/10 px-2 py-1 text-[11px] text-muted transition-colors hover:text-cream"
        >
          Close
        </button>
      </div>

      {error && <p className="text-[11px] text-error">{error}</p>}

      <form onSubmit={handleAdd} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <select
          value={provider}
          onChange={(event) => setProvider(event.target.value)}
          className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-[12px] text-cream outline-none focus:border-gold/40"
        >
          {providerNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Label (e.g. Primary key)"
          className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-[12px] text-cream placeholder:text-faint outline-none focus:border-gold/40"
        />
        <input
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder="API key"
          type="password"
          className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-[12px] text-cream placeholder:text-faint outline-none focus:border-gold/40"
        />
        <button
          type="submit"
          disabled={adding || !label.trim() || !apiKey.trim()}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-gold/30 bg-gold/15 px-3 py-2 text-[11px] font-semibold text-gold transition-colors hover:bg-gold/25 disabled:opacity-50 sm:col-span-3"
        >
          {adding ? <Loader2 size={12} className="animate-spin" /> : <KeyRound size={12} />}
          Add key
        </button>
      </form>
    </div>
  );
}
