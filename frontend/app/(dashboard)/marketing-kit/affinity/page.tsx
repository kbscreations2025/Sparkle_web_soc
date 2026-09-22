"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { ErrorBanner, RunButton } from "@/components/studio/ToolChrome";
import { useSearchParams } from "next/navigation";
import { Download, FileDown, LayoutGrid, Loader2, RotateCcw } from "lucide-react";
import { AffinityDeck } from "@/components/studio/AffinityDeck";
import { AffinityPieceCards } from "@/components/studio/AffinityPieceCards";
import { JobProgressBar } from "@/components/studio/JobProgressBar";
import { ToolAccessNotice } from "@/components/studio/ToolAccessNotice";
import { affinity, fetchMarketingKit, updateMarketingKit, type AffinityItem, type MarketingKit } from "@/lib/api";
import { newPiece, type AffinityPiece } from "@/lib/affinity";
import { exportAffinityPdf, exportAffinityPptx } from "@/lib/exportAffinity";
import { makeThumbnail } from "@/lib/image";
import { usePageActions } from "@/lib/page-toolbar-context";
import { useCreditGuard } from "@/lib/credit-guard";
import { useJobs } from "@/lib/jobs-context";
import { failureMessage, useSettledJob } from "@/lib/useSettledJob";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/permissions";

const PERMISSION = "tool.marketing_kit.run";
const MAX_PIECES = 8;

export default function AffinityPage() {
  return (
    <Suspense fallback={<div className="flex-1 px-8 py-8 text-sm text-muted">Loading…</div>}>
      <AffinityWorkspace />
    </Suspense>
  );
}

/**
 * Affinity: several pieces turned into a catalog deck.
 *
 * The split that runs through the whole screen is sheet vs no sheet. A piece
 * with a production sheet is a manufactured "Existing style" and gets a real
 * spec caption; a piece with only a photo is "New Ideation" and deliberately
 * comes back blank for a person to write. The backend enforces that rather
 * than trusting the prompt, so both sides agree on which pieces are which.
 */
