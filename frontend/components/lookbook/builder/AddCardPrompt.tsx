"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { withAlpha } from "@/lib/lookbook/media";
import { CARD_HINTS, CARD_LABELS, type CardType } from "@/lib/lookbook/types";
import { useRender } from "../context";
import { CARD_ICONS, CARD_ORDER } from "./cardMeta";

/**
 * Adding a card from the foot of the page itself, in the builder only.
 *
 * On a page with no cards, or just its hero (how a blank lookbook starts),
 * it's a large, open prompt: the next step is obvious without finding the
 * palette in the side panel. Once the page has content it shrinks to one
 * "Add a card" button that opens the same choice.
 */
export function AddCardPrompt({ count, onAdd }: { count: number; onAdd: (type: CardType) => void }) {
  const { theme } = useRender();
  const [open, setOpen] = useState(false);
  const prominent = count <= 1;
  const ink = theme.colors.text;
  const line = withAlpha(ink, theme.dark ? 0.32 : 0.26);

  const shell = "lb-ui mx-auto w-full px-[var(--lb-edge)] pb-6";

  if (!prominent && !open) {
    return (
      <div className={shell} style={{ maxWidth: theme.maxWidth + 96 }}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed py-4 text-[13px] font-medium transition-opacity hover:opacity-80"
          style={{ borderColor: line, color: withAlpha(ink, 0.75) }}
        >
          <Plus size={16} /> Add a card
        </button>
      </div>
    );
  }

  return (
    <div className={shell} style={{ maxWidth: theme.maxWidth + 96 }}>
      <div className="relative rounded-2xl border border-dashed px-5 py-7 text-center @2xl:px-8" style={{ borderColor: line, color: ink }}>
        {!prominent && (
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full opacity-60 hover:opacity-100"
          >
            <X size={15} />
          </button>
        )}
        <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full" style={{ background: withAlpha(ink, 0.07) }}>
          <Plus size={20} />
        </span>
        <p className="mt-3 text-[16px] font-semibold">{count === 0 ? "Add your first card" : count === 1 ? "Add your next card" : "Add a card"}</p>
        <p className="mx-auto mt-1 max-w-md text-[12.5px] leading-relaxed" style={{ color: withAlpha(ink, 0.65) }}>
          {count === 0
            ? "Start with a hero, then build the page one card at a time."
            : "Pick what comes next: your pieces in a gallery, one in the spotlight, the story behind them, prices or a contact button."}
        </p>
        <div className="mx-auto mt-5 grid max-w-3xl grid-cols-3 gap-2 @2xl:grid-cols-5">
          {CARD_ORDER.map((type) => {
            const Icon = CARD_ICONS[type];
            return (
              <button
                key={type}
                type="button"
                title={CARD_HINTS[type]}
                onClick={() => {
                  onAdd(type);
                  setOpen(false);
                }}
                className="flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-[11.5px] font-medium transition-colors"
                style={{ borderColor: withAlpha(ink, 0.12), background: withAlpha(ink, 0.025) }}
                onMouseEnter={(event) => (event.currentTarget.style.background = withAlpha(ink, 0.07))}
                onMouseLeave={(event) => (event.currentTarget.style.background = withAlpha(ink, 0.025))}
              >
                <Icon size={17} strokeWidth={1.5} />
                <span className="line-clamp-1">{CARD_LABELS[type].split(" / ")[0]}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
