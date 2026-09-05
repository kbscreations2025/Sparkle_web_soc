"use client";

import { useAuth } from "@/lib/auth-context";

export function TopBar() {
  const { liveConnected } = useAuth();

  return (
    <div className="fixed top-3.5 right-6 z-40 flex items-center gap-3">
      <span className={`flex items-center gap-1.5 text-xs ${liveConnected ? "text-success" : "text-faint"}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${liveConnected ? "bg-success" : "bg-faint"}`} />
        {liveConnected ? "Live" : "Connecting..."}
      </span>

      <span className="flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full bg-surface-raised/80 backdrop-blur-md border border-gold/25 shadow-[0_0px_8px_rgba(0,0,0,0.35)]">
        <span
          aria-hidden
          className="relative w-[22px] h-[22px] rounded-full flex items-center justify-center shadow-[0_1px_3px_rgba(0,0,0,0.4)]"
          style={{ background: "repeating-conic-gradient(var(--color-gold-dim) 0deg 6deg, var(--color-gold-bright) 6deg 12deg)" }}
        >
          <span
            className="absolute inset-[2px] rounded-full flex items-center justify-center text-[11px] font-bold leading-none text-[#4A3410]"
            style={{ background: "linear-gradient(to bottom right, var(--color-gold-bright), var(--color-gold), var(--color-gold-dim))" }}
          >
            ₹
          </span>
        </span>
        <span className="text-xs font-semibold tabular-nums leading-none text-gold-shine">100</span>
      </span>
    </div>
  );
}
