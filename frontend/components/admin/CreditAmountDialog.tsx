"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";
import { useEscapeKey } from "@/lib/useEscapeKey";
import { cn } from "@/lib/utils";

/** What the amount is going to do, which decides the wording and the cap. */
export type CreditAmountMode = "grant" | "revoke" | "distribute" | "reclaim";

const COPY: Record<CreditAmountMode, { title: string; verb: string; confirm: string; source: string }> = {
  grant: { title: "Grant credits", verb: "Adding", confirm: "Grant", source: "Issued to them — new credit." },
  revoke: { title: "Take credits back", verb: "Removing", confirm: "Take back", source: "Removed from their balance." },
  distribute: { title: "Share out credits", verb: "Giving", confirm: "Give", source: "Comes out of the organization pool." },
  reclaim: { title: "Take credits back", verb: "Taking", confirm: "Take back", source: "Goes back to the organization pool." },
};

/** 1,000 credits is $10 of provider spend — a figure that means nothing alone. */
const PRESETS = [
  { value: 1000, hint: "~40 flash images" },
  { value: 5000, hint: "~200 flash images" },
  { value: 20000, hint: "~25 Veo clips" },
];

/**
 * Pick an amount of credits, see what it does, confirm.
 *
 * One component for all four movements — a super admin issuing credit, an
 * org admin sharing the pool out, and both directions of taking it back —
 * because they are one question with different wording. They had been built
 * twice: a modal with presets in the console and an inline stepper on the
 * organization page, which disagreed on whether 0 was enterable and gave a
 * super admin and an org admin visibly different dialogs for the same act.
 *
 * The balance arithmetic is shown rather than described. Credits are *added*
 * to what someone already holds, and "Giving 5,000 credits to suyash" does
 * not say whether they end on 5,000 or on 5,000 more — so the dialog prints
 * `0 → 5,000` and removes the question.
 */
export function CreditAmountDialog({
  open,
  mode,
  holder,
  currentBalance,
  max,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  mode: CreditAmountMode;
  holder: string;
  /** What they hold now, so the dialog can show what it becomes. */
  currentBalance?: number;
  /** The most that can move — the pool's balance, or theirs when taking back. */
  max?: number;
  busy?: boolean;
  onConfirm: (amount: number) => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState(5000);
  const inputRef = useRef<HTMLInputElement>(null);
  const copy = COPY[mode];

  useEscapeKey(onCancel, open && !busy);

  // Reset per opening: a figure left over from the last member is the kind
  // of default nobody wants to discover after confirming.
  useEffect(() => {
    if (!open) return;
    setAmount(5000);
    inputRef.current?.select();
  }, [open, holder]);

  if (!open || typeof document === "undefined") return null;

  const adding = mode === "grant" || mode === "distribute";
  const overMax = max !== undefined && amount > max;
  const invalid = amount < 1 || overMax;

  // Where they land. Shown for both directions, so "take back" is just as
  // explicit about the result as giving is.
  const after =
    currentBalance === undefined ? null : adding ? currentBalance + amount : Math.max(0, currentBalance - amount);

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={() => !busy && onCancel()}
    >
      {/*
        A div with an explicit click handler, not a <form onSubmit>. The form
        version rendered and enabled correctly but never fired its submit
        handler from inside this portal, so the button did nothing — and a
        confirm button that silently does nothing is the worst failure this
        dialog could have. Enter is handled on the input instead, which is
        the only field anyone types in.
      */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={copy.title}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-sm overflow-hidden rounded-2xl border border-white/[0.08] bg-surface-deep shadow-2xl"
      >
        <div className="space-y-3 px-5 pb-4 pt-5">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-cream">{copy.title}</h2>
            <p className="text-[11px] leading-relaxed text-muted">
              {copy.verb} credits {adding ? "to" : "from"} <span className="text-cream">{holder}</span>.{" "}
              {copy.source}
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                onClick={() => setAmount(preset.value)}
                disabled={max !== undefined && preset.value > max}
                title={preset.hint}
                className={cn(
                  "rounded-lg border px-2.5 py-1.5 text-[11px] font-medium tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                  amount === preset.value
                    ? "border-gold/30 bg-gold/10 text-gold"
                    : "border-white/10 bg-white/[0.03] text-muted hover:border-white/20 hover:text-cream"
                )}
              >
                {preset.value.toLocaleString()}
              </button>
            ))}
          </div>

          <label className="block space-y-1">
            <span className="text-[10px] font-medium uppercase tracking-widest text-faint">Credits</span>
            <input
              ref={inputRef}
              // Text, not type="number": no spinner arrows, no "e"/"-"/"." slipping
              // through. Anything that isn't a digit is dropped as it's typed.
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              value={amount > 0 ? String(amount) : ""}
              autoFocus
              onChange={(event) => {
                const digits = event.target.value.replace(/\D/g, "").slice(0, 9);
                setAmount(digits ? Number(digits) : 0);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !invalid && !busy) {
                  event.preventDefault();
                  onConfirm(amount);
                }
              }}
              className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-right text-sm tabular-nums text-cream focus:border-gold/30 focus:outline-none"
            />
          </label>

          {/* The arithmetic, not a description of it. */}
          {after !== null && !invalid && (
            <p className="text-[11px] text-faint">
              Balance goes from <span className="tabular-nums text-muted">{currentBalance!.toLocaleString()}</span> to{" "}
              <span className="font-medium tabular-nums text-cream">{after.toLocaleString()}</span>
            </p>
          )}

          {overMax && (
            <p className="text-[11px] text-error">
              Only {max!.toLocaleString()} available
              {mode === "distribute" ? " in the pool" : ""}.
            </p>
          )}
          {amount < 1 && <p className="text-[11px] text-error">Enter at least 1 credit.</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-white/[0.06] px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="min-h-8 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-cream transition-colors hover:border-white/[0.16] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => !invalid && !busy && onConfirm(amount)}
            disabled={busy || invalid}
            className={cn(
              "flex min-h-8 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              adding
                ? "border border-gold/30 bg-gold/10 text-gold hover:bg-gold/15"
                : "bg-error/80 text-white hover:bg-error"
            )}
          >
            {busy && <Loader2 size={12} className="animate-spin" />}
            {copy.confirm} {amount > 0 ? amount.toLocaleString() : ""}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
