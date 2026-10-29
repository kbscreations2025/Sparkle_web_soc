"use client";

import { Lock } from "lucide-react";

/**
 * Sent with every Lifestyle shot and every Campaign Kit, ahead of the user's
 * own notes. Shown in the "Anything else" box as a locked chip rather than
 * typed text: it gives the best-sized results, so it can't be cleared or
 * edited away.
 */
const FIXED_NOTE = "make the Jewelry very very very small";

/** The description a run sends: the fixed size note always leads; whatever the user types is added after it. */
export function withFixedNote(description: string) {
  return [FIXED_NOTE, description.trim()].filter(Boolean).join(". ");
}

/** The fixed note as a locked chip, for the top of the "Anything else" box. */
export function FixedNoteChip() {
  return (
    <span
      title="Always sent — gives the best-sized results"
      className="inline-flex items-center gap-1.5 rounded-md border border-gold/25 bg-gold/10 px-2 py-1 text-[12px] text-gold"
    >
      <Lock size={11} /> {FIXED_NOTE}
    </span>
  );
}
