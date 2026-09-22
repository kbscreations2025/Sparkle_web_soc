"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { InsufficientCreditsDialog, type CreditShortfall } from "@/components/studio/InsufficientCreditsDialog";

/**
 * The one dialog that answers a refused-for-credits run, wherever it happens.
 *
 * Every tool makes its own request and handles its own failures, and a dozen
 * of them would otherwise each need their own copy of this modal. They share
 * one, mounted beside the queue toasts, and reach it through `useCreditGuard`.
 *
 * Sharing it also settles the awkward case: Image Cleaning queues one job per
 * photo in a loop, so a person out of credits produces a refusal per photo.
 * One dialog for the batch, and the loop stops at the first.
 */

/** The shape of any failed `apiRequest` — narrow enough that every call site fits. */
type FailedCall = {
  status: string;
  message?: string;
  code?: string;
  required?: number;
  available?: number;
};

/** Returns true when the failure was insufficient credits and is now on screen. */
type Guard = (result: FailedCall) => boolean;

const CreditGuardContext = createContext<Guard | null>(null);

export function CreditGuardProvider({ children }: { children: ReactNode }) {
  const [shortfall, setShortfall] = useState<CreditShortfall | null>(null);

  const guard = useCallback<Guard>((result) => {
    if (result?.code !== "insufficient_credits") return false;
    setShortfall({
      required: result.required,
      available: result.available,
      message: result.message,
    });
    return true;
  }, []);

  return (
    <CreditGuardContext.Provider value={guard}>
      {children}
      <InsufficientCreditsDialog shortfall={shortfall} onClose={() => setShortfall(null)} />
    </CreditGuardContext.Provider>
  );
}

/**
 * Hand a failed result to the returned function before showing it as an error.
 * It answers whether it took ownership of the failure:
 *
 *     if (creditGuard(result)) return;   // dialog is up, say nothing more
 *     setError(result.message);
 */
export function useCreditGuard(): Guard {
  const guard = useContext(CreditGuardContext);
  if (!guard) throw new Error("useCreditGuard must be used within CreditGuardProvider");
  return guard;
}
