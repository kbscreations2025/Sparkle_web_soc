"use client";

import { Fragment, useCallback, useEffect, useState, type FormEvent } from "react";
import { ChevronDown, ChevronRight, Loader2, Plus, Trash2, UserPlus } from "lucide-react";
import {
  listOrganizations,
  createOrganization,
  updateOrganization,
  deleteOrganization,
  listMembers,
  addMember,
  updateMember,
  deleteMember,
  getGrantCatalogue,
  listAppUsers,
  type Organization,
  type Member,
  type GrantGroup,
  type AppUser,
} from "@/lib/api";
import { MemberRows } from "@/components/admin/MemberRows";
import { AddMemberPanel } from "@/components/admin/AddMemberPanel";
import { Modal } from "@/components/admin/Modal";
import { CELL, HEAD_ROW, TABLE_FRAME } from "@/components/admin/table";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<Organization["status"], string> = {
  active: "border-success/30 bg-success/10 text-success",
  trial: "border-gold/30 bg-gold/10 text-gold",
  suspended: "border-error/25 bg-error/[0.08] text-error",
  archived: "border-white/15 bg-white/[0.06] text-faint",
};

export default function ConsolePage() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [groups, setGroups] = useState<GrantGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Which organization is expanded, and its roster once fetched.
  const [openId, setOpenId] = useState<string | null>(null);
  const [members, setMembers] = useState<Record<string, Member[]>>({});
  const [loadingMembers, setLoadingMembers] = useState(false);

  // The central pool, fetched once and reused by every add panel.
  const [appUsers, setAppUsers] = useState<AppUser[]>([]);
  const [centralError, setCentralError] = useState("");
  const [centralLoading, setCentralLoading] = useState(false);
  const [addingTo, setAddingTo] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Folds responses into state. Only ever called from a promise callback or an
  // event handler — never synchronously inside an effect, which would cascade.
  const apply = useCallback(
    (
      orgs: Awaited<ReturnType<typeof listOrganizations>>,
      catalogue?: Awaited<ReturnType<typeof getGrantCatalogue>>
    ) => {
      if (orgs.status === "success") setOrganizations(orgs.organizations ?? []);
      else setError(orgs.message || "Could not load organizations");
      if (catalogue?.status === "success") setGroups(catalogue.groups ?? []);
      setLoading(false);
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    Promise.all([listOrganizations(), getGrantCatalogue()])
      .then(([orgs, catalogue]) => {
        if (!cancelled) apply(orgs, catalogue);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Could not reach the server");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apply]);

  async function reloadOrgs() {
    try {
      apply(await listOrganizations());
    } catch {
      setError("Could not reach the server");
    }
  }

  async function loadMembers(orgId: string) {
    setLoadingMembers(true);
    try {
      const result = await listMembers(orgId);
      if (result.status === "success") {
        setMembers((current) => ({ ...current, [orgId]: result.members ?? [] }));
      } else {
        setError(result.message || "Could not load members");
      }
    } catch {
      setError("Could not reach the server");
    } finally {
      setLoadingMembers(false);
    }
  }

  async function toggleOpen(orgId: string) {
    if (openId === orgId) {
      setOpenId(null);
      return;
    }
    setOpenId(orgId);
    setAddingTo(null);
    // Always re-read on expand: live session counts go stale in seconds.
    await loadMembers(orgId);
  }

  /** The central pool is the same for every organization, so fetch it once. */
  async function ensureAppUsers() {
    if (appUsers.length > 0 || centralLoading) return;

    setCentralLoading(true);
    setCentralError("");
    try {
      const result = await listAppUsers();
      if (result.status === "success") setAppUsers(result.users ?? []);
      else setCentralError(result.message || "Could not load the central user list");
    } catch {
      setCentralError("Could not reach the server");
    } finally {
      setCentralLoading(false);
    }
  }

  async function openAddPanel(orgId: string) {
    if (openId !== orgId) await toggleOpen(orgId);
    setAddingTo(orgId);
    await ensureAppUsers();
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!newName.trim()) return;

    setCreating(true);
    setError("");
    try {
      const result = await createOrganization(newName.trim());
      if (result.status === "success") {
        setNewName("");
        setShowNew(false);
        await reloadOrgs();
      } else {
        // The slug is derived from the name, so a duplicate name is the usual cause.
        setError(result.message || "Could not create that organization");
      }
    } catch {
      setError("Could not reach the server");
    } finally {
      setCreating(false);
    }
  }

  async function handleAddMember(orgId: string, person: AppUser) {
    setError("");
    // authUserId comes from the central list, so the row links immediately
    // instead of waiting to be matched by email on first sign-in.
    const result = await addMember(orgId, {
      email: person.email,
      name: person.name,
      authUserId: person.user_id,
    });
    if (result.status !== "success") {
      setError(result.message || "Could not add that person");
      return;
    }
    // Refresh both: the roster, and the central list's "already a member" marks.
    setAppUsers((rows) =>
      rows.map((row) =>
        row.user_id === person.user_id
          ? { ...row, organization: { id: orgId, name: "", slug: "" }, memberId: result.member?.id ?? null }
          : row
      )
    );
    await Promise.all([loadMembers(orgId), reloadOrgs()]);
  }

  async function handlePatchMember(orgId: string, id: string, patch: Parameters<typeof updateMember>[1]) {
    setError("");
    const result = await updateMember(id, patch);
    if (result.status === "success" && result.member) {
      setMembers((current) => ({
        ...current,
        [orgId]: (current[orgId] ?? []).map((row) => (row.id === id ? result.member! : row)),
      }));
      // The role label feeds the ADMINS count in the header row.
      if (patch.role !== undefined) await reloadOrgs();
    } else {
      setError(result.message || "Could not save that change");
    }
  }

  async function handleRemoveMember(orgId: string, member: Member) {
    setError("");
    const result = await deleteMember(member.id);
    if (result.status !== "success") {
      setError(result.message || "Could not remove that person");
      return;
    }
    setAppUsers((rows) =>
      rows.map((row) => (row.email === member.email ? { ...row, organization: null, memberId: null } : row))
    );
    await Promise.all([loadMembers(orgId), reloadOrgs()]);
  }

  async function handleDeleteOrg(org: Organization) {
    setError("");
    const result = await deleteOrganization(org.id);
    if (result.status !== "success") {
      setError(result.message || "Could not delete that organization");
      return;
    }
    setConfirmDelete(null);
    if (openId === org.id) setOpenId(null);
    // Its people were removed with it, so their central rows are free again.
    setAppUsers([]);
    await reloadOrgs();
  }

  async function toggleStatus(org: Organization) {
    const next = org.status === "suspended" ? "active" : "suspended";
    setOrganizations((rows) => rows.map((row) => (row.id === org.id ? { ...row, status: next } : row)));
    const result = await updateOrganization(org.id, { status: next });
    if (result.status !== "success") setError(result.message || "Could not update that organization");
    await reloadOrgs();
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h1 className="font-serif text-2xl text-cream md:text-3xl">Organizations</h1>
            <p className="max-w-2xl text-sm text-muted">
              Expand an organization to manage its people and what each of them can do — all in one place.
            </p>
          </div>

          <button
            onClick={() => setShowNew((value) => !value)}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-gold/30 bg-gold/15 px-3.5 py-2 text-xs font-semibold text-gold transition-colors hover:bg-gold/25"
          >
            <Plus size={14} /> New Organization
          </button>
        </header>

        {showNew && (
          <form
            onSubmit={handleCreate}
            className="flex flex-col gap-2 rounded-xl border border-gold/20 bg-surface-raised/60 p-3 sm:flex-row"
          >
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Organization name"
              aria-label="New organization name"
              autoFocus
              className="flex-1 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-cream placeholder:text-faint outline-none focus:border-gold/40"
            />
            <button
              type="submit"
              disabled={creating || !newName.trim()}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-gold/30 bg-gold/15 px-3.5 py-2 text-xs font-semibold text-gold transition-colors hover:bg-gold/25 disabled:opacity-50"
            >
              {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Create
            </button>
          </form>
        )}

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
          <p className="text-sm text-muted">No organizations yet. Create the first one above.</p>
        ) : (
          <div className={TABLE_FRAME}>
            <table className="w-full min-w-[760px] border-collapse">
              <thead>
                <tr className={HEAD_ROW}>
                  <th className={cn(CELL, "w-10")} />
                  <th className={CELL}>Organization</th>
                  <th className={CELL}>Slug</th>
                  <th className={CELL}>Status</th>
                  <th className={cn(CELL, "text-center")}>Admins</th>
                  <th className={cn(CELL, "text-center")}>Users</th>
                  <th className={cn(CELL, "text-right")}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {organizations.map((org) => {
                  const isOpen = openId === org.id;
                  return (
                    // Keyed on the fragment: the row and its detail row are one list item.
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
                        <td className={CELL}>
                          <span
                            className={cn(
                              "rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                              STATUS_TONE[org.status]
                            )}
                          >
                            {org.status}
                          </span>
                        </td>
                        <td className={cn(CELL, "text-center tabular-nums text-cream")}>{org.adminCount}</td>
                        <td className={cn(CELL, "text-center tabular-nums text-cream")}>{org.memberCount}</td>
                        <td className={cn(CELL, "text-right")}>
                          {/* Row clicks expand, so every button here stops propagation. */}
                          <div
                            className="inline-flex items-center gap-1"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <button
                              onClick={() => openAddPanel(org.id)}
                              title="Add a member"
                              className="rounded border border-white/10 p-1.5 text-muted transition-colors hover:bg-white/[0.07] hover:text-cream"
                            >
                              <UserPlus size={13} />
                            </button>

                            <button
                              onClick={() => toggleStatus(org)}
                              className="rounded border border-white/10 px-2 py-1 text-[10px] text-muted transition-colors hover:bg-white/[0.07] hover:text-cream"
                            >
                              {org.status === "suspended" ? "Reactivate" : "Suspend"}
                            </button>

                            {confirmDelete === org.id ? (
                              <span className="inline-flex items-center gap-1">
                                <button
                                  onClick={() => handleDeleteOrg(org)}
                                  className="rounded border border-error/40 bg-error/15 px-2 py-1 text-[10px] font-semibold text-error"
                                >
                                  Delete {org.memberCount > 0 && `+ ${org.memberCount}`}
                                </button>
                                <button
                                  onClick={() => setConfirmDelete(null)}
                                  className="rounded border border-white/10 px-2 py-1 text-[10px] text-muted hover:text-cream"
                                >
                                  No
                                </button>
                              </span>
                            ) : (
                              <button
                                onClick={() => setConfirmDelete(org.id)}
                                title="Delete this organization"
                                className="rounded border border-error/20 p-1.5 text-error/70 transition-colors hover:bg-error/10 hover:text-error"
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {isOpen && (
                        <tr className="border-t border-white/5">
                          <td colSpan={7} className="bg-surface-deep/30 px-4 py-4">
                            <div className="space-y-3">
                              {loadingMembers && !members[org.id] ? (
                                <p className="flex items-center gap-2 text-[12px] text-faint">
                                  <Loader2 size={12} className="animate-spin" /> Loading members…
                                </p>
                              ) : (
                                <MemberRows
                                  members={members[org.id] ?? []}
                                  groups={groups}
                                  onPatch={(id, patch) => handlePatchMember(org.id, id, patch)}
                                  onRemove={(member) => handleRemoveMember(org.id, member)}
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
            <AddMemberPanel
              orgId={org.id}
              orgName={org.name}
              appUsers={appUsers}
              loading={centralLoading}
              error={centralError}
              onAdd={(person) => handleAddMember(org.id, person)}
              onClose={() => setAddingTo(null)}
            />
          </Modal>
        );
      })()}
    </div>
  );
}
