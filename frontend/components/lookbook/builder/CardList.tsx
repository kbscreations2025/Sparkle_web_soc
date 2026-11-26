"use client";

import { useState, type DragEvent } from "react";
import { Reorder, useDragControls } from "framer-motion";
import { Copy, EyeOff, GripVertical, PanelLeftClose, Plus, Trash2 } from "lucide-react";
import { CARD_HINTS, CARD_LABELS, type CardType, type LookbookCard } from "@/lib/lookbook/types";
import { cn } from "@/lib/utils";
import { CARD_DRAG_TYPE, CARD_ICONS, CARD_ORDER, cardSummary, cardThumb, shortLabel } from "./cardMeta";

type CardListProps = {
  cards: LookbookCard[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onReorder: (cards: LookbookCard[]) => void;
  /** Adds a card of this type at `index` (the end when omitted). */
  onAdd: (type: CardType, index?: number) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  /** Folds the panel back to its slim rail (large screens only). */
  onCollapse?: () => void;
};

/**
 * The page's outline: every card in order, dragged by its handle to reorder,
 * and the palette of card types to add. A palette tile can also be dragged
 * straight into the list or onto the preview, to drop a card where it lands.
 */
export function CardList({ cards, selectedId, onSelect, onReorder, onAdd, onDuplicate, onRemove, onCollapse }: CardListProps) {
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes(CARD_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    const rows = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-row]")];
    const index = rows.findIndex((row) => {
      const rect = row.getBoundingClientRect();
      return event.clientY < rect.top + rect.height / 2;
    });
    setDropIndex(index === -1 ? rows.length : index);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    const type = event.dataTransfer.getData(CARD_DRAG_TYPE) as CardType;
    if (!type) return;
    event.preventDefault();
    onAdd(type, dropIndex ?? cards.length);
    setDropIndex(null);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {onCollapse && (
        <div className="hidden shrink-0 items-center justify-between border-b border-white/[0.06] py-1.5 pl-3.5 pr-1.5 lg:flex">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">Cards</span>
          <button
            type="button"
            onClick={onCollapse}
            title="Collapse the card list"
            aria-label="Collapse the card list"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-white/[0.05] hover:text-cream"
          >
            <PanelLeftClose size={15} />
          </button>
        </div>
      )}
      <div
        className="slim-scrollbar min-h-0 flex-1 overflow-y-auto px-2 py-2"
        onDragOver={onDragOver}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropIndex(null);
        }}
        onDrop={onDrop}
      >
        {cards.length === 0 && (
          <p className="px-3 py-6 text-center text-[12px] leading-relaxed text-faint">No cards yet. Add one below, or drag a card type here.</p>
        )}
        <Reorder.Group axis="y" values={cards} onReorder={onReorder} className="flex flex-col gap-1">
          {cards.map((card, index) => (
            <Row
              key={card.id}
              card={card}
              selected={card.id === selectedId}
              dropBefore={dropIndex === index}
              onSelect={() => onSelect(card.id)}
              onDuplicate={() => onDuplicate(card.id)}
              onRemove={() => onRemove(card.id)}
            />
          ))}
        </Reorder.Group>
        {dropIndex === cards.length && cards.length > 0 && <div className="mx-2 mt-1 h-0.5 rounded-full bg-gold" />}
      </div>
      <AddPalette onAdd={(type) => onAdd(type)} />
    </div>
  );
}

function Row({
  card,
  selected,
  dropBefore,
  onSelect,
  onDuplicate,
  onRemove,
}: {
  card: LookbookCard;
  selected: boolean;
  dropBefore: boolean;
  onSelect: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const controls = useDragControls();
  const Icon = CARD_ICONS[card.type];
  const thumb = cardThumb(card);
  const summary = cardSummary(card);
  return (
    <Reorder.Item value={card} dragListener={false} dragControls={controls} className="relative" data-row>
      {dropBefore && <div className="absolute -top-1 left-2 right-2 h-0.5 rounded-full bg-gold" />}
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect();
          }
        }}
        className={cn(
          "group flex items-center gap-2 rounded-lg border px-1.5 py-1.5 transition-colors",
          selected ? "border-gold/40 bg-gold/[0.08]" : "border-transparent hover:bg-white/[0.04]"
        )}
      >
        <button
          type="button"
          aria-label="Drag to reorder"
          onPointerDown={(event) => controls.start(event)}
          className="flex h-7 w-5 shrink-0 cursor-grab touch-none items-center justify-center text-faint hover:text-cream active:cursor-grabbing"
        >
          <GripVertical size={14} />
        </button>
        <span className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-white/[0.08] bg-white/[0.04]">
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element -- a 32px thumbnail
            <img src={thumb} alt="" className="h-full w-full object-cover" />
          ) : (
            <Icon size={14} className="text-muted" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate text-[12px] font-medium", card.hidden ? "text-faint" : "text-cream")}>{CARD_LABELS[card.type]}</span>
          {summary && <span className="block truncate text-[11px] text-faint">{summary}</span>}
        </span>
        {card.hidden && <EyeOff size={12} className="shrink-0 text-faint" aria-label="Hidden" />}
        {/* Out of the layout until hovered, so the card's name gets the room. */}
        <span className="hidden shrink-0 items-center group-hover:flex group-focus-within:flex touch:flex">
          <button
            type="button"
            title="Duplicate"
            onClick={(event) => {
              event.stopPropagation();
              onDuplicate();
            }}
            className="flex h-6 w-6 items-center justify-center rounded text-faint hover:bg-white/[0.06] hover:text-cream"
          >
            <Copy size={12} />
          </button>
          <button
            type="button"
            title="Delete"
            onClick={(event) => {
              event.stopPropagation();
              onRemove();
            }}
            className="flex h-6 w-6 items-center justify-center rounded text-faint hover:bg-red-500/10 hover:text-red-400"
          >
            <Trash2 size={12} />
          </button>
        </span>
      </div>
    </Reorder.Item>
  );
}

/** Every card type, as tiles: click to add after the selected card, or drag one into place. */
export function AddPalette({ onAdd }: { onAdd: (type: CardType) => void }) {
  return (
    <div className="shrink-0 border-t border-white/[0.06] p-2">
      <p className="mb-1.5 flex items-center gap-1 px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">
        <Plus size={11} /> Add a card
      </p>
      <div className="grid grid-cols-3 gap-1">
        {CARD_ORDER.map((type) => {
          const Icon = CARD_ICONS[type];
          return (
            <button
              key={type}
              type="button"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData(CARD_DRAG_TYPE, type);
                event.dataTransfer.effectAllowed = "copy";
              }}
              onClick={() => onAdd(type)}
              title={`${CARD_LABELS[type]}: ${CARD_HINTS[type]}`}
              className="flex flex-col items-center gap-1 rounded-lg border border-white/[0.06] bg-white/[0.02] px-1 py-2 text-[10.5px] font-medium leading-tight text-muted transition-colors hover:border-gold/30 hover:bg-gold/[0.06] hover:text-cream"
            >
              <Icon size={15} strokeWidth={1.5} />
              <span className="line-clamp-1 text-center">{shortLabel(type)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
