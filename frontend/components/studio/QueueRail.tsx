"use client";

import { memo, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ImageIcon,
  Loader2,
  TriangleAlert,
  X,
} from "lucide-react";
import { type QueuedJob } from "@/lib/api";
import { describeJob, useNow } from "@/lib/job-progress";
import { useCancelJob, useJobs, useQueueList } from "@/lib/jobs-context";
import { conversationHref, TOOL_LABELS } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { JobProgressBar } from "./JobProgressBar";

/** How many finished jobs stay listed under whatever is still running. */
const SETTLED_SHOWN = 6;

/**
 * The queue, pinned to the left of every tool page.
 *
 * Work outlives the page that started it now, so "what is still running" has
 * to be answerable at a glance from anywhere — not hidden behind a menu, and
 * not tied to the tool that happens to be open. This rail is the one place
 * that is always true, whatever the user navigates to or reloads.
 */
export function QueueRail() {
  const { connected, refresh } = useJobs();
  const { visible, activeIds, running } = useQueueList(SETTLED_SHOWN);
  // Held here, not per row: a row calling `useCancelJob` itself would
  // subscribe every row to the jobs context, so any one job's progress tick
  // would re-render all of them and `RailRow`'s memo would buy nothing.
  const { cancel, cancellingId } = useCancelJob();

  /**
   * Expansion is a temporary state, not a saved preference: the rail always
   * starts narrow and widens only for as long as someone is using it. Being
   * ephemeral is also what makes it safe to render — there is nothing to read
   * from storage, so the server and the first client paint already agree.
   */
  const [expanded, setExpanded] = useState(false);
  const railRef = useRef<HTMLElement>(null);

  function toggle() {
    const next = !expanded;
    setExpanded(next);
    // Opening it is a good moment to make sure what it shows is current.
    if (next) refresh();
  }

  /**
   * Open until attention moves elsewhere.
   *
   * Anything inside the rail — a row, the cancel button, a scroll — is still
   * using it, so those are left alone; the first click anywhere else closes
   * it. Clicking a row therefore keeps it open while the page behind
   * navigates, which is deliberate: the queue is how you move between runs,
   * and collapsing on every pick would fight that.
   *
   * `mousedown` rather than `click`, so the rail is already closing as the
   * press lands rather than a frame later — and it matches how the nav's
   * queue dropdown dismisses. Escape closes it too, which is what anything
   * temporarily covering the page is expected to do.
   */
  useEffect(() => {
    if (!expanded) return;

    function onPointerDown(event: MouseEvent) {
      if (!railRef.current?.contains(event.target as Node)) setExpanded(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setExpanded(false);
    }

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [expanded]);

  // Ticks only while something is in flight. Settled rows are handed 0 rather
  // than this, so a second passing doesn't re-render a list of finished work
  // whose labels cannot change.
  const now = useNow(running > 0);

  return (
    <aside
      ref={railRef}
      className={cn(
        // `border-l`: this is the page's right-hand edge, so the rule belongs
        // between the rail and the workspace, not outside it.
        "hidden shrink-0 flex-col border-l border-white/[0.06] bg-surface-raised/40 transition-[width] duration-200 md:flex",
        expanded ? "w-52" : "w-14"
      )}
    >
      <div
        className={cn(
          "flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-2 py-2.5",
          expanded ? "justify-between" : "justify-center"
        )}
      >
        {/* Toggle first, title second: on a right-hand rail the chevron
            belongs on the inner edge, pointing the way the panel will move —
            right to close it against the edge, left to open it out. */}
        <button
          type="button"
          onClick={toggle}
          title={expanded ? "Collapse queue" : "Expand queue"}
          className="rounded-md p-1 text-faint transition-colors hover:bg-white/[0.06] hover:text-cream"
        >
          {expanded ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
        {expanded && (
          <span className="truncate text-[10px] font-semibold uppercase tracking-wider text-faint">
            Queue{running > 0 && ` · ${running}`}
          </span>
        )}
      </div>

      {visible.length === 0 ? (
        <EmptyState expanded={expanded} />
      ) : (
        <ul className={cn("flex-1 overflow-y-auto py-1", expanded ? "px-1.5" : "px-0")}>
          {visible.map((job) => (
            <RailRow
              key={job.id}
              job={job}
              expanded={expanded}
              now={activeIds.has(job.id) ? now : 0}
              cancelling={cancellingId === job.id}
              onCancel={cancel}
            />
          ))}
        </ul>
      )}

      {/* Worth saying: with no live connection the rail only moves when it is
          re-fetched, so a job that looks stuck may just be a stale reading. */}
      {!connected && (
        <p
          className={cn(
            "shrink-0 border-t border-white/[0.06] px-2 py-1.5 text-[9px] text-faint",
            expanded ? "text-left" : "text-center"
          )}
          title="Reconnecting to live updates"
        >
          {expanded ? "Reconnecting…" : "•••"}
        </p>
      )}
    </aside>
  );
}

function EmptyState({ expanded }: { expanded: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-start gap-2 px-2 py-6 text-center">
      <ImageIcon size={16} className="text-faint/50" />
      {expanded && <p className="text-[10px] leading-relaxed text-faint/70">Nothing running. Generations you start appear here.</p>}
    </div>
  );
}

/**
 * Memoised: a socket update replaces one job, and without this every row in
 * the rail would re-render on every progress tick of any single job.
 */
const RailRow = memo(function RailRow({
  job,
  expanded,
  now,
  cancelling,
  onCancel,
}: {
  job: QueuedJob;
  expanded: boolean;
  /** The shared clock, or 0 for a settled row whose label can't change. */
  now: number;
  cancelling: boolean;
  /** Stable across renders (see the parent's `useCancelJob`), so the memo holds. */
  onCancel: (jobId: string) => void;
}) {
  const tool = TOOL_LABELS[job.tool] || job.tool;
  const action = job.request?.isRefinement ? "Refinement" : "Clean";
  const model = job.request?.modelLabel || job.request?.model || "";
  const running = job.status === "running";
  // The whole status line, worded once in `describeJob` so this rail and the
  // nav's queue panel can never drift apart: "Generating… 47% · 14s left",
  // "Done · 31s", "Waiting…".
  const { label: detail } = describeJob(job, now);

  /**
   * The stored preview first, and only then the result url.
   *
   * Tempting to show the finished image once there is one — but that url is
   * the full-resolution original (5000px, several megabytes) and this slot is
   * 36px. A rail that is on screen at all times must not pull that down for
   * every completed row; the preview is a ~5KB inline thumbnail, and at this
   * size it identifies the piece just as well.
   */
  const thumb = job.preview || job.result?.outputUrl || null;
  // A refinement already belongs to a thread, so it's reopenable while it runs
  // — not only once it finishes, like a first pass.
  // `model` is passed so a GPT cleaning run reopens in the workspace that
  // produced it rather than the Gemini one — both record under `cleaning`.
  const href = conversationHref(job.tool, job.result?.conversationId || job.request?.conversationId, model);

  function handleCancel(event: React.MouseEvent) {
    // The row is a link; cancelling must not also navigate.
    event.preventDefault();
    event.stopPropagation();
    onCancel(job.id);
  }

  const title = `${tool} · ${action}${model ? ` · ${model}` : ""} — ${detail}`;

  // Collapsed: the thumbnail carries the whole story, so the title attribute
  // has to say what the hidden text would have.
  if (!expanded) {
    return (
      <li className="px-2 py-1.5" title={title}>
        <RowShell href={href} className="block">
          <Thumb src={thumb} status={job.status} progress={job.progress} />
        </RowShell>
      </li>
    );
  }

  return (
    <li className="group px-0.5 py-0.5" title={title}>
      <RowShell href={href} className="flex items-center gap-2 rounded-lg p-1.5 transition-colors hover:bg-white/[0.05]">
        <Thumb src={thumb} status={job.status} progress={job.progress} />

        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-medium text-cream">{tool}</p>
          <p className="truncate text-[10px] text-faint">
            {action}
            {model && <span className="text-faint/70"> · {model}</span>}
          </p>
          {/* A failure message is the one thing here worth reading in full, and
              the rail is too narrow to ever show one — hence the row's title. */}
          <p
            className={cn("truncate text-[10px]", job.status === "failed" ? "text-error/80" : "text-faint/70")}
          >
            {detail}
          </p>

          {running && <JobProgressBar percent={job.progress} className="mt-1" />}
        </div>

        {/* Only offered while it is still waiting — a started run can't be
            recalled from the provider, so the backend refuses it. */}
        {job.status === "queued" && (
          <button
            type="button"
            onClick={handleCancel}
            disabled={cancelling}
            title="Cancel"
            className="shrink-0 rounded p-0.5 text-faint opacity-0 transition-opacity hover:text-error group-hover:opacity-100 disabled:opacity-40"
          >
            <X size={11} />
          </button>
        )}

        {/* The reload case: this tab no longer has the thread that queued the
            job, but the conversation is on the server — reopening it is what
            the History "Continue" button already does. */}
        {href && job.status !== "queued" && (
          <ChevronRight size={12} className="shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
        )}
      </RowShell>
    </li>
  );
});

/**
 * A row is a link when there's a conversation behind it, and a plain box when
 * there isn't. The caller owns every class including the display mode — adding
 * one here (a `block` alongside the caller's `flex`) would silently win in
 * Tailwind's cascade and flatten the row.
 */
function RowShell({
  href,
  className,
  children,
}: {
  href: string | null;
  className?: string;
  children: React.ReactNode;
}) {
  if (!href) return <div className={className}>{children}</div>;
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

/**
 * The picture, with the job's state drawn over it — one glance answers both
 * "which photo" and "how far along".
 */
function Thumb({ src, status, progress }: { src: string | null; status: QueuedJob["status"]; progress: number }) {
  const busy = status === "queued" || status === "running";

  return (
    <span className="relative block h-9 w-9 shrink-0 overflow-hidden rounded-md border border-white/10 bg-surface-float">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- a 36px thumbnail that is usually an inline data URI; next/image would add a proxy hop and buy nothing
        <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
      ) : (
        <span className="flex h-full w-full items-center justify-center">
          <ImageIcon size={13} className="text-faint/50" />
        </span>
      )}

      {/* Dimmed while it works so the badge stays readable over any photo. */}
      {busy && <span className="absolute inset-0 bg-black/45" />}

      <span className="absolute inset-0 flex items-center justify-center">
        <StatusIcon status={status} progress={progress} />
      </span>
    </span>
  );
}

/**
 * Sits on top of the thumbnail, so everything here needs to stay legible over
 * an arbitrary photo — hence the drop shadow and the dimming behind it.
 */
function StatusIcon({ status, progress }: { status: QueuedJob["status"]; progress: number }) {
  const shadow = "drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]";

  if (status === "running") {
    return (
      <span className="relative flex h-5 w-5 items-center justify-center">
        {/* A ring filled to the actual percentage, rather than a spinner that
            turns at the same rate whatever is happening. `conic-gradient`
            keeps it to one element with no SVG and no layout cost, and the
            transition carries it smoothly between one-second updates. */}
        <span
          className="absolute inset-0 rounded-full transition-[background] duration-1000 ease-linear"
          style={{
            // The theme's own token, so the ring follows light/dark like every
            // other gold element rather than pinning one hex value.
            background: `conic-gradient(var(--color-gold) ${progress * 3.6}deg, rgba(255,255,255,0.25) 0deg)`,
            // Punches out the middle, leaving a 2px ring.
            mask: "radial-gradient(circle, transparent 6px, #000 6.5px)",
            WebkitMask: "radial-gradient(circle, transparent 6px, #000 6.5px)",
          }}
        />
        {/* The number matters more than the spinner once a run is underway. */}
        <span className={cn("absolute text-[7px] font-bold tabular-nums text-white", shadow)}>{progress}</span>
      </span>
    );
  }
  if (status === "queued") return <Loader2 size={17} className={cn("text-white/85", shadow)} />;
  if (status === "failed") return <TriangleAlert size={16} className={cn("text-error", shadow)} />;
  if (status === "cancelled") return <X size={16} className={cn("text-white/70", shadow)} />;
  // Done: the picture is the point now, so the tick keeps out of its way.
  return <CheckCircle2 size={13} className={cn("absolute bottom-0 right-0 text-gold", shadow)} />;
}
