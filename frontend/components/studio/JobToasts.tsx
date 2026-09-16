"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, TriangleAlert, X } from "lucide-react";
import type { QueuedJob } from "@/lib/api";
import { useJobs } from "@/lib/jobs-context";
import { conversationHref, TOOL_LABELS } from "@/lib/nav";
import { formatDuration } from "@/lib/job-progress";
import { cn } from "@/lib/utils";

/**
 * Tells the user when queued work finishes, wherever they happen to be.
 *
 * The queue rail already shows this, but it is a column of 36px thumbnails on
 * the edge of the screen — easy to miss while reading something else, and
 * invisible on a phone. A run can take a minute, which is long enough to look
 * away, so the moment it lands is worth announcing once.
 */

/** Long enough to read and click, short enough not to sit over the work. */
const DISMISS_AFTER_MS = 8000;

/** Beyond this the stack is covering the page it is reporting on. */
const MAX_SHOWN = 3;

type Toast = { id: string; job: QueuedJob };

export function JobToasts() {
  const { onJobSettled } = useJobs();
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Driven by the queue's own "it just finished" event rather than by diffing
  // the list: the provider is where the socket transition is visible, and a
  // job that merely arrives already-finished never reaches here.
  useEffect(
    () =>
      onJobSettled((job) =>
        setToasts((current) => [{ id: job.id, job }, ...current.filter((t) => t.id !== job.id)].slice(0, MAX_SHOWN))
      ),
    [onJobSettled]
  );

  function dismiss(id: string) {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }

  return (
    // Clear of the queue rail on the right, and of the composer on a phone.
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2 md:right-20">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <JobToast key={toast.id} job={toast.job} onDismiss={() => dismiss(toast.id)} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function JobToast({ job, onDismiss }: { job: QueuedJob; onDismiss: () => void }) {
  const failed = job.status !== "completed";
  const href = conversationHref(job.tool, job.result?.conversationId, job.result?.modelLabel);
  const preview = job.result?.outputUrl ?? job.preview;
  const count = job.result?.outputUrls?.length ?? 0;

  useEffect(() => {
    const timer = setTimeout(onDismiss, DISMISS_AFTER_MS);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  const body = (
    <>
      {preview && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- a remote result thumbnail at a fixed tiny size; next/image adds nothing
        <img src={preview} alt="" className="h-9 w-9 shrink-0 rounded-md border border-white/10 object-cover" />
      ) : (
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-md border",
            failed ? "border-error/25 bg-error/[0.08] text-error" : "border-white/10 bg-white/[0.04] text-gold"
          )}
        >
          {failed ? <TriangleAlert size={15} /> : <CheckCircle2 size={15} />}
        </span>
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-medium text-cream">
          {TOOL_LABELS[job.tool] ?? job.tool} · {failed ? "Failed" : count > 1 ? `${count} images ready` : "Ready"}
        </p>
        <p className="truncate text-[10px] text-faint">
          {failed
            ? job.error?.message || "Something went wrong"
            : `Done${job.durationMs ? ` · ${formatDuration(job.durationMs)}` : ""}${href ? " · open" : ""}`}
        </p>
      </div>
    </>
  );

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "pointer-events-auto flex w-64 items-center gap-2.5 rounded-lg border bg-surface-float/95 p-2 shadow-lg shadow-black/25 backdrop-blur-sm",
        failed ? "border-error/25" : "border-white/[0.10]"
      )}
    >
      {href && !failed ? (
        <Link href={href} onClick={onDismiss} className="flex min-w-0 flex-1 items-center gap-2.5">
          {body}
        </Link>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-2.5">{body}</div>
      )}

      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-faint transition-colors hover:bg-white/[0.07] hover:text-cream"
      >
        <X size={12} />
      </button>
    </motion.div>
  );
}
