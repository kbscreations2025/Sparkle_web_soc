"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, CheckCircle2, Loader2, TriangleAlert, X } from "lucide-react";
import { type QueuedJob } from "@/lib/api";
import { describeJob, useNow } from "@/lib/job-progress";
import { useCancelJob, useJobs, useQueueList } from "@/lib/jobs-context";
import { conversationHref, TOOL_LABELS } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { JobProgressBar } from "./JobProgressBar";

/** How many finished jobs stay listed under whatever is still running. */
const SETTLED_SHOWN = 5;

/**
 * The queue, on screen, everywhere.
 *
 * Lives in the nav rather than on a tool page on purpose: work outlives the
 * page that started it now, so "what's still running" has to be answerable
 * after navigating away — or after the reload that used to lose it entirely.
 */
export function QueueIndicator() {
  const { connected, refresh } = useJobs();
  const { visible: recent, running } = useQueueList(SETTLED_SHOWN);
  const { cancel, cancellingId } = useCancelJob();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Only ticks while the panel is open and something is actually running —
  // a closed dropdown has nothing to count.
  const now = useNow(open && running > 0);

  useEffect(() => {
    if (!open) return;
    function onClickAway(event: MouseEvent) {
      if (!panelRef.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onClickAway);
    return () => window.removeEventListener("mousedown", onClickAway);
  }, [open]);

  // Nothing running and nothing worth reporting — stay out of the way.
  if (recent.length === 0) return null;

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => {
          setOpen((current) => !current);
          if (!open) refresh();
        }}
        title={running > 0 ? `${running} generation${running > 1 ? "s" : ""} in progress` : "Recent generations"}
        className={cn(
          "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
          running > 0
            ? "border-gold/30 bg-gold/10 text-gold"
            : "border-white/10 text-faint hover:text-cream"
        )}
      >
        {running > 0 ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
        {running > 0 ? `${running} in queue` : "Queue"}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-xl border border-white/10 bg-surface-raised shadow-[0_12px_40px_rgba(0,0,0,0.18)]">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-faint">Queue</span>
            {/* Worth showing: without a live connection the list only moves when
                it is re-fetched, so a stalled-looking job may just be stale. */}
            {!connected && <span className="text-[9px] text-faint">reconnecting…</span>}
          </div>

          <ul className="max-h-80 divide-y divide-white/[0.06] overflow-y-auto">
            {recent.map((job) => (
              <QueueRow
                key={job.id}
                job={job}
                now={now}
                cancelling={cancellingId === job.id}
                onCancel={cancel}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function QueueRow({
  job,
  now,
  cancelling,
  onCancel,
}: {
  job: QueuedJob;
  now: number;
  cancelling: boolean;
  onCancel: (jobId: string) => void;
}) {
  const action = job.request?.isRefinement ? "Refinement" : "Clean";
  const model = job.request?.modelLabel || job.request?.model || "";
  const { label } = describeJob(job, now);
  // Resolved per tool rather than assuming the cleaning workspace — the queue
  // is shared, and hardcoding one tool's path sends every other tool's result
  // to the wrong page.
  const href = conversationHref(job.tool, job.result?.conversationId, model);

  return (
    <li className="flex items-start gap-2 px-3 py-2">
      <StatusIcon status={job.status} />

      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] text-cream">
          {TOOL_LABELS[job.tool] || job.tool} · {action}
          {model && <span className="text-faint"> · {model}</span>}
        </p>
        <p className={cn("truncate text-[10px]", job.status === "failed" ? "text-error/80" : "text-faint")}>{label}</p>

        {job.status === "running" && <JobProgressBar percent={job.progress} className="mt-1" />}
      </div>

      {/* Only offered while it is still waiting — a started run can't be
          recalled from the provider, so the backend refuses it. */}
      {job.status === "queued" && (
        <button
          type="button"
          onClick={() => onCancel(job.id)}
          disabled={cancelling}
          title="Cancel"
          className="mt-0.5 rounded p-0.5 text-faint transition-colors hover:text-error disabled:opacity-40"
        >
          <X size={12} />
        </button>
      )}

      {/* The reload case: this tab no longer has the thread that queued the
          job, but the conversation is on the server — reopening it is what the
          History "Continue" button already does. */}
      {job.status === "completed" && href && (
        <Link
          href={href}
          title="Open this result"
          className="mt-0.5 rounded p-0.5 text-faint transition-colors hover:text-gold"
        >
          <ArrowUpRight size={12} />
        </Link>
      )}
    </li>
  );
}

function StatusIcon({ status }: { status: QueuedJob["status"] }) {
  if (status === "running" || status === "queued") {
    return <Loader2 size={13} className={cn("mt-0.5 shrink-0 text-gold", status === "running" && "animate-spin")} />;
  }
  if (status === "failed") return <TriangleAlert size={13} className="mt-0.5 shrink-0 text-error" />;
  if (status === "cancelled") return <X size={13} className="mt-0.5 shrink-0 text-faint" />;
  return <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-gold" />;
}
