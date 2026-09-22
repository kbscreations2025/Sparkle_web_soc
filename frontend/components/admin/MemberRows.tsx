"use client";

import { useMemo, useRef, useState } from "react";
import { Minus, Monitor, Plus, Shield, SlidersHorizontal, Trash2, Loader2 } from "lucide-react";
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
  onGrantCredits,
  onReclaimCredits,
  assignableGrants,
  selfId,
  canRemove = true,
}: {
  members: Member[];
  groups: GrantGroup[];
  onPatch: (id: string, patch: Parameters<typeof updateMember>[1]) => Promise<void>;
  onRemove: (member: Member) => Promise<void>;
  /** Opens the grant dialog for this person. Optional so other callers need not offer it. */
  onGrantCredits?: (member: Member) => void;
  /** Takes credits back off this person. Omitted where the caller cannot. */
  onReclaimCredits?: (member: Member) => void;
  /**
   * The grants this viewer may hand out. Undefined means every grant —
   * the super admin console. An organization admin gets the subset they
   * hold themselves, and the rest render disabled with a reason, because a
   * checkbox that saves and then reverts is worse than one that says why
   * it cannot be ticked.
   */
  assignableGrants?: string[];
  /** The viewer's own id: their row is read-only, since nobody edits their own permissions. */
  selfId?: string;
  /** False on the organization page — removing people stays with the console. */
  canRemove?: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (members.length === 0) {
    return <p className="px-4 py-6 text-[12px] text-muted">Nobody here yet. Use the add button above.</p>;
  }

  return (
    <div className={NESTED_TABLE_FRAME}>
      <table className="w-full border-collapse">
        <thead>
          <tr className={HEAD_ROW}>
            <th className={cn(CELL, "hidden w-10 sm:table-cell")}>#</th>
            <th className={CELL}>Name</th>
            <th className={cn(CELL, "hidden md:table-cell")}>Role</th>
            <th className={CELL}>Status</th>
            <th className={cn(CELL, "hidden lg:table-cell")}>Last login</th>
            <th className={cn(CELL, "hidden lg:table-cell")}>Active</th>
            <th className={cn(CELL, "text-center")}>Credits</th>
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
              onGrantCredits={onGrantCredits}
              onReclaimCredits={onReclaimCredits}
              assignableGrants={assignableGrants}
              readOnly={Boolean(selfId) && String(member.id) === String(selfId)}
              canRemove={canRemove}
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
  onGrantCredits,
  onReclaimCredits,
  assignableGrants,
  readOnly = false,
  canRemove = true,
}: {
  member: Member;
  index: number;
  peers: Member[];
  groups: GrantGroup[];
  open: boolean;
  onToggle: () => void;
  onPatch: (patch: Parameters<typeof updateMember>[1]) => Promise<void>;
  onRemove: () => Promise<void>;
  onGrantCredits?: (member: Member) => void;
  onReclaimCredits?: (member: Member) => void;
  assignableGrants?: string[];
  /** This is the viewer's own row: shown, but not editable. */
  readOnly?: boolean;
  canRemove?: boolean;
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

  /**
   * Whether the organization-wide section is offered.
   *
   * The only place `role` decides what is *shown*, and it still decides
   * nothing about what is *allowed* — permissions.js remains the sole
   * authority, and says so. It covers the organization's credits, audit log
   * and people; the data scope is deliberately not in that set, because
   * being pointed at a colleague's results is not an admin power.
   *
   * The server backs this up by stripping those grants when a role drops to
   * "user", so hiding them never hides something still in force.
   */
  const isAdmin = member.role === "admin";

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
        <td className={cn(CELL, "hidden text-faint sm:table-cell")}>{index}</td>

        <td className={CELL}>
          <div className="flex items-center gap-1.5">
            {/* Marks the admin label at a glance, as in the roster design. */}
            {member.role === "admin" && <Shield size={12} className="shrink-0 text-gold/70" />}
            <div className="min-w-0">
              <p className="truncate font-medium text-cream">
                {member.name || member.email}
                {/* The reader's own row, which the server sorts to the top.
                    Without the label the ordering reads as a bug. */}
                {readOnly && (
                  <span className="ml-1.5 rounded bg-gold/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-gold">
                    You
                  </span>
                )}
              </p>
              <p className="truncate text-[11px] text-gold/60">{member.email}</p>
            </div>
          </div>
        </td>

        <td className={cn(CELL, "hidden md:table-cell")}>
          {/* Editable inline: role is only a label, so this changes nothing about access. */}
          <select
            value={member.role}
            onChange={(event) => onPatch({ role: event.target.value })}
            disabled={readOnly}
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
            disabled={readOnly}
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

        <td className={cn(CELL, "hidden whitespace-nowrap text-muted lg:table-cell")}>{formatLastLogin(member.lastLoginAt)}</td>

        <td className={cn(CELL, "hidden lg:table-cell")}>
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

        {/* What this person can spend, and a + to top them up.
            `available` rather than `balance`: credits frozen by a run
            already going cannot pay for the next one, so it is the figure
            that decides whether their next click works. Zero is called out
            because charging is enforced — they cannot generate at all. */}
        <td className={cn(CELL, "text-center")}>
          {/* Read as a stepper: take away on the left, the figure, add on
              the right. Both controls on one side made the pair read as two
              unrelated buttons that happened to sit next to a number. */}
          <div className="inline-flex items-center gap-1.5">
            {onReclaimCredits && (
              <button
                onClick={() => onReclaimCredits(member)}
                title={`Take credits back from ${member.name || member.email}`}
                className="rounded-full border border-white/15 p-0.5 text-muted transition-colors hover:border-error/40 hover:text-error"
              >
                <Minus size={11} />
              </button>
            )}
            <span
              title={
                `${member.credits.balance.toLocaleString()} held · ` +
                `${member.credits.reserved.toLocaleString()} frozen by runs in progress`
              }
              className={cn("tabular-nums", member.credits.available === 0 ? "text-error" : "text-cream")}
            >
              {member.credits.available.toLocaleString()}
            </span>
            {onGrantCredits && (
              <button
                onClick={() => onGrantCredits(member)}
                title={`Give credits to ${member.name || member.email}`}
                className="rounded-full border border-gold/30 p-0.5 text-gold/80 transition-colors hover:bg-gold/10 hover:text-gold"
              >
                <Plus size={11} />
              </button>
            )}
          </div>
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
              canRemove && (
                <button
                  onClick={() => setConfirming(true)}
                  title="Remove from this organization"
                  className="rounded border border-error/20 p-1.5 text-error/70 transition-colors hover:bg-error/10 hover:text-error"
                >
                  <Trash2 size={13} />
                </button>
              )
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
              {/* Only the organization-wide section is withheld — its
                  credits, its audit trail, its people. How far someone sees
                  into colleagues' work is the data scope below, and any
                  member can be given one. */}
              {!isAdmin && (
                <p className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[11px] leading-relaxed text-faint">
                  Change the role to <span className="text-cream">admin</span> to also offer the organization-wide
                  permissions — its credits, its audit log and managing colleagues.
                </p>
              )}

              {groups.map((group) => {
                /*
                 * Organization-level permissions are for admins only.
                 * Hidden rather than disabled: an unticked box a member is
                 * not eligible for reads as something you forgot to grant,
                 * where an absent section reads as not applicable.
                 */
                if (group.id === "organization" && !isAdmin) return null;

                /*
                 * Grants the backend marks as not-a-choice are not offered:
                 * `result.read.own` is the baseline everybody gets, and
                 * `result.read.others` follows the data scope. Between them
                 * that empties the Results group, and the check below drops
                 * the heading with it rather than leaving an empty section.
                 */
                const offered = group.grants.filter((entry) => !entry.hidden);
                if (offered.length === 0) return null;

                const allGrant = offered.find(({ grant }) => grant === ALL_TOOLS_GRANT);
                const rest = allGrant ? offered.filter(({ grant }) => grant !== ALL_TOOLS_GRANT) : offered;
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
                            // Off when any of the group is not this viewer's
                            // to give — "select all" must not be a way round
                            // the individual checks.
                            disabled={
                              readOnly ||
                              (Boolean(assignableGrants) &&
                                !restGrantKeys.every((grant) => assignableGrants!.includes(grant)))
                            }
                            onChange={() => toggleAllGrants(restGrantKeys, !allRestGranted)}
                            className="accent-gold"
                          />
                          Select all
                        </label>
                      )}
                    </div>
                    <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
                      {rest.map(({ grant, label, hint }) => {
                        // Lockable for two different reasons, and the title
                        // says which: it is your own row, or it is a
                        // permission you do not hold and so cannot pass on.
                        const notYours = Boolean(assignableGrants) && !assignableGrants!.includes(grant);
                        const locked = readOnly || notYours;

                        return (
                          <label
                            key={grant}
                            title={
                              readOnly
                                ? "You cannot change your own permissions"
                                : notYours
                                  ? "You do not have this permission yourself, so you cannot give it"
                                  : hint
                            }
                            className={cn(
                              "flex items-start gap-2 rounded-lg px-2 py-1.5 transition-colors",
                              locked ? "cursor-not-allowed opacity-45" : "cursor-pointer hover:bg-white/[0.04]"
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={granted.has(grant)}
                              disabled={locked}
                              onChange={() => toggleGrant(grant)}
                              className="mt-0.5 accent-gold"
                            />
                            <span className="min-w-0">
                              <span className="block text-[12px] text-cream">{label}</span>
                              {hint && <span className="block text-[10px] text-faint">{hint}</span>}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {/* Offered to every member, admin or not: being pointed at a
                  colleague's work is not an admin power. This is now the
                  only control over it — the grant it implies is derived
                  from whatever is picked here. */}
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
