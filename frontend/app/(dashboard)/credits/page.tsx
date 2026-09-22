"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Coins, Minus, Plus, RefreshCw } from "lucide-react";
import {
  distributeCredits,
  fetchCreditLedger,
  fetchCreditTenant,
  fetchCreditTenants,
  fetchMyOrgCredits,
  fetchOrgMembers,
  grantCredits,
  reclaimCredits,
  revokeCredits,
  updateOrgMember,
  type updateMember,
  type CreditEntry,
  type CreditMember,
  type CreditTenantSummary,
} from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/permissions";
import { ConfirmDialog } from "@/components/studio/ConfirmDialog";
import { MemberRows } from "@/components/admin/MemberRows";
import { CreditAmountDialog } from "@/components/admin/CreditAmountDialog";
import { cn } from "@/lib/utils";


/**
 * Credits: who holds them, and the console for issuing them.
 *
 * Platform staff only — a customer cannot reach this however privileged they
 * are inside their own organization, because issuing credit to yourself is
 * not an organizational action. The server enforces the same rule; this
 * check only decides what to render.
 *
 * Two levels, not a tree: the list of organizations, and one organization's
 * members. A single flat table of every user across every tenant would be
 * unreadable at the point it actually matters.
 */
export default function CreditsPage() {
  const { user } = useAuth();

  /*
   * A dispatcher, and deliberately hook-free beyond `useAuth`.
   *
   * The two views have different state, and choosing between them with an
   * early return *above* their hooks is what React's rules forbid — the
   * hook count would change the moment `user` arrived and the branch
   * flipped. Separate components keep each one's hooks unconditional.
   */
  if (user?.isSuperAdmin) return <StaffCredits />;
  // No `|| isPlatformAdmin` here: `can()` applies that bypass itself now, so
  // this and the menu link ask the same question and get the same answer.
  if (can(user, "org.credits.read")) return <MyOrgCredits />;

  return (
    <div className="flex-1 overflow-y-auto px-8 py-8">
      <p className="text-sm text-muted">
        Your organization&apos;s credits are managed by its admins. Ask one of them for more.
      </p>
    </div>
  );
}

/**
 * Across every organization: what each holds, and the console for issuing
 * more. The central super admin only — issuing credit from nothing is the
 * one act that stays with whoever carries the cost.
 */
