"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Loader2 } from "lucide-react";

interface AuthShellProps {
  eyebrow: string;
  children: ReactNode;
}

/** Full-bleed video-background card layout shared by every auth step. */
export function AuthShell({ eyebrow, children }: AuthShellProps) {
  return (
    <div className="relative min-h-screen flex flex-col lg:flex-row overflow-hidden bg-black">
      <video autoPlay muted loop playsInline className="absolute inset-0 w-full h-full object-cover opacity-90">
        <source src="/bg_video/shared_1.mp4" type="video/mp4" />
      </video>

      <div
        className="absolute inset-0"
        style={{ background: "linear-gradient(120deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.10) 50%, rgba(0,0,0,0.40) 100%)" }}
      />

      <div className="relative z-10 flex-1 min-w-0 flex flex-col items-center lg:items-start justify-center lg:justify-start pt-10 pb-4 lg:pb-0 px-6 lg:pl-10 lg:px-0 select-none">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          className="text-center lg:text-left"
        >
          <h1
            className="text-gold-shine font-display uppercase tracking-[0.25em] leading-none text-[clamp(36px,9vw,64px)] lg:text-[clamp(64px,4vw,118px)]"
            style={{ fontWeight: 700 }}
          >
            Sparkle
          </h1>

          <div className="flex items-center gap-5 mt-6 mb-4 px-6">
            <div className="flex-1 h-px" style={{ background: "linear-gradient(to right, transparent, rgba(196,168,106,0.65))" }} />
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: "rgba(196,168,106,0.9)", boxShadow: "0 0 8px rgba(196,168,106,0.8)" }} />
            <div className="flex-1 h-px" style={{ background: "linear-gradient(to left, transparent, rgba(196,168,106,0.65))" }} />
          </div>

          <p
            className="uppercase font-light text-center text-[10px] lg:text-[12px]"
            style={{ color: "rgba(196,168,106,0.78)", letterSpacing: "0.30em" }}
          >
            Brilliance... Made effortless
          </p>
        </motion.div>
      </div>

      <div className="relative z-10 flex items-center justify-center w-full lg:w-[400px] lg:min-w-[360px] px-5 sm:px-8 py-6 lg:py-10">
        <motion.div
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.65, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-[400px] lg:max-w-none"
        >
          <div
            className="rounded-2xl overflow-hidden"
            style={{
              background: "rgba(6, 4, 2, 0.22)",
              backdropFilter: "blur(20px) saturate(130%)",
              WebkitBackdropFilter: "blur(20px) saturate(130%)",
              border: "1px solid rgba(196,168,106,0.20)",
              boxShadow: "0 0 0 1px rgba(196,168,106,0.05), 0 24px 60px rgba(0,0,0,0.35), inset 0 1px 0 rgba(196,168,106,0.10)",
            }}
          >
            <div className="h-[2px]" style={{ background: "linear-gradient(90deg, transparent 0%, rgba(196,168,106,0.65) 30%, rgba(255,240,180,0.85) 50%, rgba(196,168,106,0.65) 70%, transparent 100%)" }} />

            <div className="px-7 py-6">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="h-px w-5 flex-shrink-0" style={{ background: "rgba(196,168,106,0.9)" }} />
                <p className="text-[9px] font-semibold uppercase tracking-[0.22em]" style={{ color: "rgba(196,168,106,0.85)" }}>
                  {eyebrow}
                </p>
              </div>

              {children}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

export function AuthError({ children }: { children: ReactNode }) {
  return (
    <p
      className="text-xs px-3 py-2 rounded-lg"
      style={{ color: "#F87171", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.18)" }}
    >
      {children}
    </p>
  );
}

export function AuthField({
  label,
  type,
  value,
  onChange,
  autoComplete,
  placeholder,
  autoFocus,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <div>
      <label className="block text-[10px] font-semibold uppercase tracking-[0.18em] mb-1.5" style={{ color: "rgba(255,255,255,0.35)" }}>
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        placeholder={placeholder ?? label}
        autoFocus={autoFocus}
        required
        className="w-full rounded-xl px-4 py-2.5 text-sm outline-none transition-all duration-200"
        style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.09)", color: "rgba(255,255,255,0.9)" }}
        onFocus={(e) => {
          e.currentTarget.style.border = "1px solid rgba(196,168,106,0.40)";
          e.currentTarget.style.background = "rgba(255,255,255,0.09)";
        }}
        onBlur={(e) => {
          e.currentTarget.style.border = "1px solid rgba(255,255,255,0.09)";
          e.currentTarget.style.background = "rgba(255,255,255,0.06)";
        }}
      />
    </div>
  );
}

export function AuthSubmitButton({ loading, label }: { loading: boolean; label: string }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="w-full flex items-center justify-center gap-2.5 py-2.5 rounded-xl text-sm font-semibold tracking-wide transition-all duration-200 active:scale-[0.98] disabled:opacity-50 mt-1"
      style={{
        background: loading ? "rgba(196,168,106,0.15)" : "linear-gradient(135deg, #C4A86A 0%, #DFC07E 40%, #C4A86A 70%, #A07828 100%)",
        color: loading ? "rgba(196,168,106,0.8)" : "#1C1006",
        boxShadow: loading ? "none" : "0 0 0 1px rgba(196,168,106,0.3), 0 8px 28px rgba(196,168,106,0.22)",
        border: "none",
      }}
    >
      {loading ? (
        <Loader2 size={15} className="animate-spin" />
      ) : (
        <>
          {label} <ArrowRight size={14} />
        </>
      )}
    </button>
  );
}
