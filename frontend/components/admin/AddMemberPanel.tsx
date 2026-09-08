"use client";

import { useMemo, useState } from "react";
import { Loader2, Search, UserPlus } from "lucide-react";
import type { AppUser } from "@/lib/api";

/**
 * The pool comes from the central login (GET /api/v1/app-users, fetched with
 * the service's client id/secret), so a super admin picks a real Sparkle
 * account rather than typing an email and hoping it matches one. This is the
 * only way to add someone — there is deliberately no manual/email fallback,
 * so nobody can be added who isn't already known to the central login.
 */
export function AddMemberPanel({
  orgId,
  orgName,
  appUsers,
  loading,
  error,
  onAdd,
  onClose,
}: {
  orgId: string;
  orgName: string;
  appUsers: AppUser[];
  loading: boolean;
  error?: string;
  onAdd: (person: AppUser) => Promise<void>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return appUsers
      // Central super admins already have the run of the whole console — they
      // don't belong inside any one organization's roster.
      .filter((person) => person.role !== "super_admin")
      // Already in an organization — this one or another — so there is
      // nothing useful this row can do; one person belongs to one roster.
      .filter((person) => !person.organization)
      .filter((person) => !needle || person.email.toLowerCase().includes(needle));
  }, [appUsers, query, orgId]);

  async function add(person: AppUser) {
    setBusyId(person.user_id);
    try {
      await onAdd(person);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-gold/20 bg-surface-deep/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-medium text-cream">Add someone to {orgName}</p>
          <p className="text-[11px] text-faint">
            Only people the central login has granted access to Sparkle can be added here. They join
            with no permissions — you grant those next.
          </p>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 rounded border border-white/10 px-2 py-1 text-[11px] text-muted transition-colors hover:text-cream"
        >
          Close
        </button>
      </div>

      {!error && (
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-2.5 text-faint" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by email"
            aria-label="Search central users"
            className="w-full rounded-lg border border-white/10 bg-white/[0.06] py-2 pl-8 pr-3 text-[12px] text-cream placeholder:text-faint outline-none focus:border-gold/40"
          />
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-error/25 bg-error/[0.08] px-3 py-2.5 text-[11px] text-error">
          The central user list isn&apos;t available: {error}
        </p>
      )}

      {error ? null : loading ? (
        <p className="flex items-center gap-2 text-[11px] text-faint">
          <Loader2 size={12} className="animate-spin" /> Loading Sparkle users from the central login…
        </p>
      ) : matches.length === 0 ? (
        <p className="text-[11px] text-muted">
          {appUsers.length === 0
            ? "The central login returned nobody for this app."
            : "Everyone matching is already in an organization."}
        </p>
      ) : (
        <ul className="max-h-64 space-y-1 overflow-y-auto">
          {matches.map((person) => (
            <li
              key={person.user_id}
              className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.03] px-2.5 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] text-cream">{person.name || person.email}</p>
                <p className="truncate text-[10px] text-faint">{person.email}</p>
              </div>

              <button
                onClick={() => add(person)}
                disabled={busyId === person.user_id}
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-gold/30 bg-gold/10 px-2.5 py-1.5 text-[11px] font-semibold text-gold transition-colors hover:bg-gold/20 disabled:opacity-50"
              >
                {busyId === person.user_id ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <UserPlus size={12} />
                )}
                Add
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
