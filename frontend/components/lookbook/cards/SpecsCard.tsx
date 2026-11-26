"use client";

import { Plus, X } from "lucide-react";
import { uid } from "@/lib/lookbook/defaults";
import type { SpecRow, SpecsCard as SpecsCardType } from "@/lib/lookbook/types";
import { cn } from "@/lib/utils";
import { useEditable, useRender } from "../context";
import { Txt } from "../EditableText";
import { Body, CardFrame, Title, cardRadius, justifyFor } from "../parts";

/**
 * Pieces in a table, a price list or small cards. With prices hidden the
 * price column is gone, and the server takes the numbers out of the public
 * page as well (backend/src/services/lookbookDesign.js, publicDesign).
 */
export function SpecsCard({ card }: { card: SpecsCardType }) {
  const editable = useEditable();
  const rows = card.rows.filter((row) => editable || row.name || row.detail || row.price);
  const variant = card.style.variant;

  return (
    <CardFrame card={card}>
      <div className="flex flex-col gap-6 @2xl:gap-8">
        {(editable || card.title || card.caption) && (
          <div className="flex flex-col gap-3" style={{ alignItems: justifyFor(card.style.align) }}>
            <Title value={card.title} path={["title"]} placeholder="Title" />
            <Body value={card.caption} path={["caption"]} placeholder="A line about these pieces" style={{ color: "var(--lb-m)", maxWidth: "52ch" }} />
          </div>
        )}
        {variant === "cards" ? <SpecCards card={card} rows={rows} /> : variant === "list" ? <SpecList card={card} rows={rows} /> : <SpecTable card={card} rows={rows} />}
        <AddRow card={card} />
        {(editable || card.note) && (
          <Txt
            as="p"
            value={card.note}
            path={["note"]}
            placeholder="A note under the table (optional)"
            className="lb-small"
            style={{ color: "var(--lb-m)", textAlign: card.style.align }}
          />
        )}
      </div>
    </CardFrame>
  );
}

function SpecTable({ card, rows }: { card: SpecsCardType; rows: SpecRow[] }) {
  const cell = "py-3.5 pr-4 align-top";
  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full border-collapse" style={{ textAlign: "left" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--lb-line)" }}>
            <th className={cn(cell, "font-normal")}>
              <Txt value={card.nameLabel} path={["nameLabel"]} placeholder="Piece" className="lb-small uppercase tracking-[0.16em]" keepEmpty style={{ color: "var(--lb-m)" }} />
            </th>
            <th className={cn(cell, "font-normal")}>
              <Txt value={card.detailLabel} path={["detailLabel"]} placeholder="Details" className="lb-small uppercase tracking-[0.16em]" keepEmpty style={{ color: "var(--lb-m)" }} />
            </th>
            {card.showPrices && (
              <th className={cn(cell, "pr-0 text-right font-normal")}>
                <Txt value={card.priceLabel} path={["priceLabel"]} placeholder="Price" className="lb-small uppercase tracking-[0.16em]" keepEmpty style={{ color: "var(--lb-m)" }} />
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="group/row relative" style={{ borderBottom: "1px solid var(--lb-line)" }}>
              <td className={cell}>
                <Txt value={row.name} path={["rows", row.id, "name"]} placeholder="Piece" keepEmpty className="lb-row-name" />
              </td>
              <td className={cell}>
                <Txt value={row.detail} path={["rows", row.id, "detail"]} placeholder="Details" keepEmpty className="lb-body" style={{ color: "var(--lb-m)", lineHeight: 1.5 }} />
              </td>
              {card.showPrices && (
                <td className={cn(cell, "whitespace-nowrap pr-0 text-right")}>
                  <Txt value={row.price} path={["rows", row.id, "price"]} placeholder="Price" keepEmpty className="lb-row-price" />
                </td>
              )}
              <RemoveRow card={card} row={row} inTable />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SpecList({ card, rows }: { card: SpecsCardType; rows: SpecRow[] }) {
  return (
    <ul className="m-0 flex w-full list-none flex-col p-0" style={{ textAlign: "left" }}>
      {rows.map((row) => (
        <li key={row.id} className="group/row relative py-4" style={{ borderBottom: "1px solid var(--lb-line)" }}>
          <div className="flex items-baseline gap-3">
            <Txt value={row.name} path={["rows", row.id, "name"]} placeholder="Piece" keepEmpty className="lb-row-name" />
            {card.showPrices && (
              <>
                <span aria-hidden className="min-w-6 flex-1 translate-y-[-0.3em] border-b border-dotted" style={{ borderColor: "var(--lb-line)" }} />
                <Txt value={row.price} path={["rows", row.id, "price"]} placeholder="Price" keepEmpty className="lb-row-price whitespace-nowrap" />
              </>
            )}
          </div>
          <Txt as="p" value={row.detail} path={["rows", row.id, "detail"]} placeholder="Details" className="lb-small mt-1" style={{ color: "var(--lb-m)" }} />
          <RemoveRow card={card} row={row} />
        </li>
      ))}
    </ul>
  );
}

function SpecCards({ card, rows }: { card: SpecsCardType; rows: SpecRow[] }) {
  const { theme } = useRender();
  const radius = cardRadius(card.style, theme);
  return (
    <div className="grid w-full gap-3 @xl:grid-cols-2 @4xl:grid-cols-3" style={{ textAlign: "left" }}>
      {rows.map((row) => (
        <div
          key={row.id}
          className="group/row relative flex flex-col gap-1.5 p-5"
          style={{ border: "1px solid var(--lb-line)", borderRadius: radius }}
        >
          <Txt value={row.name} path={["rows", row.id, "name"]} placeholder="Piece" keepEmpty className="lb-row-name" />
          <Txt as="p" value={row.detail} path={["rows", row.id, "detail"]} placeholder="Details" className="lb-small" style={{ color: "var(--lb-m)" }} />
          {card.showPrices && <Txt as="p" value={row.price} path={["rows", row.id, "price"]} placeholder="Price" className="lb-row-price mt-2" />}
          <RemoveRow card={card} row={row} />
        </div>
      ))}
    </div>
  );
}

/** The builder's remove button on a row. In a table it needs a cell of its own to be valid HTML. */
function RemoveRow({ card, row, inTable = false }: { card: SpecsCardType; row: SpecRow; inTable?: boolean }) {
  const { editor } = useRender();
  const editable = useEditable();
  if (!editable || !editor) return null;
  const button = (
    <button
      type="button"
      title="Remove this row"
      onClick={() =>
        editor.updateCard(card.id, (current) => (current.type === "specs" ? { ...current, rows: current.rows.filter((entry) => entry.id !== row.id) } : current))
      }
      className="lb-ui absolute -right-7 top-3.5 flex h-5 w-5 items-center justify-center rounded-full opacity-0 transition-opacity hover:bg-black/10 group-hover/row:opacity-70 touch:opacity-70"
    >
      <X size={12} />
    </button>
  );
  return inTable ? <td className="w-0 p-0">{button}</td> : button;
}

function AddRow({ card }: { card: SpecsCardType }) {
  const { editor } = useRender();
  const editable = useEditable();
  if (!editable || !editor) return null;
  return (
    <button
      type="button"
      onClick={() =>
        editor.updateCard(card.id, (current) =>
          current.type === "specs" ? { ...current, rows: [...current.rows, { id: uid(), name: "", detail: "", price: "" }] } : current
        )
      }
      className="lb-ui -mt-3 flex items-center gap-1 self-start text-[12px] font-medium opacity-60 transition-opacity hover:opacity-100"
    >
      <Plus size={13} /> Add a row
    </button>
  );
}
