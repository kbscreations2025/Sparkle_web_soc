"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowLeft, ArrowRight, Gem, Move, Pencil, Type, X } from "lucide-react";
import type { AffinityItem } from "@/lib/api";
import {
  CARD_MAX,
  CARD_MIN,
  DECK,
  DEFAULT_CARD_SIZE,
  clampCard,
  sourceCodeFallback,
  splitEntries,
  toSlides,
  type AffinityPiece,
  type DeckEntry,
} from "@/lib/affinity";

/**
 * The generated catalog, laid out exactly as it will be exported.
 *
 * Two sections, matching the customer's own deck:
 *
 *  · **Existing style** — pieces that came with their own production sheet.
 *    Manufactured, documented, shown with their real spec caption.
 *  · **New Ideation** — pieces with only a photo. Concepts, credited to
 *    their designer's initial, and deliberately without an invented
 *    description (the model is told to leave those blank).
 *
 * Everything on a card is editable in place, resizable by dragging its
 * corner, and reorderable within its section — because this is a document
 * someone sends to a client, and the model's first draft is a starting
 * point rather than the deliverable.
 *
 * `onChange` is optional: History renders the same deck read-only.
 */
export function AffinityDeck({
  collectionName,
  tagline,
  items,
  pieces,
  coverSplit: coverSplitProp = 60,
  onChange,
}: {
  collectionName: string;
  tagline: string;
  items: AffinityItem[];
  pieces: AffinityPiece[];
  coverSplit?: number;
  onChange?: (patch: {
    collectionName?: string;
    tagline?: string;
    items?: AffinityItem[];
    coverSplit?: number;
  }) => void;
}) {
  const editable = Boolean(onChange);
  const [coverSplit, setCoverSplit] = useState(coverSplitProp);
  const coverRef = useRef<HTMLDivElement>(null);

  const hero = pieces.find((piece) => piece.image)?.image;
  const { existing, ideation } = splitEntries(items, pieces);

  function updateItem(index: number, patch: Partial<AffinityItem>) {
    onChange?.({ items: items.map((item, i) => (i === index ? { ...item, ...patch } : item)) });
  }

  function swapItems(a: number, b: number) {
    const next = [...items];
    [next[a], next[b]] = [next[b], next[a]];
    onChange?.({ items: next });
  }

  /** Drags the divider between the cover's text panel and its hero image. */
  function onCoverDividerDown(event: ReactPointerEvent) {
    if (!editable) return;
    event.preventDefault();
    const element = coverRef.current;
    if (!element) return;

    const move = (moveEvent: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      setCoverSplit(Math.min(80, Math.max(20, ((moveEvent.clientX - rect.left) / rect.width) * 100)));
    };
    const up = (upEvent: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const rect = element.getBoundingClientRect();
      // Committed once on release rather than on every frame — a drag is one
      // edit, not sixty.
      onChange?.({
        coverSplit: Math.min(80, Math.max(20, ((upEvent.clientX - rect.left) / rect.width) * 100)),
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div id="affinity-print-area" className="mx-auto max-w-[1400px] space-y-8">
      {editable && (
        <p className="flex items-start gap-1.5 text-[11px] text-faint">
          <Pencil size={11} className="mt-0.5 shrink-0" />
          Click any text to edit it. Hover a card and drag its corner handle to resize it. Use the Type button to drop a
          text box anywhere on the card, and the arrows to reorder — before exporting.
        </p>
      )}

      {/* The cover, at the real 16:9 slide ratio so the preview is the export. */}
      <div
        ref={coverRef}
        className="group/cover relative aspect-[16/9] w-full overflow-hidden"
        style={{ background: DECK.cream, border: `1px solid ${DECK.borderGold}`, borderRadius: 4 }}
      >
        <Sparkle size={20} className="absolute right-8 top-6" />
        <Sparkle size={14} className="absolute bottom-10 left-10 opacity-70" />

        <div className="grid h-full" style={{ gridTemplateColumns: `${coverSplit}% ${100 - coverSplit}%` }}>
          <div className="flex min-w-0 flex-col justify-center px-6 py-6 md:px-12 md:py-10">
            <Editable
              as="h1"
              value={collectionName}
              editable={editable}
              onCommit={(value) => onChange?.({ collectionName: value })}
              className="-mx-1 mb-4 px-1 text-2xl leading-snug md:text-5xl"
              style={{ fontFamily: "Cambria, Georgia, serif", color: DECK.titleGold }}
            />
            <div className="mb-4 flex items-center gap-2">
              <span className="h-px w-10 md:w-16" style={{ background: DECK.borderGold }} />
              <span style={{ color: DECK.borderGold, fontSize: 10 }}>◆</span>
              <span className="h-px w-10 md:w-16" style={{ background: DECK.borderGold }} />
            </div>
            <Editable
              value={tagline}
              editable={editable}
              onCommit={(value) => onChange?.({ tagline: value })}
              className="-mx-1 px-1 text-[10px] uppercase tracking-[0.28em] md:text-xs"
              style={{ color: DECK.ink }}
            />
          </div>

          <div className="relative">
            {hero ? (
              /* eslint-disable-next-line @next/next/no-img-element -- fixed deck geometry; next/image's sizing fights the slide ratio */
              <img src={hero} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center">
                <Gem size={32} style={{ color: DECK.borderGold }} />
              </div>
            )}
          </div>
        </div>

        {editable && (
          <div
            onPointerDown={onCoverDividerDown}
            title="Drag to resize"
            className="absolute bottom-0 top-0 z-10 -ml-2 flex w-4 cursor-col-resize items-center justify-center opacity-0 transition-opacity group-hover/cover:opacity-100"
            style={{ left: `${coverSplit}%` }}
          >
            <span className="h-10 w-1 rounded-full bg-black/20" />
          </div>
        )}
      </div>

      <DeckSection
        label="Existing style"
        section="existing"
        entries={existing}
        editable={editable}
        onUpdateItem={updateItem}
        onSwap={swapItems}
      />
      <DeckSection
        label="New Ideation"
        section="ideation"
        entries={ideation}
        editable={editable}
        onUpdateItem={updateItem}
        onSwap={swapItems}
      />
    </div>
  );
}

/** One half of the catalog, broken into slide-sized pages. */
function DeckSection({
  label,
  section,
  entries,
  editable,
  onUpdateItem,
  onSwap,
}: {
  label: string;
  section: "existing" | "ideation";
  entries: DeckEntry[];
  editable: boolean;
  onUpdateItem: (index: number, patch: Partial<AffinityItem>) => void;
  onSwap: (a: number, b: number) => void;
}) {
  const slides = toSlides(entries);
  if (slides.length === 0) return null;

  return (
    <>
      {slides.map((chunk, slideIndex) => (
        <div
          key={`${section}-${slideIndex}`}
          className="relative aspect-[16/9] w-full overflow-auto bg-white px-5 py-6 md:px-10 md:py-8"
          style={{ border: `1px solid ${DECK.borderGold}` }}
        >
          <p
            className="absolute right-5 top-4 text-sm italic md:right-8 md:top-6 md:text-lg"
            style={{ fontFamily: "Cambria, Georgia, serif", color: DECK.ink }}
          >
            {label}
            {slides.length > 1 ? ` (${slideIndex + 1}/${slides.length})` : ""}
          </p>

          <div className="flex flex-wrap items-start gap-6 pt-8">
            {chunk.map((entry, positionInSlide) => (
              <DeckCard
                key={entry.index}
                entry={entry}
                chunk={chunk}
                positionInSlide={positionInSlide}
                section={section}
                editable={editable}
                onUpdateItem={onUpdateItem}
                onSwap={onSwap}
              />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

/** One piece on a slide — image, code, title, caption, and any dropped notes. */
function DeckCard({
  entry,
  chunk,
  positionInSlide,
  section,
  editable,
  onUpdateItem,
  onSwap,
}: {
  entry: DeckEntry;
  chunk: DeckEntry[];
  positionInSlide: number;
  section: "existing" | "ideation";
  editable: boolean;
  onUpdateItem: (index: number, patch: Partial<AffinityItem>) => void;
  onSwap: (a: number, b: number) => void;
}) {
  const { item, index, piece } = entry;
  const fallback = DEFAULT_CARD_SIZE[item.size ?? "md"];
  const hasCustomSize = item.width != null && item.height != null;

  const [dims, setDims] = useState({ w: item.width ?? fallback.w, h: item.height ?? fallback.h });
  const dragging = useRef(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // While a drag is in flight the local size is the truth; adopting the
    // committed value mid-drag would make the card jump under the cursor.
    if (dragging.current) return;
    setDims({ w: item.width ?? fallback.w, h: item.height ?? fallback.h });
  }, [item.width, item.height, fallback.w, fallback.h]);

  const previousIndex = positionInSlide > 0 ? chunk[positionInSlide - 1].index : null;
  const nextIndex = positionInSlide < chunk.length - 1 ? chunk[positionInSlide + 1].index : null;

  function onResizeStart(event: ReactPointerEvent) {
    event.preventDefault();
    event.stopPropagation();
    dragging.current = true;

    const startX = event.clientX;
    const startY = event.clientY;
    const startW = dims.w;
    const startH = dims.h;

    const move = (moveEvent: PointerEvent) =>
      setDims(clampCard(startW + (moveEvent.clientX - startX), startH + (moveEvent.clientY - startY)));

    const up = (upEvent: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const next = clampCard(startW + (upEvent.clientX - startX), startH + (upEvent.clientY - startY));
      onUpdateItem(index, { width: next.w, height: next.h });
      dragging.current = false;
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const notes = item.notes ?? [];

  function updateNote(id: string, patch: Partial<{ text: string; x: number; y: number }>) {
    onUpdateItem(index, { notes: notes.map((note) => (note.id === id ? { ...note, ...patch } : note)) });
  }

  function onNoteDragStart(event: ReactPointerEvent, noteId: string) {
    event.preventDefault();
    event.stopPropagation();
    const element = cardRef.current;
    if (!element) return;

    // Stored as a percentage of the card, so a note keeps its place when the
    // card is later resized.
    const positionFrom = (pointerEvent: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      return {
        x: Math.min(100, Math.max(0, ((pointerEvent.clientX - rect.left) / rect.width) * 100)),
        y: Math.min(100, Math.max(0, ((pointerEvent.clientY - rect.top) / rect.height) * 100)),
      };
    };

    const move = (moveEvent: PointerEvent) => updateNote(noteId, positionFrom(moveEvent));
    const up = (upEvent: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      updateNote(noteId, positionFrom(upEvent));
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div
      ref={cardRef}
      className="group/card relative flex shrink-0 flex-col items-center text-center"
      style={{ width: dims.w }}
    >
      {editable && (
        <div className="absolute -top-1 right-0 z-10 flex items-center gap-0.5 rounded-md border border-black/10 bg-white/95 px-0.5 py-0.5 opacity-0 transition-opacity group-hover/card:opacity-100">
          <CardTool
            title="Add a text box — drag it anywhere on the card"
            onClick={() =>
              onUpdateItem(index, {
                notes: [...notes, { id: crypto.randomUUID(), text: "", x: 50, y: 50 }],
              })
            }
          >
            <Type size={10} />
          </CardTool>
          {previousIndex !== null && (
            <CardTool title="Move earlier" onClick={() => onSwap(index, previousIndex)}>
              <ArrowLeft size={10} />
            </CardTool>
          )}
          {nextIndex !== null && (
            <CardTool title="Move later" onClick={() => onSwap(index, nextIndex)}>
              <ArrowRight size={10} />
            </CardTool>
          )}
        </div>
      )}

      <FieldSlot
        value={item.category}
        placeholder="label"
        editable={editable}
        onCommit={(value) => onUpdateItem(index, { category: value })}
        className="-mx-1 mb-1.5 px-1 text-sm"
        style={{ color: DECK.labelGray }}
      />

      <div
        className="relative flex w-full items-center justify-center bg-white"
        style={hasCustomSize ? { height: dims.h } : undefined}
      >
        {piece?.image ? (
          /* eslint-disable-next-line @next/next/no-img-element -- deck geometry, as above */
          <img
            src={piece.image}
            alt=""
            draggable={false}
            className={hasCustomSize ? "max-h-full max-w-full object-contain" : "h-auto w-full object-contain"}
          />
        ) : (
          <Gem size={24} style={{ color: DECK.borderGold }} />
        )}

        {editable && (
          <div
            onPointerDown={onResizeStart}
            title="Drag to resize"
            className="absolute -bottom-1.5 -right-1.5 flex h-5 w-5 cursor-nwse-resize items-center justify-center rounded-md border border-black/15 bg-white opacity-0 shadow-sm transition-opacity group-hover/card:opacity-100"
          >
            <Move size={10} style={{ color: DECK.labelGray }} />
          </div>
        )}
      </div>

      <div className="mt-1 flex flex-col items-center gap-0.5">
        <Editable
          value={item.sourceCode || sourceCodeFallback(entry, section)}
          editable={editable}
          onCommit={(value) => onUpdateItem(index, { sourceCode: value })}
          className="-mx-1 px-1 text-xs font-medium"
          style={{ color: DECK.ink }}
        />
        <FieldSlot
          value={item.title}
          placeholder="title"
          editable={editable}
          onCommit={(value) => onUpdateItem(index, { title: value })}
          className="-mx-1 px-1 text-[11px]"
          style={{ color: DECK.labelGray }}
        />
        <FieldSlot
          value={item.caption}
          placeholder="note"
          editable={editable}
          onCommit={(value) => onUpdateItem(index, { caption: value })}
          className="-mx-1 px-1 text-[10px]"
          style={{ color: DECK.labelGray }}
        />
      </div>

      {notes.map((note) => (
        <div
          key={note.id}
          className="group/note absolute z-20"
          style={{ left: `${note.x}%`, top: `${note.y}%`, transform: "translate(-50%, -50%)" }}
        >
          <div className="flex items-center gap-1 rounded border border-black/10 bg-white/95 px-1 py-0.5 shadow-sm">
            {editable && (
              <span onPointerDown={(event) => onNoteDragStart(event, note.id)} className="cursor-move" style={{ color: DECK.labelGray }}>
                <Move size={9} />
              </span>
            )}
            <Editable
              value={note.text}
              editable={editable}
              onCommit={(value) => updateNote(note.id, { text: value })}
              className="min-w-[1ch] text-[10px]"
              style={{ color: DECK.ink }}
            />
            {editable && (
              <button
                type="button"
                onClick={() => onUpdateItem(index, { notes: notes.filter((entry) => entry.id !== note.id) })}
                title="Remove text box"
                className="opacity-0 transition-opacity group-hover/note:opacity-100"
                style={{ color: DECK.labelGray }}
              >
                <X size={9} />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function CardTool({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="flex h-5 w-5 items-center justify-center rounded hover:bg-black/5"
      style={{ color: DECK.labelGray }}
    >
      {children}
    </button>
  );
}

/**
 * Text edited where it sits. Committed on blur rather than per keystroke —
 * the deck is one saved document, and a save per character would be one
 * request per character.
 */
function Editable({
  value,
  editable,
  onCommit,
  as: Tag = "span",
  style,
  className,
}: {
  value: string;
  editable: boolean;
  onCommit: (next: string) => void;
  as?: "span" | "p" | "h1";
  style?: CSSProperties;
  className?: string;
}) {
  if (!editable) {
    return (
      <Tag className={className} style={style}>
        {value}
      </Tag>
    );
  }

  return (
    <Tag
      className={`group/edit relative inline-block cursor-text rounded-sm outline-none transition-colors hover:bg-black/[0.03] focus:bg-black/[0.05] ${className ?? ""}`}
      style={style}
      contentEditable
      suppressContentEditableWarning
      onBlur={(event) => onCommit(event.currentTarget.textContent ?? "")}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
    >
      {value}
    </Tag>
  );
}

/**
 * A line that can be dropped and brought back.
 *
 * Empty fields collapse to a hover-only "+ Add …" rather than sitting there
 * as blank space — which matters because a New Ideation piece deliberately
 * arrives with no title or caption for a person to write themselves.
 */
function FieldSlot({
  value,
  placeholder,
  editable,
  onCommit,
  className,
  style,
}: {
  value: string;
  placeholder: string;
  editable: boolean;
  onCommit: (next: string) => void;
  className?: string;
  style?: CSSProperties;
}) {
  const [forceShow, setForceShow] = useState(false);
  const visible = value.trim() !== "" || forceShow;

  if (!visible) {
    if (!editable) return null;
    return (
      <button
        type="button"
        onClick={() => setForceShow(true)}
        className="text-[9px] opacity-0 transition-opacity group-hover/card:opacity-100"
        style={{ color: DECK.labelGray }}
      >
        + Add {placeholder}
      </button>
    );
  }

  return (
    <div className="group/field relative inline-flex items-center gap-1">
      <Editable
        value={value}
        editable={editable}
        onCommit={(next) => {
          onCommit(next);
          if (!next.trim()) setForceShow(false);
        }}
        className={className}
        style={style}
      />
      {editable && (
        <button
          type="button"
          onClick={() => {
            onCommit("");
            setForceShow(false);
          }}
          title={`Remove ${placeholder}`}
          className="opacity-0 transition-opacity group-hover/field:opacity-100"
          style={{ color: DECK.labelGray }}
        >
          <X size={9} />
        </button>
      )}
    </div>
  );
}

/** The four-point mark from the customer's own cover artwork. */
function Sparkle({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path
        d="M12 0 C12 6 14 10 12 12 C10 10 12 6 12 0 Z M12 24 C12 18 10 14 12 12 C14 14 12 18 12 24 Z M0 12 C6 12 10 14 12 12 C10 10 6 12 0 12 Z M24 12 C18 12 14 10 12 12 C14 14 18 12 24 12 Z"
        fill={DECK.borderGold}
      />
    </svg>
  );
}

export { CARD_MIN, CARD_MAX };