function StaffCredits() {
  const [tenants, setTenants] = useState<CreditTenantSummary[] | null>(null);
  const [openTenantId, setOpenTenantId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetchCreditTenants();
    if (res.status === "success") {
      setTenants(res.tenants);
      setError("");
    } else {
      setError(res.message || "Could not load organizations.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (openTenantId) {
    return <TenantCredits tenantId={openTenantId} onBack={() => { setOpenTenantId(null); load(); }} />;
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto max-w-5xl space-y-4">
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Coins size={18} className="text-gold/70" />
            <h1 className="text-sm font-semibold text-cream">Credits by organization</h1>
          </div>
          <button
            type="button"
            onClick={load}
            className="flex min-h-8 items-center gap-1.5 rounded-lg border border-white/[0.08] px-2.5 py-1.5 text-[11px] font-medium text-muted transition-colors hover:border-white/[0.16] hover:text-cream"
          >
            <RefreshCw size={12} /> Refresh
          </button>
        </header>

        {error && (
          <p className="rounded-lg border border-error/20 bg-error/[0.08] px-3 py-2 text-xs text-error">{error}</p>
        )}

        {tenants === null ? (
          <p className="py-10 text-center text-sm text-faint">Loading…</p>
        ) : tenants.length === 0 ? (
          <p className="py-10 text-center text-sm text-faint">No organizations yet.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-white/[0.08]">
            <table className="w-full text-left text-xs">
              <thead className="bg-white/[0.03] text-[10px] uppercase tracking-wider text-faint">
                <tr>
                  <th className="px-3 py-2 font-medium">Organization</th>
                  <th className="px-3 py-2 text-right font-medium">Pool</th>
                  <th className="px-3 py-2 text-right font-medium">Total held</th>
                  <th className="px-3 py-2 text-right font-medium">Frozen</th>
                  <th className="px-3 py-2 text-right font-medium">Members</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((tenant) => (
                  <tr
                    key={tenant.id}
                    onClick={() => setOpenTenantId(tenant.id)}
                    className="cursor-pointer border-t border-white/[0.05] transition-colors hover:bg-white/[0.03]"
                  >
                    <td className="px-3 py-2.5">
                      <span className="font-medium text-cream">{tenant.name}</span>
                      <span className="ml-2 text-faint">{tenant.slug}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted">
                      {(tenant.pool?.balance ?? 0).toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium tabular-nums text-cream">
                      {tenant.totalBalance.toLocaleString()}
                    </td>
                    {/* Frozen is worth its own column: an organization that
                        looks short may simply have work in flight. */}
                    <td className="px-3 py-2.5 text-right tabular-nums text-faint">
                      {tenant.totalReserved.toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted">{tenant.memberCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-[11px] leading-relaxed text-faint">
          A run is charged to the person who made it, and someone with no credits cannot generate — nothing falls back
          to the organization pool yet. Grant to a member directly to unblock them.
        </p>
      </div>
    </div>
  );
}

/**
 * An organization admin's view of their own organization.
 *
 * The one difference from the staff view is what the buttons do: an admin
 * *shares out* what the organization already holds, they do not create it.
 * So the pool has no grant control, and every hand-out is checked against
 * what is in the pool — an organization that has run out has to ask
 * platform staff for more.
 */
function MyOrgCredits() {
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchMyOrgCredits>> | null>(null);
  const [roster, setRoster] = useState<Awaited<ReturnType<typeof fetchOrgMembers>> | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<{
    userId: string;
    holder: string;
    mode: "distribute" | "reclaim";
    /** What they hold now, so the dialog can show what it becomes. */
    balance: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  /*
   * Two requests: the pool and balances, and the roster with the grant
   * catalogue. An admin without `org.members.manage` gets a 403 on the
   * second, which leaves `roster` null and shows the read-only notice
   * instead of the editable table.
   */
  const load = useCallback(async () => {
    // Independent requests, so they go together rather than one after the
    // other — this is time-to-first-paint on the page's only content.
    const [res, people] = await Promise.all([fetchMyOrgCredits(), fetchOrgMembers()]);

    if (res.status !== "success") {
      setError(res.message || "Could not load your organization's credits.");
      return;
    }
    setData(res);
    setRoster(people.status === "success" ? people : null);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Saves one permission change.
   *
   * The refusals are the interesting part: the server rejects an edit to
   * the admin's own row, and any grant they do not hold themselves. The UI
   * disables both, so arriving here means something was out of date — the
   * reason is surfaced and the roster re-read, rather than leaving a
   * checkbox showing a state the server never accepted.
   */
  const patchMember = useCallback(async (id: string, patch: Parameters<typeof updateMember>[1]) => {
    const res = await updateOrgMember(id, patch);
    setError(res.status === "success" ? "" : res.message || "That change was not allowed.");

    const people = await fetchOrgMembers();
    if (people.status === "success") setRoster(people);
  }, []);

  async function apply(amount: number) {
    if (!pending) return;
    setBusy(true);
    setError("");
    try {
      const body = { userId: pending.userId, amount };
      const res = pending.mode === "distribute" ? await distributeCredits(body) : await reclaimCredits(body);
      if (res.status === "success") await load();
      else setError(res.message || "That did not go through.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not go through.");
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  if (!data || data.status !== "success") {
    return (
      <div className="flex-1 overflow-y-auto px-8 py-8">
        <p className="text-sm text-faint">{error || "Loading…"}</p>
      </div>
    );
  }

  const shortfall = data.pool.available === 0;

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto max-w-4xl space-y-4">
        <header className="flex items-center gap-2">
          <Coins size={18} className="text-gold/70" />
          <h1 className="text-sm font-semibold text-cream">{data.tenant.name} · credits</h1>
        </header>

        {error && (
          <p className="rounded-lg border border-error/20 bg-error/[0.08] px-3 py-2 text-xs text-error">{error}</p>
        )}

        {/* The pool is the budget every hand-out comes out of, so it leads
            the page rather than sitting in the table with the people. */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-surface-raised p-4">
          <div>
            {/* Named, not "Organization pool" — an admin who belongs to more
                than one organization needs to see which one's budget this
                is, and the generic label reads the same in all of them. */}
            <p className="text-xs font-medium text-cream">{data.tenant.name} pool</p>
            <p className="text-[11px] text-faint">What you have left to share out</p>
          </div>
          <div className="flex items-center gap-5">
            <div className="text-right">
              <p className="text-[9px] uppercase tracking-widest text-faint">Available</p>
              <p className={cn("text-lg font-semibold tabular-nums", shortfall ? "text-error" : "text-cream")}>
                {data.pool.available.toLocaleString()}
              </p>
            </div>
            <Figure label="Frozen" value={data.pool.reserved} muted />
          </div>
        </div>

        {shortfall && (
          <p className="rounded-lg border border-gold/20 bg-gold/[0.06] px-3 py-2 text-[11px] leading-relaxed text-gold/90">
            The pool is empty, so there is nothing to share out. Credits are issued to an organization by platform
            staff — ask them to top the pool up.
          </p>
        )}
        {/* The console's own member table — the component itself, not a
            copy of its markup. Reusing MemberRows is what makes the
            permissions editor available here at no extra cost, and means
            the two rosters can never drift apart. */}
        <div className="space-y-1.5">
          <p className="text-[10px] font-medium uppercase tracking-widest text-faint">
            Members · {data.members.length}
          </p>

          {roster ? (
            <MemberRows
              members={roster.members}
              groups={roster.groups}
              /* Only what this admin holds; the rest render locked. The
                 server refuses them too — this just avoids a dead end. */
              assignableGrants={roster.assignableGrants}
              /* Their own row is shown but not editable. */
              selfId={roster.selfId}
              /* Removing people stays with the super admin console. */
              canRemove={false}
              onPatch={patchMember}
              onRemove={async () => {}}
              onGrantCredits={
                data.canManage
                  ? (member) =>
                      setPending({
                        userId: member.id,
                        holder: member.name || member.email,
                        mode: "distribute",
                        balance: member.credits.available,
                      })
                  : undefined
              }
              onReclaimCredits={
                data.canManage
                  ? (member) =>
                      setPending({
                        userId: member.id,
                        holder: member.name || member.email,
                        mode: "reclaim",
                        balance: member.credits.available,
                      })
                  : undefined
              }
            />
          ) : (
            <p className="rounded-lg border border-white/[0.06] px-3 py-3 text-[11px] text-faint">
              You can see the balances above. Changing what your colleagues can do needs the &ldquo;manage their
              colleagues&rsquo; permissions&rdquo; grant.
            </p>
          )}
        </div>
      </div>

      {/* The amount is typed here, not decided by the button that opened
          this — and the dialog prints the resulting balance, because
          "giving 5,000" does not say whether they end on 5,000 or 5,000
          more. Capped at the pool when giving, at their own unspent
          balance when taking back. */}
      <CreditAmountDialog
        open={Boolean(pending)}
        mode={pending?.mode ?? "distribute"}
        holder={pending?.holder ?? ""}
        currentBalance={pending?.balance}
        max={pending?.mode === "reclaim" ? pending?.balance : data.pool.available}
        busy={busy}
        onConfirm={apply}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}

/** One organization: the pool, every member, and the statement. */
function TenantCredits({ tenantId, onBack }: { tenantId: string; onBack: () => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchCreditTenant>> | null>(null);
  const [entries, setEntries] = useState<CreditEntry[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<{
    userId: string | null;
    holder: string;
    mode: "grant" | "revoke";
    amount: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [detail, ledger] = await Promise.all([fetchCreditTenant(tenantId), fetchCreditLedger(tenantId, 60)]);
    if (detail.status === "success") setData(detail);
    else setError(detail.message || "Could not load that organization.");
    if (ledger.status === "success") setEntries(ledger.entries);
  }, [tenantId]);

  useEffect(() => {
    load();
  }, [load]);

  async function apply() {
    if (!pending) return;
    setBusy(true);
    setError("");
    try {
      const body = { tenantId, userId: pending.userId, amount: pending.amount };
      const res = pending.mode === "grant" ? await grantCredits(body) : await revokeCredits(body);
      if (res.status === "success") await load();
      else setError(res.message || "That did not go through.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not go through.");
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  if (!data || data.status !== "success") {
    return (
      <div className="flex-1 overflow-y-auto px-8 py-8">
        <p className="text-sm text-faint">{error || "Loading…"}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto max-w-5xl space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onBack}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.08] text-muted transition-colors hover:border-white/[0.16] hover:text-cream"
              aria-label="Back to organizations"
            >
              <ArrowLeft size={13} />
            </button>
            <h1 className="text-sm font-semibold text-cream">{data.tenant.name}</h1>
          </div>
        </header>

        {error && (
          <p className="rounded-lg border border-error/20 bg-error/[0.08] px-3 py-2 text-xs text-error">{error}</p>
        )}

        <AccountRow
          holder="Organization pool"
          subtitle="Held by the organization, not yet distributed"
          balance={data.pool.balance}
          reserved={data.pool.reserved}
          onGrant={(amount) => setPending({ userId: null, holder: "the organization pool", mode: "grant", amount })}
          onRevoke={(amount) => setPending({ userId: null, holder: "the organization pool", mode: "revoke", amount })}
        />

        <div className="space-y-1.5">
          <p className="text-[10px] font-medium uppercase tracking-widest text-faint">Members</p>
          {data.members.length === 0 ? (
            <p className="text-xs text-faint">No members in this organization.</p>
          ) : (
            data.members.map((member) => <MemberRow key={member.userId} member={member} onAct={setPending} />)
          )}
        </div>

        <Ledger entries={entries} />
      </div>

      <ConfirmDialog
        open={Boolean(pending)}
        title={pending?.mode === "revoke" ? "Take back credits?" : "Grant credits?"}
        message={
          pending ? (
            <>
              <span className="text-cream">
                {pending.mode === "revoke" ? "Removing" : "Adding"} {pending.amount.toLocaleString()} credits
              </span>{" "}
              {pending.mode === "revoke" ? "from" : "to"} {pending.holder}.
              {pending.mode === "revoke"
                ? " Credits frozen by runs already in progress cannot be taken back."
                : " They can spend this immediately."}
            </>
          ) : null
        }
        confirmLabel={pending?.mode === "revoke" ? "Take back" : "Grant"}
        destructive={pending?.mode === "revoke"}
        busy={busy}
        onConfirm={apply}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}

/** The amount stepper shared by the pool row and every member row. */
function AmountControls({
  onGrant,
  onRevoke,
  grantLabel = "Grant",
  disabled = false,
}: {
  onGrant: (amount: number) => void;
  onRevoke: (amount: number) => void;
  /** "Grant" when staff are issuing new credit, "Give" when an admin shares out the pool. */
  grantLabel?: string;
  /** Set when there is nothing left in the pool to hand out. */
  disabled?: boolean;
}) {
  const [amount, setAmount] = useState(5000);

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number"
        min={1}
        step={500}
        value={amount}
        onChange={(event) => setAmount(Math.max(1, Math.round(Number(event.target.value) || 0)))}
        className="min-h-8 w-24 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-right text-xs tabular-nums text-cream focus:border-gold/30 focus:outline-none"
      />
      <button
        type="button"
        onClick={() => onGrant(amount)}
        disabled={disabled}
        title={disabled ? "The pool is empty" : grantLabel}
        className="flex min-h-8 items-center gap-1 rounded-lg border border-gold/30 bg-gold/10 px-2.5 py-1 text-[11px] font-medium text-gold transition-colors hover:bg-gold/15 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Plus size={12} /> {grantLabel}
      </button>
      <button
        type="button"
        onClick={() => onRevoke(amount)}
        title="Take back"
        className="flex min-h-8 items-center justify-center rounded-lg border border-white/[0.08] px-2 py-1 text-muted transition-colors hover:border-error/40 hover:text-error"
      >
        <Minus size={12} />
      </button>
    </div>
  );
}

function AccountRow({
  holder,
  subtitle,
  balance,
  reserved,
  onGrant,
  onRevoke,
}: {
  holder: string;
  subtitle?: string;
  balance: number;
  reserved: number;
  onGrant: (amount: number) => void;
  onRevoke: (amount: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-surface-raised p-3">
      <div className="min-w-0">
        <p className="text-xs font-medium text-cream">{holder}</p>
        {subtitle && <p className="text-[11px] text-faint">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-4">
        <Figure label="Balance" value={balance} />
        <Figure label="Frozen" value={reserved} muted />
        <AmountControls onGrant={onGrant} onRevoke={onRevoke} />
      </div>
    </div>
  );
}

function MemberRow({
  member,
  onAct,
}: {
  member: CreditMember;
  onAct: (p: { userId: string | null; holder: string; mode: "grant" | "revoke"; amount: number }) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-surface-raised p-3">
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-cream">{member.name}</p>
        <p className="truncate text-[11px] text-faint">
          {member.email}
          {member.status !== "active" && <span className="ml-1.5 text-warning">· {member.status}</span>}
        </p>
      </div>
      <div className="flex items-center gap-4">
        {/* Zero is called out rather than shown as a plain 0: with charging
            enforced, a member on zero cannot generate at all, and that is
            the single most useful thing this table can tell you. */}
        <div className="text-right">
          <p className="text-[9px] uppercase tracking-widest text-faint">Balance</p>
          <p
            className={cn(
              "text-xs font-medium tabular-nums",
              member.balance === 0 ? "text-error" : "text-cream"
            )}
          >
            {member.balance.toLocaleString()}
            {member.balance === 0 && <span className="ml-1 text-[10px] font-normal">blocked</span>}
          </p>
        </div>
        <Figure label="Frozen" value={member.reserved} muted />
        <Figure label="Spent" value={member.lifetimeSpent} muted />
        <AmountControls
          onGrant={(amount) => onAct({ userId: member.userId, holder: member.name, mode: "grant", amount })}
          onRevoke={(amount) => onAct({ userId: member.userId, holder: member.name, mode: "revoke", amount })}
        />
      </div>
    </div>
  );
}

function Figure({ label, value, muted = false }: { label: string; value: number; muted?: boolean }) {
  return (
    <div className="text-right">
      <p className="text-[9px] uppercase tracking-widest text-faint">{label}</p>
      <p className={cn("text-xs font-medium tabular-nums", muted ? "text-muted" : "text-cream")}>
        {value.toLocaleString()}
      </p>
    </div>
  );
}

/**
 * The statement.
 *
 * Holds are shown alongside charges rather than filtered out: "frozen 200"
 * followed by "charged 50" is the story of a four-image run that delivered
 * one, and hiding the first line makes the second look like a mistake.
 */
function Ledger({ entries }: { entries: CreditEntry[] }) {
  if (entries.length === 0) return null;

  const sign = (entry: CreditEntry) =>
    entry.kind === "hold"
      ? `−${entry.held.toLocaleString()} frozen`
      : entry.amount === 0
        ? `+${entry.held.toLocaleString()} released`
        : `${entry.amount > 0 ? "+" : ""}${entry.amount.toLocaleString()}`;

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-medium uppercase tracking-widest text-faint">Recent activity</p>
      <div className="overflow-hidden rounded-xl border border-white/[0.08]">
        <table className="w-full text-left text-[11px]">
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className="border-t border-white/[0.04] first:border-t-0">
                <td className="whitespace-nowrap px-3 py-2 text-faint">
                  {new Date(entry.createdAt).toLocaleString()}
                </td>
                <td className="px-3 py-2 text-muted">{entry.holder || "—"}</td>
                <td className="px-3 py-2">
                  <span className="text-cream">{entry.kind}</span>
                  {entry.tool && <span className="ml-1.5 text-faint">{entry.tool}</span>}
                  {/* The quote, which is what makes a charge explicable */}
                  {entry.unitPrice !== null && entry.units !== null && (
                    <span className="ml-1.5 text-faint">
                      {entry.units} × {entry.unitPrice}
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-cream">{sign(entry)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
