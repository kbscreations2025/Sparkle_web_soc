"use client";

import { useRef, type KeyboardEvent, type ClipboardEvent, type ChangeEvent } from "react";

interface OtpCodeInputProps {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  autoFocus?: boolean;
}

/** Segmented "_ _ _ _ _ _" one-digit-per-box code entry — auto-advances, supports backspace-to-previous and pasting the full code at once. */
export function OtpCodeInput({ value, onChange, length = 6, autoFocus = true }: OtpCodeInputProps) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? "");

  function setDigitAt(index: number, digit: string) {
    const next = digits.slice();
    next[index] = digit;
    onChange(next.join("").slice(0, length));
  }

  function handleChange(index: number, e: ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/\D/g, "");
    if (!raw) {
      setDigitAt(index, "");
      return;
    }
    // Handles both a single keystroke and a full paste landing in one box (some mobile keyboards route paste through onChange).
    const chars = raw.split("");
    const next = digits.slice();
    for (let i = 0; i < chars.length && index + i < length; i++) {
      next[index + i] = chars[i];
    }
    onChange(next.join("").slice(0, length));
    const lastFilledIndex = Math.min(index + chars.length, length - 1);
    inputRefs.current[lastFilledIndex]?.focus();
  }

  function handleKeyDown(index: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
      setDigitAt(index - 1, "");
    } else if (e.key === "ArrowLeft" && index > 0) {
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === "ArrowRight" && index < length - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    if (!pasted) return;
    e.preventDefault();
    onChange(pasted);
    inputRefs.current[Math.min(pasted.length, length - 1)]?.focus();
  }

  return (
    <div className="flex gap-2 justify-between" onPaste={handlePaste}>
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(el) => {
            inputRefs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={1}
          value={digit}
          autoFocus={autoFocus && i === 0}
          onChange={(e) => handleChange(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          className="w-full aspect-square min-w-0 rounded-xl text-center text-lg font-semibold outline-none transition-all duration-200"
          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.09)", color: "rgba(255,255,255,0.92)" }}
          onFocus={(e) => {
            e.currentTarget.style.border = "1px solid rgba(196,168,106,0.40)";
            e.currentTarget.style.background = "rgba(255,255,255,0.09)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.border = "1px solid rgba(255,255,255,0.09)";
            e.currentTarget.style.background = "rgba(255,255,255,0.06)";
          }}
        />
      ))}
    </div>
  );
}
