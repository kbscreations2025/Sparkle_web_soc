"use client";

import { Fragment, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Eye, EyeOff, KeyRound, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
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
import { Modal } from "@/components/admin/Modal";
import { CELL, HEAD_ROW, TABLE_FRAME, NESTED_TABLE_FRAME } from "@/components/admin/table";
import { cn } from "@/lib/utils";

const FIELD =
  "w-full rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-[12px] text-cream placeholder:text-faint outline-none focus:border-gold/40";

/** Matches the schema default in backend/src/models/tenant.js. */
const DEFAULT_PRIORITY =1;

const PRIORITY_HELP =
  "Lowest priority runs first. Give the provider you want tried first the smaller number — e.g. gemini 1, openai 20.";

export default function ApiKeysPage() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [openId, setOpenId] = useState<string | null>(null);
  const [providers, setProviders] = useState<Record<string, AiProvider[]>>({});
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  /** Label + priority dialog, from the pencil in Actions. */
  const [editing, setEditing] = useState<{ orgId: string; entry: AiProvider } | null>(null);
  /** Key-only dialog, from the pencil beside the key. */
  const [replacingKey, setReplacingKey] = useState<{ orgId: string; entry: AiProvider } | null>(null);
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

  /**
   * Prefilled so a new key lands after the ones already there instead of
   * colliding at the same number. Still editable — it is only a starting point.
   */
  function nextPriorityFor(orgId: string) {
    const existing = providers[orgId] ?? [];
    if (existing.length === 0) return DEFAULT_PRIORITY;
    return Math.max(...existing.map((entry) => entry.priority)) + 1;
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
                              {loadingProviders && !providers[org.id] ? (
                                <p className="flex items-center gap-2 text-[12px] text-faint">
                                  <Loader2 size={12} className="animate-spin" /> Loading keys…
                                </p>
                              ) : (
                                <ProviderRows
                                  entries={providers[org.id] ?? []}
                                  onToggle={(entry) => handleToggle(org.id, entry)}
                                  onDelete={(entry) => handleDelete(org.id, entry)}
                                  onReplaceKey={(entry) => setReplacingKey({ orgId: org.id, entry })}
                                  onEditDetails={(entry) => setEditing({ orgId: org.id, entry })}
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

      {addingTo && (() => {
        const org = organizations.find((row) => row.id === addingTo);
        if (!org) return null;
        return (
          <Modal onClose={() => setAddingTo(null)}>
            <AddKeyForm
              orgId={org.id}
              orgName={org.name}
              providerNames={providerNames}
              nextPriority={nextPriorityFor(org.id)}
              onSaved={() => {
                setAddingTo(null);
                loadProviders(org.id);
              }}
              onClose={() => setAddingTo(null)}
            />
          </Modal>
        );
      })()}

      {replacingKey && (
        <Modal onClose={() => setReplacingKey(null)}>
          {/* Keyed on the entry so opening a different row starts a fresh,
              empty field rather than keeping what was typed for the last one. */}
          <ReplaceKeyForm
            key={replacingKey.entry.id}
            orgId={replacingKey.orgId}
            entry={replacingKey.entry}
            onSaved={() => {
              const { orgId } = replacingKey;
              setReplacingKey(null);
              loadProviders(orgId);
            }}
            onClose={() => setReplacingKey(null)}
          />
        </Modal>
      )}

      {editing && (
        <Modal onClose={() => setEditing(null)}>
          <EditDetailsForm
            key={editing.entry.id}
            orgId={editing.orgId}
            entry={editing.entry}
            onSaved={() => {
              const { orgId } = editing;
              setEditing(null);
              loadProviders(orgId);
            }}
            onClose={() => setEditing(null)}
          />
        </Modal>
      )}
    </div>
  );
}

function ProviderRows({
  entries,
  onToggle,
  onDelete,
  onReplaceKey,
  onEditDetails,
}: {
  entries: AiProvider[];
  onToggle: (entry: AiProvider) => Promise<void>;
  onDelete: (entry: AiProvider) => Promise<void>;
  onReplaceKey: (entry: AiProvider) => void;
  onEditDetails: (entry: AiProvider) => void;
}) {
  if (entries.length === 0) {
    return <p className="px-1 py-2 text-[12px] text-muted">No keys added for this organization yet.</p>;
  }

  return (
    <div className="space-y-1.5">
      <div className={NESTED_TABLE_FRAME}>
        <table className="w-full min-w-[640px] border-collapse">
          <thead>
            <tr className={HEAD_ROW}>
              <th className={cn(CELL, "w-20")}>Priority</th>
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
                <td className={cn(CELL, "tabular-nums text-cream")}>{entry.priority}</td>
                <td className={cn(CELL, "font-medium text-cream")}>{entry.provider}</td>
                <td className={cn(CELL, "text-muted")}>{entry.label}</td>
                <td className={CELL}>
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-muted">{entry.keyHint}</span>
                    {/* Beside the key, and only replaces the key. */}
                    <button
                      onClick={() => onReplaceKey(entry)}
                      title="Replace this key"
                      aria-label={`Replace the key for ${entry.label}`}
                      className="rounded border border-white/10 p-1 text-muted transition-colors hover:bg-white/[0.07] hover:text-cream"
                    >
                      <Pencil size={12} />
                    </button>
                  </span>
                </td>
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
                  <div className="inline-flex items-center gap-1">
                    {/* Everything except the key — that has its own button. */}
                    <button
                      onClick={() => onEditDetails(entry)}
                      title="Edit label and priority"
                      aria-label={`Edit details for ${entry.label}`}
                      className="rounded border border-white/10 p-1.5 text-muted transition-colors hover:bg-white/[0.07] hover:text-cream"
                    >
                      <Pencil size={13} />
                    </button>

                    <button
                      onClick={() => onDelete(entry)}
                      title="Delete this key"
                      className="rounded border border-error/20 p-1.5 text-error/70 transition-colors hover:bg-error/10 hover:text-error"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-faint">{PRIORITY_HELP}</p>
    </div>
  );
}

// ── shared form pieces ──────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="space-y-1">
      <span className="text-[10px] uppercase tracking-wider text-faint">{label}</span>
      {children}
    </label>
  );
}

