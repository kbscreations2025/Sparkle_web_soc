"use client";

import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { fetchAllCreditLedger, type CreditEntry } from "@/lib/api";
import { Modal } from "@/components/admin/Modal";
import { COMPACT_CELL, HEAD_ROW, TABLE_FRAME } from "@/components/admin/table";
import { cn } from "@/lib/utils";

/**
 * Every credit a super admin has given an organization — and taken back —
 * newest first. What the Organizations table's "of N given" adds up.
 */
export function GrantHistory({
  tenantId,
  orgName,
  remaining,
  given,
  onClose,
}: {
  tenantId: string;
  orgName: string;
  remaining: number;
  given: number;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<CreditEntry[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchAllCreditLedger({ tenantIds: [tenantId], kinds: ["grant", "revoke"], limit: 200 }).then((res) => {
      if (cancelled) return;
      if (res.status === "success") setEntries(res.entries ?? []);
      else setError(res.message || "Could not load the grant history");
    });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const used = Math.max(0, given - remaining);

  return (
    <Modal onClose={onClose} className="max-w-2xl">
      <div className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-cream">Credits given to {orgName}</h2>
            <p className="mt-0.5 text-[11px] text-faint">Every grant and revoke by platform staff, newest first.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-muted hover:text-cream">
            <X size={14} />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {[
            ["Given", given],
            ["Used", used],
            ["Remaining", remaining],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-white/10 bg-surface-raised/60 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-faint">{label}</p>
              <p className={cn("text-lg font-semibold tabular-nums", label === "Remaining" ? "text-gold" : "text-cream")}>
                {Number(value).toLocaleString()}
              </p>
            </div>
          ))}
        </div>

        {error ? (
          <p className="text-[12px] text-error">{error}</p>
        ) : entries === null ? (
          <p className="flex items-center gap-2 text-[12px] text-faint">
            <Loader2 size={12} className="animate-spin" /> Loading…
          </p>
        ) : entries.length === 0 ? (
          <p className="text-[12px] text-faint">Nothing has been given to this organization yet.</p>
        ) : (
          <div className={cn(TABLE_FRAME, "max-h-[50vh] overflow-y-auto")}>
            <table className="w-full border-collapse">
              <thead>
                <tr className={HEAD_ROW}>
                  <th className={cn(COMPACT_CELL, "text-[10px]")}>When</th>
                  <th className={cn(COMPACT_CELL, "text-[10px]")}>To</th>
                  <th className={cn(COMPACT_CELL, "text-[10px]")}>By</th>
                  <th className={cn(COMPACT_CELL, "text-right text-[10px]")}>Credits</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-t border-white/5" title={entry.reason ?? undefined}>
                    <td className={cn(COMPACT_CELL, "whitespace-nowrap text-muted tabular-nums")}>
                      {new Date(entry.createdAt).toLocaleString(undefined, {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className={cn(COMPACT_CELL, "text-cream")}>{entry.holder ?? "Organization pool"}</td>
                    <td className={cn(COMPACT_CELL, "text-muted")}>{entry.actorName ?? "—"}</td>
                    <td
                      className={cn(
                        COMPACT_CELL,
                        "text-right font-semibold tabular-nums",
                        entry.amount < 0 ? "text-error" : "text-success"
                      )}
                    >
                      {entry.amount > 0 ? "+" : ""}
                      {entry.amount.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
