"use client";

import { useMemo, useRef, useState } from "react";
import { Monitor, Shield, SlidersHorizontal, Trash2, Loader2 } from "lucide-react";
import type { GrantGroup, Member, DataScope, updateMember } from "@/lib/api";
import { Modal } from "@/components/admin/Modal";
import { NESTED_CELL as CELL, HEAD_ROW, NESTED_TABLE_FRAME } from "@/components/admin/table";
import { cn } from "@/lib/utils";

const ROLES = ["user", "admin"];
const STATUSES = ["invited", "active", "suspended", "removed"];

const SCOPE_HELP: Record<DataScope["kind"], string> = {
  own: "Only their own generated history.",
  organization: "Everyone's history in this organization.",
  selected: "Their own, plus only the people picked below.",
};

const SCOPE_LABEL: Record<DataScope["kind"], string> = {
  own: "None (only his)",
  organization: "All",
  selected: "Selected",
};

/** The wildcard grant is shown as a "select all" checkbox rather than a row in the list. */
const ALL_TOOLS_GRANT = "tool.*.run";

const STATUS_TONE: Record<string, string> = {
  active: "border-success/30 bg-success/10 text-success",
  invited: "border-gold/30 bg-gold/10 text-gold",
  suspended: "border-error/25 bg-error/[0.08] text-error",
  removed: "border-white/15 bg-white/[0.06] text-faint",
};