/**
 * A key is only ever typed, never shown back: the server returns a hint and
 * nothing more, so this always starts blank. It can be revealed while typing
 * to check a paste, but is masked to begin with.
 */
function KeyInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const [show, setShow] = useState(false);

  return (
    <div className="relative">
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type={show ? "text" : "password"}
        // Never offer to remember a provider's secret as if it were a password.
        autoComplete="off"
        spellCheck={false}
        autoFocus
        className={cn(FIELD, "pr-9 font-mono")}
      />
      <button
        type="button"
        onClick={() => setShow((current) => !current)}
        title={show ? "Hide key" : "Show key"}
        aria-label={show ? "Hide key" : "Show key"}
        className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1.5 text-faint transition-colors hover:text-cream"
      >
        {show ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}

/** Title, error line, fields and submit — the frame all three dialogs share. */
function FormShell({
  title,
  error,
  onClose,
  onSubmit,
  saving,
  canSave,
  submitLabel,
  children,
}: {
  title: string;
  error: string;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  saving: boolean;
  canSave: boolean;
  submitLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12px] font-medium text-cream">{title}</p>
        <button
          onClick={onClose}
          className="shrink-0 rounded border border-white/10 px-2 py-1 text-[11px] text-muted transition-colors hover:text-cream"
        >
          Close
        </button>
      </div>

      {error && <p className="text-[11px] text-error">{error}</p>}

      <form onSubmit={onSubmit} className="space-y-2">
        {children}
        <button
          type="submit"
          disabled={saving || !canSave}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-gold/30 bg-gold/15 px-3 py-2 text-[11px] font-semibold text-gold transition-colors hover:bg-gold/25 disabled:opacity-50"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <KeyRound size={12} />}
          {submitLabel}
        </button>
      </form>
    </div>
  );
}

