"use client";

import { useRef } from "react";
import Image from "next/image";
import { FileText, ImageIcon, Plus, Trash2 } from "lucide-react";
import { hasProductionSheet, newPiece, type AffinityPiece } from "@/lib/affinity";
import { compressImage } from "@/lib/image";
import { readSheetFiles, SHEET_FILE_ACCEPT } from "@/lib/sheetFiles";
import { cn } from "@/lib/utils";

/**
 * The upload side of Affinity: one card per piece, each with its own hero
 * photo and its own production development sheet.
 *
 * The per-piece framing is the whole point and not just layout. A sheet
 * belongs to exactly one piece — never shared — because that is what
 * decides whether the model may describe it: a piece with a sheet is a
 * manufactured "Existing style" with verifiable specs, and one without is a
 * concept the model is told to leave blank for a person to write.
 */
export function AffinityPieceCards({
  pieces,
  onChange,
  onError,
  max,
}: {
  pieces: AffinityPiece[];
  onChange: (next: AffinityPiece[]) => void;
  onError: (message: string) => void;
  max: number;
}) {
  function update(id: string, patch: Partial<AffinityPiece>) {
    onChange(pieces.map((piece) => (piece.id === id ? { ...piece, ...patch } : piece)));
  }

  return (
    <div className="space-y-5">
      {pieces.map((piece, index) => (
        <PieceCard
          key={piece.id}
          piece={piece}
          index={index}
          canRemove={pieces.length > 1}
          onUpdate={(patch) => update(piece.id, patch)}
          onRemove={() => onChange(pieces.filter((entry) => entry.id !== piece.id))}
          onError={onError}
        />
      ))}

      {pieces.length < max && (
        <button
          type="button"
          onClick={() => onChange([...pieces, newPiece()])}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-white/[0.12] text-xs font-medium text-muted transition-colors hover:border-gold/30 hover:text-cream"
        >
          <Plus size={13} /> Add a piece
          <span className="text-faint">
            ({pieces.length}/{max})
          </span>
        </button>
      )}
    </div>
  );
}

function PieceCard({
  piece,
  index,
  canRemove,
  onUpdate,
  onRemove,
  onError,
}: {
  piece: AffinityPiece;
  index: number;
  canRemove: boolean;
  onUpdate: (patch: Partial<AffinityPiece>) => void;
  onRemove: () => void;
  onError: (message: string) => void;
}) {
  const imageInput = useRef<HTMLInputElement>(null);
  const sheetInput = useRef<HTMLInputElement>(null);
  const withSheet = hasProductionSheet(piece);

  async function acceptImage(file?: File) {
    if (!file) return;
    try {
      onUpdate({ image: await compressImage(file) });
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not read that photo");
    }
  }

  async function acceptSheet(files: File[]) {
    // A sheet arrives as photos, a PDF or a workbook; all three end up as
    // page images or extracted text here (see lib/sheetFiles.ts).
    const { images, excelText } = await readSheetFiles(files);
    onUpdate({
      sheetImages: [...piece.sheetImages, ...images],
      sheetExcelText: [...piece.sheetExcelText, ...excelText],
    });
  }

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-surface-raised/40 p-4 md:p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-cream">Piece {index + 1}</p>
        <div className="flex items-center gap-2">
          {/* Which half of the catalog this piece will land in, said plainly
              while it can still be changed by attaching a sheet. */}
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[9px] font-semibold",
              withSheet ? "bg-gold/15 text-gold" : "bg-white/[0.06] text-faint"
            )}
          >
            {withSheet ? "Existing style" : "New ideation"}
          </span>
          {canRemove && (
            <button
              type="button"
              onClick={onRemove}
              title={`Remove piece ${index + 1}`}
              aria-label={`Remove piece ${index + 1}`}
              className="flex h-7 w-7 items-center justify-center rounded-full text-faint transition-colors hover:text-error"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-[11px] font-medium text-faint">Jewellery Image</p>
          <input
            ref={imageInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              acceptImage(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <DropZone
            onClick={() => imageInput.current?.click()}
            onFiles={(files) => acceptImage(files[0])}
            filled={Boolean(piece.image)}
          >
            {piece.image ? (
              <Image src={piece.image} alt={`Piece ${index + 1}`} fill sizes="320px" className="object-contain" />
            ) : (
              <>
                <ImageIcon size={20} className="text-muted" />
                <span className="px-1 text-center text-xs text-faint">Drag or click</span>
              </>
            )}
          </DropZone>
        </div>

        <div>
          <p className="mb-2 text-[11px] font-medium text-faint">
            Production Development Sheet <span className="text-faint/70">(optional)</span>
          </p>
          <input
            ref={sheetInput}
            type="file"
            accept={SHEET_FILE_ACCEPT}
            multiple
            hidden
            onChange={(event) => {
              acceptSheet([...(event.target.files ?? [])]);
              event.target.value = "";
            }}
          />
          <DropZone
            onClick={() => sheetInput.current?.click()}
            onFiles={(files) => acceptSheet(files)}
            filled={withSheet}
          >
            {withSheet ? (
              <div className="flex flex-wrap items-center justify-center gap-1.5 p-2">
                {piece.sheetImages.slice(0, 5).map((src) => (
                  <span key={src.slice(-24)} className="relative h-12 w-12 overflow-hidden rounded border border-white/10">
                    <Image src={src} alt="" fill sizes="48px" className="object-cover" />
                  </span>
                ))}
                {piece.sheetExcelText.length > 0 && (
                  <span className="rounded bg-white/[0.06] px-2 py-1 text-[10px] text-muted">
                    {piece.sheetExcelText.length} spreadsheet{piece.sheetExcelText.length > 1 ? "s" : ""}
                  </span>
                )}
              </div>
            ) : (
              <>
                <FileText size={20} className="text-muted" />
                <span className="px-1 text-center text-xs text-faint">Drag or click — PDF/image/Excel</span>
              </>
            )}
          </DropZone>
        </div>
      </div>

      {/* Only a concept piece needs a designer's credit — an existing style
          carries its own printed reference code instead. */}
      {!withSheet && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div>
            <p className="text-[11px] font-medium text-cream">Design creator&apos;s starting letter</p>
            <p className="text-[10px] text-faint">e.g. &quot;Bappa&quot; → B</p>
          </div>
          <input
            value={piece.designerInitial}
            onChange={(event) => onUpdate({ designerInitial: event.target.value.slice(0, 3) })}
            placeholder="R"
            maxLength={3}
            className="min-h-9 w-16 rounded-lg border border-white/[0.08] bg-surface-raised px-3 text-center text-sm text-cream placeholder:text-faint focus:border-gold/30 focus:outline-none"
          />
        </div>
      )}
    </div>
  );
}

/** A drop target that is also a click target — the two ways anyone tries. */
function DropZone({
  onClick,
  onFiles,
  filled,
  children,
}: {
  onClick: () => void;
  onFiles: (files: File[]) => void;
  filled: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const files = [...event.dataTransfer.files];
        if (files.length) onFiles(files);
      }}
      className={cn(
        "relative flex h-40 w-full cursor-pointer flex-col items-center justify-center gap-1.5 overflow-hidden rounded-xl border-2 border-dashed transition-all",
        filled ? "border-white/[0.12] bg-white/[0.02]" : "border-white/[0.09] hover:border-gold/30 hover:bg-white/[0.015]"
      )}
    >
      {children}
    </div>
  );
}
