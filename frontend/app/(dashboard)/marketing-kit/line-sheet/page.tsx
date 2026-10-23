"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Download, FileDown, FileSpreadsheet, Loader2, Presentation, Upload } from "lucide-react";
import { HeaderAction } from "@/components/studio/AffinityWorkspace";
import { DeckEditor } from "@/components/studio/deck-editor/DeckEditor";
import { PrintDeck } from "@/components/studio/deck-editor/PrintDeck";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { usePageActions } from "@/lib/page-toolbar-context";
import { ToolAccessNotice } from "@/components/studio/ToolAccessNotice";
import { exportDesignPptx } from "@/lib/exportAffinity";
import type { DeckDesign } from "@/lib/deckDesign";
import { buildLineSheetDesign, lineSheetPieces, parseLineSheet, type ParsedLineSheet } from "@/lib/lineSheet";

const PERMISSION = "tool.marketing_kit.run";

/**
 * Line Sheet: an Excel price list in, the four-a-slide deck out. Generate
 * opens it in Collection Story's editor, where every card, photo and cell can
 * be moved or restyled before downloading. All of it runs in the browser (see
 * lib/lineSheet.ts) — no upload, no AI, no credits.
 */
export default function LineSheetPage() {
  const { user } = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [sheet, setSheet] = useState<ParsedLineSheet | null>(null);
  const [status, setStatus] = useState<"idle" | "reading" | "exporting">("idle");
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  /** Generate pressed: the page becomes the deck editor until Back. */
  const [generated, setGenerated] = useState(false);

  /*
   * The deck: laid out once from the rows, then the editor's. Edits are kept
   * in this tab (`edited`), so Back and Generate again return to them; a new
   * workbook starts a fresh layout.
   */
  const pieces = useMemo(() => (sheet ? lineSheetPieces(sheet.rows) : []), [sheet]);
  const built = useMemo(() => (sheet ? buildLineSheetDesign(sheet.rows) : null), [sheet]);
  const [edited, setEdited] = useState<DeckDesign | null>(null);
  const latestDesign = useRef<DeckDesign | null>(null);
  const design = edited ?? built;
  const saveDesign = useCallback((next: DeckDesign) => setEdited(next), []);

  /** The design being printed to PDF — what is in the editor right now. */
  const [printing, setPrinting] = useState<DeckDesign | null>(null);
  const endPrint = useCallback(() => setPrinting(null), []);

  async function download() {
    const current = latestDesign.current ?? design;
    if (!current) return;
    setStatus("exporting");
    setError("");
    try {
      await exportDesignPptx({ design: current, pieces, collectionName: fileName || "Line Sheet" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't build the PowerPoint.");
    } finally {
      setStatus("idle");
    }
  }

  // Back / Download in the top bar, as Collection Story has them — so they never print with the deck.
  usePageActions(
    generated && sheet ? (
      <div className="flex items-center gap-1.5" data-app-chrome>
        <HeaderAction onClick={() => setGenerated(false)} icon={ArrowLeft} label="Back" />
        <HeaderAction onClick={download} icon={FileDown} label="Download PPTX" busy={status === "exporting"} />
        <HeaderAction
          onClick={() => setPrinting(latestDesign.current ?? design)}
          icon={Download}
          label="Download PDF"
          busy={Boolean(printing)}
        />
      </div>
    ) : null
  );

  if (!can(user, PERMISSION)) {
    return <ToolAccessNotice tool="Marketing Kit" />;
  }

  async function read(file: File | undefined) {
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) {
      setError("Please choose an Excel .xlsx file.");
      return;
    }
    setError("");
    setSheet(null);
    setStatus("reading");
    try {
      setSheet(await parseLineSheet(file));
      setGenerated(false);
      setEdited(null);
      latestDesign.current = null;
      setFileName(file.name.replace(/\.xlsx$/i, ""));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read that workbook.");
    } finally {
      setStatus("idle");
    }
  }

  const slides = sheet ? Math.ceil(sheet.rows.length / 4) : 0;

  // Generated: Collection Story's editor takes the whole page, as it does there.
  if (generated && sheet && design) {
    return (
      <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
        {error && <p className="px-4 pt-3 text-xs text-red-500 md:px-8">{error}</p>}
        <DeckEditor key={sheet.rows.length + fileName} initial={design} pieces={pieces} onSave={saveDesign} latestRef={latestDesign} />
        {printing && <PrintDeck design={printing} pieces={pieces} onDone={endPrint} />}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto max-w-4xl space-y-5">
        <h1 className="text-base font-semibold text-cream">Line Sheet</h1>

        <input
          ref={input}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          hidden
          onChange={(event) => {
            read(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        {/* One slim bar: the file on the left, Generate on the right. */}
        <div className="space-y-1.5">
          <div className="flex items-stretch gap-2">
            <button
              type="button"
              onClick={() => input.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                read(event.dataTransfer.files?.[0]);
              }}
              title="Excel .xlsx with a photo in each row"
              className={cn(
                "flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-dashed px-3.5 text-left transition-colors",
                dragging ? "border-gold/60 bg-gold/[0.08]" : "border-white/15 hover:border-gold/30 hover:bg-white/[0.03]"
              )}
            >
              {status === "reading" ? (
                <Loader2 size={16} className="shrink-0 animate-spin text-faint" />
              ) : (
                <FileSpreadsheet size={16} className={cn("shrink-0", sheet ? "text-gold" : "text-faint")} />
              )}
              <span className={cn("min-w-0 flex-1 truncate text-[13px]", sheet ? "font-medium text-cream" : "text-muted")}>
                {status === "reading" ? "Reading…" : sheet ? `${fileName}.xlsx` : "Upload Excel"}
              </span>
              {sheet && <span className="shrink-0 text-[11px] text-faint">Replace</span>}
            </button>
            <button
              type="button"
              onClick={() => {
                setGenerated(true);
              }}
              disabled={!sheet || status !== "idle"}
              className="flex shrink-0 items-center gap-1.5 rounded-xl border border-gold/30 bg-gold/15 px-4 text-xs font-semibold text-gold transition-colors hover:bg-gold/25 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Presentation size={14} />
              Generate
            </button>
          </div>

          {/* What was read, right under the bar. */}
          {sheet && (
            <p className="px-1 text-[11px] text-faint">
              <span className="font-medium text-cream">{sheet.rows.length} products</span> · {slides} slide{slides === 1 ? "" : "s"} ·{" "}
              {sheet.missingImages.length === 0 ? (
                "all photos found"
              ) : (
                <span className="text-amber-700">no photo for {sheet.missingImages.join(", ")}</span>
              )}
            </p>
          )}
        </div>

        {error && (
          <p className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/[0.06] px-3 py-2 text-xs text-red-500">
            <AlertTriangle size={14} className="shrink-0" />
            {error}
          </p>
        )}

        {sheet && (
          <section className="space-y-3">
            {/* The workbook as it reads in Excel: same columns, same order, raw values. */}
            <div className="thin-scrollbar overflow-x-auto rounded-lg border border-white/[0.08] bg-surface-raised">
              <table className="w-full min-w-[760px] border-collapse text-[11px] text-cream">
                <thead>
                  <tr className="bg-white/[0.04] text-left text-[10px] font-semibold uppercase tracking-wide text-muted">
                    {["SR.NO.", "Image", "Style No.", "Category", "Dia. Combination", "Center Shape", "Center Wt.", "Dia wt", "Selling Price"].map(
                      (heading) => (
                        <th key={heading} className="whitespace-nowrap border-b border-white/[0.08] px-2.5 py-2">
                          {heading}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {sheet.rows.map((row) => (
                    <tr key={row.row} className="border-b border-white/[0.05] align-middle last:border-0">
                      <td className="px-2.5 py-1.5 text-faint">{row.excel.srNo}</td>
                      <td className="px-2.5 py-1.5">
                        <div className="flex h-14 w-20 items-center justify-center bg-white">
                          {row.image ? (
                            // eslint-disable-next-line @next/next/no-img-element -- a local data URI, not a remote image
                            <img src={row.image} alt="" className="max-h-full max-w-full object-contain" />
                          ) : (
                            <Upload size={14} className="text-faint" />
                          )}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-1.5 font-medium">{row.excel.styleNo}</td>
                      <td className="px-2.5 py-1.5">{row.category}</td>
                      <td className="whitespace-pre-line px-2.5 py-1.5">{row.diaCombination}</td>
                      <td className="px-2.5 py-1.5">{row.centerShape}</td>
                      <td className="px-2.5 py-1.5">{row.excel.centerWt}</td>
                      <td className="px-2.5 py-1.5">{row.excel.diaWt}</td>
                      <td className="px-2.5 py-1.5">{row.excel.price}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