function PriorityField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <Field label="Priority">
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        type="number"
        min={0}
        step={1}
        className={FIELD}
      />
    </Field>
  );
}

function LabelField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <Field label="Label">
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="e.g. Primary key"
        className={FIELD}
      />
    </Field>
  );
}

// ── the three dialogs ───────────────────────────────────────────────────────

/** Adds a new key. The only form that picks a provider. */
function AddKeyForm({
  orgId,
  orgName,
  providerNames,
  nextPriority,
  onSaved,
  onClose,
}: {
  orgId: string;
  orgName: string;
  providerNames: string[];
  nextPriority: number;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [provider, setProvider] = useState(providerNames[0] ?? "");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [priority, setPriority] = useState(String(nextPriority));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = await addAiProvider(orgId, {
        provider,
        label: label.trim(),
        apiKey: apiKey.trim(),
        priority: Number(priority),
      });
      if (result.status !== "success") return setError(result.message || "Could not add that key");
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormShell
      title={`Add a key to ${orgName}`}
      error={error}
      onClose={onClose}
      onSubmit={handleSubmit}
      saving={saving}
      canSave={label.trim() !== "" && apiKey.trim() !== ""}
      submitLabel="Add key"
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label="Provider">
          <select value={provider} onChange={(event) => setProvider(event.target.value)} className={FIELD}>
            {providerNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </Field>

        <LabelField value={label} onChange={setLabel} />

        <Field label="API key">
          <KeyInput value={apiKey} onChange={setApiKey} placeholder="Only a hint is shown after saving" />
        </Field>

        <PriorityField value={priority} onChange={setPriority} />
      </div>

      <p className="text-[10px] text-faint">{PRIORITY_HELP}</p>
    </FormShell>
  );
}

/** Replaces the secret and nothing else — opened from the pencil beside the key. */
function ReplaceKeyForm({
  orgId,
  entry,
  onSaved,
  onClose,
}: {
  orgId: string;
  entry: AiProvider;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = await updateAiProvider(orgId, entry.id, { apiKey: apiKey.trim() });
      if (result.status !== "success") return setError(result.message || "Could not replace that key");
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormShell
      title={`Replace the key for ${entry.label}`}
      error={error}
      onClose={onClose}
      onSubmit={handleSubmit}
      saving={saving}
      canSave={apiKey.trim() !== ""}
      submitLabel="Replace key"
    >
      <Field label={`New ${entry.provider} key`}>
        <KeyInput value={apiKey} onChange={setApiKey} placeholder="Paste the new key" />
      </Field>

      <p className="text-[10px] text-faint">
        Saving replaces the stored key and clears this entry&apos;s failure history. Its label, priority
        and position are kept.
      </p>
    </FormShell>
  );
}

/** Label and priority. Deliberately has no key field — that is its own dialog. */
function EditDetailsForm({
  orgId,
  entry,
  onSaved,
  onClose,
}: {
  orgId: string;
  entry: AiProvider;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(entry.label);
  const [priority, setPriority] = useState(String(entry.priority));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = await updateAiProvider(orgId, entry.id, {
        label: label.trim(),
        priority: Number(priority),
      });
      if (result.status !== "success") return setError(result.message || "Could not save those changes");
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormShell
      title={`Edit ${entry.label}`}
      error={error}
      onClose={onClose}
      onSubmit={handleSubmit}
      saving={saving}
      canSave={label.trim() !== ""}
      submitLabel="Save changes"
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label="Provider">
          {/* Fixed: the credential is encrypted with the provider bound in, so
              moving a key to another provider would make it undecryptable. */}
          <p className={cn(FIELD, "text-muted")} title="A key can't move to another provider">
            {entry.provider}
          </p>
        </Field>

        <LabelField value={label} onChange={setLabel} />

        <PriorityField value={priority} onChange={setPriority} />
      </div>

      <p className="text-[10px] text-faint">{PRIORITY_HELP}</p>
    </FormShell>
  );
}

