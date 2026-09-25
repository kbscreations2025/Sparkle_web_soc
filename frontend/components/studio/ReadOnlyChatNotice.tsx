"use client";

import { Eye } from "lucide-react";

/**
 * What sits where the composer would, on a colleague's chat opened to read
 * (`org.conversations.read`). Says whose it is and why there is no input,
 * so an empty foot of the rail is not mistaken for a broken one.
 */
export function ReadOnlyChatNotice({ ownerName }: { ownerName: string | null }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-gold/20 bg-gold/[0.06] px-3 py-2">
      <Eye size={13} className="mt-px shrink-0 text-gold/80" />
      <p className="text-[11px] leading-relaxed text-muted">
        Viewing <span className="font-medium text-cream">{ownerName || "a colleague"}</span>&rsquo;s chat, read-only.
        You can look through it and download results, but only they can continue it.
      </p>
    </div>
  );
}
