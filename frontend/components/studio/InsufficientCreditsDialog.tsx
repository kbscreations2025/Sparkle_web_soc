"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { Coins } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/permissions";
import { useEscapeKey } from "@/lib/useEscapeKey";

/** What the server said the run cost, and what was spendable when it refused. */
export type CreditShortfall = {
  required?: number;
  available?: number;
  message?: string;
};

/**
 * "Insufficient balance" — the answer to a generate that the server priced and
 * refused.
 *
 * A dialog rather than the error banner every other failure uses, because this
 * one is not a fault to read and dismiss: nothing was queued, nothing was
 * charged, and the only way forward is more credits. The banner sits above a
 * form that still looks ready to submit, which invites the same click again.
 *
 * The wording comes from the server, which is the only side that knows the
 * price — it already phrases it as "This run costs N credits and you have M."
 */
export function InsufficientCreditsDialog({
  shortfall,
  onClose,
}: {
  shortfall: CreditShortfall | null;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const open = Boolean(shortfall);

  useEscapeKey(onClose, open);

  if (!shortfall || typeof document === "undefined") return null;

  // There is no self-serve top-up: credits are granted by an admin. So the way
  // out is a link for the people who can act on it, and who to ask for everyone
  // else — never a "buy more" button that leads nowhere.
  const canManage = can(user, "org.credits.manage");
  const short =
    shortfall.required !== undefined && shortfall.available !== undefined
      ? Math.max(0, shortfall.required - shortfall.available)
      : null;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label="Insufficient balance"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-sm overflow-hidden rounded-2xl border border-white/[0.08] bg-surface-deep shadow-2xl"
      >
        <div className="space-y-3 px-5 pb-4 pt-5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-error/10 text-error">
              <Coins size={16} />
            </span>
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-cream">Insufficient balance</h2>
              <p className="text-[11px] leading-relaxed text-muted">
                {shortfall.message || "You do not have enough credits to run this."}
              </p>
            </div>
          </div>

          {shortfall.required !== undefined && shortfall.available !== undefined && (
            <dl className="space-y-1 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[11px]">
              <div className="flex justify-between">
                <dt className="text-faint">This run costs</dt>
                <dd className="tabular-nums text-cream">{shortfall.required.toLocaleString()}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-faint">You have</dt>
                <dd className="tabular-nums text-muted">{shortfall.available.toLocaleString()}</dd>
              </div>
              {short !== null && short > 0 && (
                <div className="flex justify-between border-t border-white/[0.06] pt-1">
                  <dt className="text-faint">Short by</dt>
                  <dd className="font-medium tabular-nums text-error">{short.toLocaleString()}</dd>
                </div>
              )}
            </dl>
          )}

          <p className="text-[11px] leading-relaxed text-faint">
            {/* Said plainly, because a refused run looks identical to a failed
                one and people assume they were charged for it. */}
            Nothing was queued and nothing was charged. Credits held by runs already in progress come back when
            those finish.
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-white/[0.06] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="min-h-8 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-cream transition-colors hover:border-white/[0.16]"
          >
            Close
          </button>
          {canManage ? (
            <Link
              href="/credits"
              onClick={onClose}
              className="flex min-h-8 items-center rounded-lg border border-gold/30 bg-gold/10 px-3 py-1.5 text-xs font-medium text-gold transition-colors hover:bg-gold/15"
            >
              Manage credits
            </Link>
          ) : (
            <span className="flex min-h-8 items-center px-1 text-[11px] text-faint">
              Ask your organization admin for more.
            </span>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
