"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchCreditAudit,
  fetchCreditLedger,
  type CreditAuditEntry,
  type CreditEntry,
} from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * One organization's credit history, both halves of it.
 *
 * They answer different questions and neither is sufficient alone: the ledger
 * says where credits went — every hold, settle and refund, most of them the
 * worker's doing — and the trail says who decided, which the ledger cannot,
 * because an entry reading "revoke 5,000" names nobody.
 *
 * Shared by the two consoles that show an organization, so a super admin in
 * `/admin` and a platform admin in `/credits` are looking at the same thing.
 * They are separate shells — the proxy will not let a central super admin out
 * of `/admin` at all — and this component is what keeps the two from drifting.
 */
export function CreditLogs({ tenantId, reloadToken = 0 }: { tenantId: string; reloadToken?: number }) {
  const [entries, setEntries] = useState<CreditEntry[]>([]);
  const [auditEntries, setAuditEntries] = useState<CreditAuditEntry[]>([]);

  const load = useCallback(async () => {
    const [ledger, audit] = await Promise.all([fetchCreditLedger(tenantId, 60), fetchCreditAudit(tenantId, 60)]);
    if (ledger.status === "success") setEntries(ledger.entries);
    if (audit.status === "success") setAuditEntries(audit.entries);
  }, [tenantId]);

  useEffect(() => {
    load();
  }, [load, reloadToken]);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Ledger entries={entries} />
      <AdminTrail entries={auditEntries} />
    </div>
  );
}

/** The frame both logs share, so they read as a pair rather than two designs. */
function LogPanel({
  title,
  subtitle,
  empty,
  children,
}: {
  title: string;
  subtitle?: string;
  empty?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline gap-2">
        <p className="text-[10px] font-medium uppercase tracking-widest text-faint">{title}</p>
        {subtitle && <span className="text-[10px] text-faint/70">{subtitle}</span>}
      </div>
      <div className="overflow-hidden rounded-xl border border-white/[0.08]">
        {children ?? <p className="px-3 py-2 text-[11px] text-faint">{empty}</p>}
      </div>
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
  const sign = (entry: CreditEntry) =>
    entry.kind === "hold"
      ? `−${entry.held.toLocaleString()} frozen`
      : entry.amount === 0
        ? `+${entry.held.toLocaleString()} released`
        : `${entry.amount > 0 ? "+" : ""}${entry.amount.toLocaleString()}`;

  if (entries.length === 0) return <LogPanel title="Credit movements" empty="Nothing has moved yet." />;

  return (
    <LogPanel title="Credit movements">
      <table className="w-full text-left text-[11px]">
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-t border-white/[0.04] first:border-t-0">
              <td className="whitespace-nowrap px-3 py-2 text-faint">{new Date(entry.createdAt).toLocaleString()}</td>
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
    </LogPanel>
  );
}

/**
 * Who moved credits, from the audit log.
 *
 * Deliberately only the four administrative actions. The rest of the audit
 * trail is a different question and has its own page; mixing sign-ins and
 * permission changes into a credit statement would bury the four rows anyone
 * came here to find.
 */
function AdminTrail({ entries }: { entries: CreditAuditEntry[] }) {
  if (entries.length === 0) {
    return (
      <LogPanel title="Who moved them" subtitle="admin actions" empty="No one has granted or taken back credits." />
    );
  }

  return (
    <LogPanel title="Who moved them" subtitle="admin actions">
      <table className="w-full text-left text-[11px]">
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-t border-white/[0.04] first:border-t-0">
              <td className="whitespace-nowrap px-3 py-2 text-faint">{new Date(entry.createdAt).toLocaleString()}</td>
              <td className="px-3 py-2 text-muted">{entry.actorName || "—"}</td>
              <td className="px-3 py-2">
                <span className={cn(entry.status === "failure" ? "text-error" : "text-cream")}>
                  {VERB[entry.action] ?? entry.action}
                </span>
                {/* The server's own sentence — it already names the member. */}
                {entry.message && <span className="ml-1.5 text-faint">{entry.message}</span>}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-cream">
                {entry.amount === null ? "—" : entry.amount.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </LogPanel>
  );
}

/** "credits.granted" is the stored value; the column reads better as a verb. */
const VERB: Record<string, string> = {
  "credits.granted": "granted",
  "credits.revoked": "took back",
  "credits.distributed": "shared out",
  "credits.reclaimed": "reclaimed",
};
