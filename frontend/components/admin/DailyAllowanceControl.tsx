"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarClock, Loader2 } from "lucide-react";
import { setDailyAllowance } from "@/lib/api";
import { useDismissable } from "@/lib/useEscapeKey";
import { cn } from "@/lib/utils";

/**
 * A member's daily allowance: a "2,000/day" badge when it's on, a small
 * calendar button when it's off, and either one opens a popover to set,
 * change or turn it off.
 *
 * Saving takes effect straight away on the server — their unspent credits go
 * back to the pool and the allowance comes out of it — so `onSaved` should
 * reload the balances, which have just changed.
 */
/** Matches the server's own ceiling on a credit amount. */
const MAX_ALLOWANCE = 100_000_000;

export function DailyAllowanceControl({
  userId,
  holder,
  current,
  tenantId,
  onSaved,
}: {
  userId: string;
  holder: string;
  /** Credits per day, or null when off. */
  current: number | null | undefined;
  /** Only needed by a super admin acting on another organization. */
  tenantId?: string;
  onSaved: () => void;
}) {
  const enabled = current !== null && current !== undefined;
  const [open, setOpen] = useState(false);
  // Kept as the typed text, not a number, so the field can be cleared and
  // retyped — a number input clamped on every keystroke snapped back to 1.
  const [amountText, setAmountText] = useState<string>(String(current ?? 2000));
  const amount = Number(amountText);
  const amountError =
    amountText === ""
      ? "Enter an amount"
      : !Number.isInteger(amount) || amount < 1
        ? "Must be a whole number of at least 1"
        : amount > MAX_ALLOWANCE
          ? `At most ${MAX_ALLOWANCE.toLocaleString()} a day`
          : "";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  const close = useCallback(() => setOpen(false), []);
  useDismissable(rootRef, open, close, panelRef);

  /*
   * Rendered into <body> and placed from the button, because the member
   * table clips its overflow — on the last rows a panel inside it was cut
   * off. Opens below the button, or above it when there is no room below.
   */
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const button = buttonRef.current?.getBoundingClientRect();
      const panel = panelRef.current?.getBoundingClientRect();
      if (!button) return;
      const width = panel?.width ?? 224;
      const height = panel?.height ?? 220;
      const gap = 6;
      const below = button.bottom + gap;
      const top = below + height > window.innerHeight - 8 ? Math.max(8, button.top - gap - height) : below;
      const left = Math.min(Math.max(8, button.right - width), window.innerWidth - width - 8);
      setPosition({ top, left });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  async function save(next: number | null) {
    setBusy(true);
    setError("");
    try {
      const res = await setDailyAllowance({ userId, amount: next, tenantId });
      if (res.status !== "success") {
        setError(res.message || "Could not save");
        return;
      }
      setOpen(false);
      onSaved();
    } catch {
      setError("Could not reach the server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          setAmountText(String(current ?? 2000));
          setError("");
          setOpen((value) => !value);
        }}
        title={enabled ? `Daily allowance: ${current!.toLocaleString()} credits` : `Set a daily allowance for ${holder}`}
        className={cn(
          "inline-flex items-center gap-1 rounded-full border transition-colors",
          enabled
            ? "border-gold/30 bg-gold/10 px-1.5 py-0.5 text-[9px] font-semibold text-gold hover:bg-gold/15"
            : "border-white/15 p-0.5 text-muted hover:border-gold/30 hover:text-gold"
        )}
      >
        <CalendarClock size={11} />
        {enabled && <span className="tabular-nums">{current!.toLocaleString()}/day</span>}
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
        <div
          ref={panelRef}
          style={{ top: position?.top ?? -9999, left: position?.left ?? -9999 }}
          className="fixed z-50 w-56 space-y-2 rounded-lg border border-white/10 bg-surface-raised p-3 text-left shadow-lg">
          <p className="text-[11px] font-medium text-cream">Daily allowance</p>
          <p className="text-[10px] leading-snug text-faint">
            Each day {holder}&apos;s unspent credits go back to the pool and they start again from this amount.
          </p>
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={9}
              value={amountText}
              // Digits only: anything else typed or pasted is dropped.
              onChange={(event) => setAmountText(event.target.value.replace(/\D/g, ""))}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !amountError && !busy) save(amount);
              }}
              aria-invalid={Boolean(amountError)}
              className={cn(
                "min-h-8 w-full rounded-lg border bg-white/[0.03] px-2 py-1 text-right text-xs tabular-nums text-cream focus:outline-none",
                amountError ? "border-error/40 focus:border-error/60" : "border-white/[0.08] focus:border-gold/30"
              )}
            />
            <span className="shrink-0 text-[10px] text-faint">/ day</span>
          </div>
          {amountError && <p className="text-[10px] text-error">{amountError}</p>}
          {error &&<p className="text-[10px] text-error">{error}</p>}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => save(amount)}
              disabled={busy || Boolean(amountError)}
              className="flex min-h-8 flex-1 items-center justify-center gap-1 rounded-lg border border-gold/30 bg-gold/10 px-2 text-[11px] font-medium text-gold transition-colors hover:bg-gold/15 disabled:opacity-50"
            >
              {busy && <Loader2 size={11} className="animate-spin" />}
              {enabled ? "Update" : "Turn on"}
            </button>
            {enabled && (
              <button
                type="button"
                onClick={() => save(null)}
                disabled={busy}
                className="min-h-8 rounded-lg border border-white/[0.08] px-2 text-[11px] text-muted transition-colors hover:border-error/40 hover:text-error disabled:opacity-50"
              >
                Turn off
              </button>
            )}
          </div>
          <p className="text-[9px] leading-snug text-faint/80">
            Saving applies it now: their current balance returns to the pool and today&apos;s allowance is paid out.
          </p>
        </div>,
        document.body
        )}
    </div>
  );
}
