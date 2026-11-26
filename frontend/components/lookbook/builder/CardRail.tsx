"use client";

import { useCallback, useRef, useState, type DragEvent } from "react";
import { Reorder, useDragControls } from "framer-motion";
import { PanelLeftOpen, Plus } from "lucide-react";
import { CARD_LABELS, type CardType, type LookbookCard } from "@/lib/lookbook/types";
import { useDismissable } from "@/lib/useEscapeKey";
import { cn } from "@/lib/utils";
import { CARD_DRAG_TYPE, CARD_ICONS, cardSummary, cardThumb, shortLabel } from "./cardMeta";
import { AddPalette } from "./CardList";

/**
 * The card list folded to a slim rail, which is how the builder opens, so the
 * page itself gets the width. Every card is a small icon over a short name
 * (or its photo, when it has one), in page order:
 *   · click to jump to a card;
 *   · drag one up or down to reorder, just as in the full list;
 *   · drag a card type from the "+" pop-out (or click it) to add one.
 */
export function CardRail({
  cards,
  selectedId,
  onSelect,
  onExpand,
  onReorder,
  onAdd,
}: {
  cards: LookbookCard[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onExpand: () => void;
  onReorder: (cards: LookbookCard[]) => void;
  /** Adds a card of this type at `index` (the end when omitted). */
  onAdd: (type: CardType, index?: number) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const flyout = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setAdding(false), []);
  useDismissable(flyout, adding, close);

  // A card type dragged over the rail: the line shows where it would land.
  function onDragOver(event: DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes(CARD_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    const rows = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-rail-row]")];
    const found = rows.findIndex((row) => {
      const rect = row.getBoundingClientRect();
      return event.clientY < rect.top + rect.height / 2;
    });
    setDropIndex(found === -1 ? rows.length : found);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    const type = event.dataTransfer.getData(CARD_DRAG_TYPE) as CardType;
    const at = dropIndex ?? cards.length;
    setDropIndex(null);
    if (!type) return;
    event.preventDefault();
    onAdd(type, at);
    setAdding(false);
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-1 py-2">
      <button
        type="button"
        onClick={onExpand}
        title="Show the full card list"
        aria-label="Show the card list"
        className="flex h-7 w-9 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-white/[0.05] hover:text-cream"
      >
        <PanelLeftOpen size={16} />
      </button>
      <span className="my-0.5 h-px w-6 shrink-0 bg-white/[0.08]" />

      <div
        className="slim-scrollbar min-h-0 w-full flex-1 overflow-y-auto overflow-x-hidden px-1"
        onDragOver={onDragOver}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropIndex(null);
        }}
        onDrop={onDrop}
      >
        <Reorder.Group axis="y" values={cards} onReorder={onReorder} className="flex flex-col gap-0.5">
          {cards.map((card, index) => (
            <RailItem key={card.id} card={card} selected={card.id === selectedId} dropBefore={dropIndex === index} onSelect={() => onSelect(card.id)} />
          ))}
        </Reorder.Group>
        {dropIndex === cards.length && cards.length > 0 && <div className="mx-1 mt-1 h-0.5 rounded-full bg-gold" />}
      </div>

      <div ref={flyout} className="relative shrink-0 pt-1">
        <button
          type="button"
          onClick={() => setAdding((open) => !open)}
          title="Add a card"
          aria-label="Add a card"
          aria-expanded={adding}
          className="flex h-8 w-9 items-center justify-center rounded-lg bg-gold/10 text-gold transition-colors hover:bg-gold/20"
        >
          <Plus size={17} />
        </button>
        {adding && (
          <div className="absolute bottom-0 left-full z-40 ml-2 w-60 overflow-hidden rounded-xl border border-white/[0.1] bg-surface-raised shadow-2xl">
            <AddPalette
              onAdd={(type) => {
                onAdd(type);
                setAdding(false);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/** One card on the rail. The whole item is the drag handle: a short press selects it, a drag moves it. */
function RailItem({ card, selected, dropBefore, onSelect }: { card: LookbookCard; selected: boolean; dropBefore: boolean; onSelect: () => void }) {
  const controls = useDragControls();
  /** Where the press began, so a drag that ends over the item isn't also counted as a click on it. */
  const pressedAt = useRef<{ x: number; y: number } | null>(null);
  const Icon = CARD_ICONS[card.type];
  const thumb = cardThumb(card);
  const summary = cardSummary(card);

  return (
    <Reorder.Item value={card} dragListener={false} dragControls={controls} className="relative" data-rail-row>
      {dropBefore && <div className="absolute -top-1 left-1 right-1 z-10 h-0.5 rounded-full bg-gold" />}
      <button
        type="button"
        onClick={(event) => {
          const start = pressedAt.current;
          // A keyboard "click" has no press position; a pointer one that travelled was a drag.
          if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return;
          onSelect();
        }}
        onPointerDown={(event) => {
          pressedAt.current = { x: event.clientX, y: event.clientY };
          controls.start(event);
        }}
        title={summary ? `${CARD_LABELS[card.type]}: ${summary}. Drag to move.` : `${CARD_LABELS[card.type]}. Drag to move.`}
        aria-label={CARD_LABELS[card.type]}
        aria-current={selected || undefined}
        className={cn(
          "flex w-full cursor-grab touch-none select-none flex-col items-center gap-0.5 rounded-lg border px-0 pb-0.5 pt-1 transition-colors active:cursor-grabbing",
          selected ? "border-gold/60 bg-gold/10 text-gold" : "border-transparent text-muted hover:bg-white/[0.05] hover:text-cream",
          card.hidden && "opacity-45"
        )}
      >
        <span className="flex h-6 w-6 items-center justify-center overflow-hidden rounded">
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element -- a 28px thumbnail
            <img src={thumb} alt="" draggable={false} className="h-full w-full object-cover" />
          ) : (
            <Icon size={13} strokeWidth={1.6} />
          )}
        </span>
        <span className="w-full truncate text-center text-[8.5px] font-medium leading-tight">{shortLabel(card.type)}</span>
      </button>
    </Reorder.Item>
  );
}