function AffinityWorkspace() {
  const { user } = useAuth();
  const { jobs, track } = useJobs();
  const creditGuard = useCreditGuard();
  const searchParams = useSearchParams();
  const openKitId = searchParams.get("kitId");

  const [pieces, setPieces] = useState<AffinityPiece[]>([newPiece()]);
  const [kit, setKit] = useState<MarketingKit | null>(null);
  const [collectionName, setCollectionName] = useState("");
  const [tagline, setTagline] = useState("");
  const [coverSplit, setCoverSplit] = useState(60);
  const [items, setItems] = useState<AffinityItem[]>([]);
  const [status, setStatus] = useState<"idle" | "writing" | "done" | "failed">("idle");
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);

  const [jobId, setJobId] = useState<string | null>(null);
  const [resultKitId, setResultKitId] = useState<string | null>(null);

  const job = jobId ? (jobs.find((entry) => entry.id === jobId) ?? null) : null;
  const loadKitId = openKitId ?? resultKitId;

  /** A kit reopened from the rail, or the one a run just wrote. */
  useEffect(() => {
    if (!loadKitId) return;
    let cancelled = false;

    fetchMarketingKit(loadKitId).then((res) => {
      if (cancelled || res.status !== "success" || !res.kit?.affinity) return;
      const saved = res.kit.affinity;
      setKit(res.kit);

      // A freshly written deck is already on screen; only a reopened one has
      // to be restored from storage.
      if (loadKitId !== openKitId) return;

      setCollectionName(saved.collectionName);
      setTagline(saved.tagline);
      setCoverSplit(saved.coverSplit);
      setItems(saved.items);
      setPieces(
        saved.pieces.map((piece) => ({
          id: String(piece.index),
          image: piece.productImage?.url ?? "",
          // Enough to place the piece in the right half of the catalog; the
          // sheet pages themselves are not needed to render the deck.
          sheetImages: piece.sheetImages.map((sheet) => sheet.url),
          sheetExcelText: Array.from({ length: piece.sheetExcelCount }, () => ""),
          designerInitial: piece.designerInitial,
        }))
      );
      setStatus("done");
    });

    return () => {
      cancelled = true;
    };
  }, [loadKitId, openKitId]);

  useSettledJob(job, (settled) => {
    setJobId(null);

    if (settled.status !== "completed") {
      setStatus("failed");
      setError(failureMessage(settled, "Could not write that catalog copy"));
      return;
    }

    const result = settled.result?.result;
    if (result) {
      setCollectionName(result.collectionName);
      setTagline(result.tagline);
      setItems(result.items);
      setStatus("done");
    } else {
      setStatus("failed");
      setError("The model returned no catalog copy");
    }
    if (settled.result?.kitId) setResultKitId(settled.result.kitId);
  });

  /**
   * Edits are saved as they are made rather than behind a Save button: the
   * deck is edited by direct manipulation — dragging a card, typing into a
   * caption — and there is no moment in that which reads as "now commit".
   */
  const persist = useCallback(
    async (patch: { collectionName?: string; tagline?: string; items?: AffinityItem[]; coverSplit?: number }) => {
      if (patch.collectionName !== undefined) setCollectionName(patch.collectionName);
      if (patch.tagline !== undefined) setTagline(patch.tagline);
      if (patch.items !== undefined) setItems(patch.items);
      if (patch.coverSplit !== undefined) setCoverSplit(patch.coverSplit);

      if (!kit) return;
      const res = await updateMarketingKit(kit.id, patch);
      if (res.status !== "success") setError(res.message || "Could not save that edit");
    },
    [kit]
  );

  function reset() {
    setPieces([newPiece()]);
    setKit(null);
    setItems([]);
    setCollectionName("");
    setTagline("");
    setCoverSplit(60);
    setStatus("idle");
    setError("");
    setJobId(null);
    setResultKitId(null);
  }

  async function handleWrite() {
    const ready = pieces.filter((piece) => piece.image);
    if (ready.length === 0) return;

    setError("");
    setStatus("writing");
    setItems([]);

    const preview = await makeThumbnail(ready[0].image);
    const res = await affinity({
      items: ready.map((piece) => ({
        image: piece.image,
        sheetImages: piece.sheetImages,
        sheetExcelText: piece.sheetExcelText.filter(Boolean),
      })),
      preview,
    });

    if (res.status === "queued" && res.job) {
      setJobId(res.job.id);
      track(res.job);
    } else if (creditGuard(res)) {
      setStatus("idle");
    } else {
      setStatus("failed");
      setError(res.message || "Could not queue this deck");
    }
  }

  async function downloadPptx() {
    setExporting(true);
    try {
      await exportAffinityPptx({ collectionName, tagline, items, pieces });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not build the PowerPoint");
    } finally {
      setExporting(false);
    }
  }

  const showingDeck = status === "done" && items.length > 0;

  /*
   * New Kit / Download PPTX / Download PDF live in the top bar rather than
   * above the deck — the deck is the document, and a toolbar sitting on top
   * of it would print with it.
   */
  usePageActions(
    showingDeck ? (
      <div className="flex items-center gap-1.5" data-app-chrome>
        <HeaderAction onClick={reset} icon={RotateCcw} label="New Kit" />
        <HeaderAction onClick={downloadPptx} icon={FileDown} label="Download PPTX" busy={exporting} />
        <HeaderAction onClick={exportAffinityPdf} icon={Download} label="Download PDF" />
      </div>
    ) : null
  );

  if (!can(user, PERMISSION)) {
    return <ToolAccessNotice tool="Marketing Kit" />;
  }

  const writing = status === "writing";
  const readyCount = pieces.filter((piece) => piece.image).length;

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <ErrorBanner message={error} />

      <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-7">
        {showingDeck ? (
          <AffinityDeck
            collectionName={collectionName}
            tagline={tagline}
            items={items}
            pieces={pieces}
            coverSplit={coverSplit}
            onChange={persist}
          />
        ) : (
          <div className="mx-auto max-w-4xl space-y-6">
            <div>
              <p className="mb-1 text-sm font-semibold text-cream">Pieces</p>
              <p className="text-xs text-faint">
                Each piece gets its own hero photo and its own production development sheet — they&apos;re never shared.
              </p>
            </div>

            <AffinityPieceCards pieces={pieces} onChange={setPieces} onError={setError} max={MAX_PIECES} />

            <RunButton
              onClick={handleWrite}
              disabled={readyCount === 0 || writing}
              icon={writing ? <Loader2 size={14} className="animate-spin" /> : <LayoutGrid size={14} />}
            >
              {writing
                ? "Writing the catalog copy…"
                : `Build the catalog · ${readyCount} piece${readyCount === 1 ? "" : "s"}`}
            </RunButton>

            {writing && job && <JobProgressBar percent={job.progress} />}

            <p className="text-[11px] leading-relaxed text-faint">
              A piece with a production sheet is written up as an existing style, with a real spec caption. A piece with
              only a photo is left blank on purpose — there is nothing to verify a description against, so you write
              that one yourself.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function HeaderAction({
  onClick,
  icon: Icon,
  label,
  busy,
}: {
  onClick: () => void;
  icon: typeof Download;
  label: string;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg border border-white/10 px-2 py-1 text-[11px] text-muted transition-colors hover:bg-white/[0.07] hover:text-cream disabled:opacity-50 sm:px-2.5"
    >
      {busy ? <Loader2 size={12} className="animate-spin" /> : <Icon size={12} />}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