/** "21 Aug 2026", or "Never" for someone who has not signed in yet. */
function formatLastLogin(value?: string) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function MemberRows({
  members,
  groups,
  onPatch,
  onRemove,
}: {
  members: Member[];
  groups: GrantGroup[];
  onPatch: (id: string, patch: Parameters<typeof updateMember>[1]) => Promise<void>;
  onRemove: (member: Member) => Promise<void>;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (members.length === 0) {
    return <p className="px-4 py-6 text-[12px] text-muted">Nobody here yet. Use the add button above.</p>;
  }

  return (
    <div className={NESTED_TABLE_FRAME}>
      <table className="w-full min-w-[820px] border-collapse">
        <thead>
          <tr className={HEAD_ROW}>
            <th className={cn(CELL, "w-10")}>#</th>
            <th className={CELL}>Name</th>
            <th className={CELL}>Role</th>
            <th className={CELL}>Status</th>
            <th className={CELL}>Last login</th>
            <th className={CELL}>Active</th>
            <th className={cn(CELL, "text-right")}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {members.map((member, index) => (
            <MemberRow
              key={member.id}
              member={member}
              index={index + 1}
              peers={members.filter((row) => row.id !== member.id)}
              groups={groups}
              open={openId === member.id}
              onToggle={() => setOpenId(openId === member.id ? null : member.id)}
              onPatch={(patch) => onPatch(member.id, patch)}
              onRemove={() => onRemove(member)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MemberRow({
  member,
  index,
  peers,
  groups,
  open,
  onToggle,
  onPatch,
  onRemove,
}: {
  member: Member;
  index: number;
  peers: Member[];
  groups: GrantGroup[];
  open: boolean;
  onToggle: () => void;
  onPatch: (patch: Parameters<typeof updateMember>[1]) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const [removing, setRemoving] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Ticking several boxes must not lose any, and a save replaces the whole
  // array. Two things would break that:
  //
  //  1. Clicks in the same tick all see one pre-render value, so each would
  //     compute its set from the same base and send a one-item array. The ref
  //     is mutated synchronously, so the next click builds on the last.
  //  2. Four parallel requests are applied in arrival order, not send order.
  //     So only one is ever in flight and the newest desired state is queued
  //     behind it — every payload is complete, so coalescing loses nothing.
  const [pending, setPending] = useState<string[] | null>(null);
  const desired = useRef<string[] | null>(null);
  const queued = useRef<string[] | null>(null);
  const saving = useRef(false);

  const granted = useMemo(() => new Set(pending ?? member.permissions), [pending, member.permissions]);
  const scope = member.dataScope?.kind ?? "own";

  async function flushGrants() {
    if (saving.current) return;

    saving.current = true;
    try {
      while (queued.current) {
        const list = queued.current;
        queued.current = null;
        await onPatch({ permissions: list });
      }
    } finally {
      saving.current = false;
    }

    // Nothing further queued: the server now matches, so let the prop drive again.
    if (!queued.current) {
      desired.current = null;
      setPending(null);
    }
  }

  function toggleGrant(grant: string) {
    const next = new Set(desired.current ?? member.permissions);
    if (next.has(grant)) next.delete(grant);
    else next.add(grant);

    const list = [...next];
    desired.current = list; // synchronous, so the next click in this tick sees it
    queued.current = list;
    setPending(list); // reflect the tick immediately
    flushGrants();
  }

  /** "Select all" for a group: grants every listed permission at once, or clears them all. */
  function toggleAllGrants(grants: string[], shouldGrant: boolean) {
    const next = new Set(desired.current ?? member.permissions);
    for (const grant of grants) {
      if (shouldGrant) next.add(grant);
      else next.delete(grant);
    }

    const list = [...next];
    desired.current = list;
    queued.current = list;
    setPending(list);
    flushGrants();
  }

  function setScope(kind: DataScope["kind"]) {
    // "selected" needs at least one person, which the backend enforces too — so
    // seed it rather than firing a request that must fail.
    if (kind === "selected") {
      if (peers.length === 0) return;
      onPatch({ dataScope: { kind, userIds: [peers[0].id] } });
      return;
    }
    onPatch({ dataScope: { kind } });
  }

  function togglePeer(id: string) {
    const current = new Set(member.dataScope?.userIds ?? []);
    if (current.has(id)) current.delete(id);
    else current.add(id);
    // Unticking the last one would be rejected, so fall back to "own" — the
    // honest meaning of "reaches nobody else".
    if (current.size === 0) return onPatch({ dataScope: { kind: "own" } });
    onPatch({ dataScope: { kind: "selected", userIds: [...current] } });
  }

  async function handleRemove() {
    setRemoving(true);
    try {
      await onRemove();
    } finally {
      setRemoving(false);
      setConfirming(false);
    }
  }

  return (
    <>
      <tr className="border-t border-white/5 align-middle">
        <td className={cn(CELL, "text-faint")}>{index}</td>

        <td className={CELL}>
          <div className="flex items-center gap-1.5">
            {/* Marks the admin label at a glance, as in the roster design. */}
            {member.role === "admin" && <Shield size={12} className="shrink-0 text-gold/70" />}
            <div className="min-w-0">
              <p className="truncate font-medium text-cream">{member.name || member.email}</p>
              <p className="truncate text-[11px] text-gold/60">{member.email}</p>
            </div>
          </div>
        </td>

        <td className={CELL}>
          {/* Editable inline: role is only a label, so this changes nothing about access. */}
          <select
            value={member.role}
            onChange={(event) => onPatch({ role: event.target.value })}
            aria-label={`Role label for ${member.email}`}
            className="rounded border border-white/10 bg-white/[0.06] px-1.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-cream outline-none focus:border-gold/40"
          >
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </td>

        <td className={CELL}>
          <select
            value={member.status}
            onChange={(event) => onPatch({ status: event.target.value })}
            aria-label={`Account status for ${member.email}`}
            className={cn(
              "rounded border px-1.5 py-1 text-[10px] font-semibold uppercase tracking-wide outline-none",
              STATUS_TONE[member.status] ?? STATUS_TONE.removed
            )}
          >
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </td>

        <td className={cn(CELL, "whitespace-nowrap text-muted")}>{formatLastLogin(member.lastLoginAt)}</td>

        <td className={CELL}>
          {/* Live socket connections right now — open tabs and devices. */}
          <span
            className="relative inline-flex"
            title={
              member.liveSessions > 0
                ? `${member.liveSessions} open ${member.liveSessions === 1 ? "session" : "sessions"}`
                : "Not connected"
            }
          >
            <Monitor size={15} className={member.liveSessions > 0 ? "text-success" : "text-faint"} />
            {member.liveSessions > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-success px-1 text-[9px] font-bold text-void">
                {member.liveSessions}
              </span>
            )}
          </span>
        </td>

        <td className={cn(CELL, "text-right")}>
          <div className="inline-flex items-center gap-1">
            <button
              onClick={onToggle}
              aria-expanded={open}
              title="Permissions and data scope"
              className={cn(
                "rounded border p-1.5 transition-colors",
                open
                  ? "border-gold/40 bg-gold/15 text-gold"
                  : "border-white/10 text-muted hover:bg-white/[0.07] hover:text-cream"
              )}
            >
              <SlidersHorizontal size={13} />
            </button>

            {confirming ? (
              <span className="inline-flex items-center gap-1">
                <button
                  onClick={handleRemove}
                  disabled={removing}
                  className="rounded border border-error/40 bg-error/15 px-2 py-1 text-[10px] font-semibold text-error disabled:opacity-50"
                >
                  {removing ? <Loader2 size={11} className="animate-spin" /> : "Remove"}
                </button>
                <button
                  onClick={() => setConfirming(false)}
                  className="rounded border border-white/10 px-2 py-1 text-[10px] text-muted hover:text-cream"
                >
                  No
                </button>
              </span>
            ) : (
              <button
                onClick={() => setConfirming(true)}
                title="Remove from this organization"
                className="rounded border border-error/20 p-1.5 text-error/70 transition-colors hover:bg-error/10 hover:text-error"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        </td>
      </tr>

      {open && (
        <Modal onClose={onToggle} className="max-w-2xl">
          <div className="space-y-5 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[12px] font-medium text-cream">
                  Permissions for {member.name || member.email}
                </p>
                <p className="text-[11px] text-faint">{member.email}</p>
              </div>
              <button
                onClick={onToggle}
                className="shrink-0 rounded border border-white/10 px-2 py-1 text-[11px] text-muted transition-colors hover:text-cream"
              >
                Close
              </button>
            </div>

            <div className="max-h-[70vh] space-y-5 overflow-y-auto pr-1">
              {groups.map((group) => {
                const allGrant = group.grants.find(({ grant }) => grant === ALL_TOOLS_GRANT);
                const rest = allGrant ? group.grants.filter(({ grant }) => grant !== ALL_TOOLS_GRANT) : group.grants;
                const restGrantKeys = rest.map(({ grant }) => grant);
                // Ticked once every listed permission is — so unticking it clears them all.
                const allRestGranted = restGrantKeys.length > 0 && restGrantKeys.every((grant) => granted.has(grant));

                return (
                  <div key={group.id} className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-faint">
                        {group.label}
                      </p>
                      {allGrant && (
                        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-cream">
                          <input
                            type="checkbox"
                            checked={allRestGranted}
                            onChange={() => toggleAllGrants(restGrantKeys, !allRestGranted)}
                            className="accent-gold"
                          />
                          Select all
                        </label>
                      )}
                    </div>
                    <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
                      {rest.map(({ grant, label, hint }) => (
                        <label
                          key={grant}
                          title={hint}
                          className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/[0.04]"
                        >
                          <input
                            type="checkbox"
                            checked={granted.has(grant)}
                            onChange={() => toggleGrant(grant)}
                            className="mt-0.5 accent-gold"
                          />
                          <span className="min-w-0">
                            <span className="block text-[12px] text-cream">{label}</span>
                            {hint && <span className="block text-[10px] text-faint">{hint}</span>}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}

              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-faint">Users access</p>
                <div className="flex flex-wrap gap-1.5">
                  {(["organization", "own", "selected"] as const).map((kind) => (
                    <button
                      key={kind}
                      onClick={() => setScope(kind)}
                      disabled={kind === "selected" && peers.length === 0}
                      title={
                        kind === "selected" && peers.length === 0
                          ? "Needs another member in this organization first"
                          : SCOPE_HELP[kind]
                      }
                      className={cn(
                        "rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors disabled:opacity-40",
                        scope === kind
                          ? "border-gold/40 bg-gold/15 text-gold"
                          : "border-white/10 text-muted hover:bg-white/[0.07] hover:text-cream"
                      )}
                    >
                      {SCOPE_LABEL[kind]}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-faint">{SCOPE_HELP[scope]}</p>

                {/* Reaching other people's history needs the grant as well as
                    the scope — the scope alone widens nothing. */}
                {scope !== "own" && !granted.has("result.read.others") && (
                  <p className="text-[10px] text-gold/80">
                    This scope has no effect until “See other people&apos;s results” is ticked above.
                  </p>
                )}

                {scope === "selected" && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {peers.map((peer) => {
                      const picked = (member.dataScope?.userIds ?? []).includes(peer.id);
                      return (
                        <button
                          key={peer.id}
                          onClick={() => togglePeer(peer.id)}
                          className={cn(
                            "rounded-lg border px-2 py-1 text-[11px] transition-colors",
                            picked
                              ? "border-gold/40 bg-gold/15 text-gold"
                              : "border-white/10 text-muted hover:bg-white/[0.07] hover:text-cream"
                          )}
                        >
                          {peer.name || peer.email}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <p className="text-[10px] text-faint">
                permission version {member.permissionVersion}
                {!member.linked && " · has never signed in"}
              </p>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
