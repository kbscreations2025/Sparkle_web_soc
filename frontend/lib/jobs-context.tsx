"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { io } from "socket.io-client";
import { BACKEND_URL, cancelJob, fetchJobs, type QueuedJob } from "./api";
import { useAuth } from "./auth-context";

/** Live states, as the backend defines them. */
const ACTIVE = new Set(["queued", "running"]);

/** Settled jobs are kept so a page can still see the result land, but not forever. */
const MAX_TRACKED = 50;

/**
 * How many jobs a refresh pulls back, across every status.
 *
 * Deliberately not just the live ones: a job that failed or finished while the
 * tab was closed is exactly what someone coming back wants to see, and asking
 * only for what is still running would make it invisible.
 */
const REFRESH_LIMIT = 20;

type JobsContextValue = {
  /** Everything this tab knows about: still running, plus recently settled. */
  jobs: QueuedJob[];
  /** Just the queued/running ones — what the on-screen queue shows. */
  activeJobs: QueuedJob[];
  /** Whether job updates are arriving live, or the page is running blind. */
  connected: boolean;
  /** Adds a job the moment a route hands one back, before any socket traffic. */
  track: (job: QueuedJob) => void;
  /** Re-reads from the server. The reconciliation path when live updates were missed. */
  refresh: () => Promise<void>;
};

const JobsContext = createContext<JobsContextValue>({
  jobs: [],
  activeJobs: [],
  connected: false,
  track: () => {},
  refresh: async () => {},
});

/**
 * One place that knows what this person has queued.
 *
 * Two sources feed it and they are deliberately both kept: a socket for
 * immediacy, and a fetch for truth. The socket alone would lose everything the
 * moment a tab reloads or a connection blips — which is the exact failure this
 * whole queue exists to fix — so mounting (and reconnecting) always re-reads
 * from the server rather than trusting what the tab happens to remember.
 */
export function JobsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.user_id;

  const [jobsById, setJobsById] = useState<Record<string, QueuedJob>>({});
  const [connected, setConnected] = useState(false);

  const upsert = useCallback((incoming: QueuedJob | QueuedJob[]) => {
    setJobsById((current) => {
      const next = { ...current };
      for (const job of Array.isArray(incoming) ? incoming : [incoming]) next[job.id] = job;

      // Trim settled jobs once there are too many to be worth remembering.
      // Active ones are never dropped: something on screen is waiting for them.
      const settled = Object.values(next)
        .filter((job) => !ACTIVE.has(job.status))
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      for (const job of settled.slice(MAX_TRACKED)) delete next[job.id];

      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const result = await fetchJobs({ status: "all", limit: REFRESH_LIMIT });
    if (result.status === "success" && result.jobs) {
      // Replaces rather than merges the active set: a job that finished while
      // this tab was away is gone from the response, and merging would leave it
      // spinning on screen forever.
      setJobsById((current) => {
        const settled = Object.fromEntries(
          Object.entries(current).filter(([, job]) => !ACTIVE.has(job.status))
        );
        return { ...settled, ...Object.fromEntries(result.jobs!.map((job) => [job.id, job])) };
      });
    }
  }, [userId]);

  /**
   * One effect for both halves of staying in sync, because they are the same
   * concern: `refresh` establishes the truth (the reload fix — whatever this
   * tab was doing before, ask the server), and the socket keeps it current.
   *
   * `refresh` is safe in the dependency list: it only changes identity when
   * `userId` does, which already tears this down and rebuilds it anyway.
   */
  useEffect(() => {
    if (!userId) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect -- the rule can't see past the await inside `refresh`: its setState runs a network round-trip later, not synchronously during this effect, so there is no cascading render to avoid
    refresh();

    const socket = io(BACKEND_URL, { withCredentials: true });

    socket.on("connect", () => {
      setConnected(true);
      // A reconnect means updates were missed while the socket was down, so
      // catch up rather than waiting for the next one to arrive.
      refresh();
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("job:updated", (job: QueuedJob) => upsert(job));

    return () => {
      socket.disconnect();
    };
  }, [userId, upsert, refresh]);

  const jobs = useMemo(
    () => Object.values(jobsById).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    [jobsById]
  );
  const activeJobs = useMemo(() => jobs.filter((job) => ACTIVE.has(job.status)), [jobs]);

  const value = useMemo(
    () => ({ jobs, activeJobs, connected, track: (job: QueuedJob) => upsert(job), refresh }),
    [jobs, activeJobs, connected, upsert, refresh]
  );

  return <JobsContext.Provider value={value}>{children}</JobsContext.Provider>;
}

export function useJobs() {
  return useContext(JobsContext);
}

/** Follows one job by id — what a tool page uses to wait for its own run. */
export function useJob(jobId: string | null) {
  const { jobs } = useJobs();
  return useMemo(() => (jobId ? jobs.find((job) => job.id === jobId) ?? null : null), [jobs, jobId]);
}

/**
 * The list every queue surface shows: what is running, then the last few
 * results underneath.
 *
 * Capped by count rather than by age deliberately — a clock read during
 * render makes the list depend on when React happened to re-run, so a result
 * could vanish mid-glance.
 *
 * `activeIds` comes back with it so a caller can tell a live row from a
 * settled one without scanning `activeJobs` again per row.
 */
export function useQueueList(settledShown: number) {
  const { jobs, activeJobs } = useJobs();

  return useMemo(() => {
    const activeIds = new Set(activeJobs.map((job) => job.id));
    const settled = jobs.filter((job) => !activeIds.has(job.id)).slice(0, settledShown);
    return { visible: [...activeJobs, ...settled], activeIds, running: activeJobs.length };
  }, [jobs, activeJobs, settledShown]);
}

/**
 * Cancelling one job, with the in-flight flag every row needs to disable its
 * own button. Re-reads the queue afterwards, since the cancel changes a
 * status the socket won't announce.
 */
export function useCancelJob() {
  const { refresh } = useJobs();
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const cancel = useCallback(
    async (jobId: string) => {
      setCancellingId(jobId);
      try {
        await cancelJob(jobId);
        await refresh();
      } finally {
        setCancellingId(null);
      }
    },
    [refresh]
  );

  return { cancel, cancellingId };
}
