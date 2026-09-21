"use client";

import { useCallback, useEffect, useState } from "react";
import {
  deleteLifestyleModel,
  generateLifestyleModel,
  listLifestyleModels,
  saveLifestyleModel,
  updateLifestyleModel,
  DEFAULT_SPARKLE_MODEL,
  LIFESTYLE_PRESETS,
  type LifestyleModel,
  type SparkleModelId,
} from "@/lib/api";
import { compressImage } from "@/lib/image";
import { useJobs } from "@/lib/jobs-context";
import { failureMessage, useSettledJob } from "@/lib/useSettledJob";

/**
 * Picking, making and keeping the person a piece of jewellery gets placed
 * onto.
 *
 * Shared by Lifestyle and Campaign Kit, which need exactly the same thing —
 * the two had entirely separate copies of this in the app this replaces, and
 * a model saved in one was invisible in the other.
 */

/** The three ways a run can name its model. */
export type ModelChoice =
  | { kind: "preset"; number: number; src: string }
  | { kind: "saved"; id: string; src: string }
  | { kind: "upload"; dataUrl: string; src: string };

/**
 * A chosen model as the request fields that name it.
 *
 * Lives beside `ModelChoice` because it is the other half of that type:
 * three ways to pick a person, three fields the API accepts. Lifestyle and
 * Campaign Kit both send one, and each had a byte-identical copy of this.
 */
export function modelRequestFields(choice: ModelChoice) {
  if (choice.kind === "preset") return { modelNumber: choice.number };
  if (choice.kind === "saved") return { modelId: choice.id };
  return { modelImage: choice.dataUrl };
}

export function useModelLibrary() {
  const [models, setModels] = useState<LifestyleModel[]>([]);
  const [choice, setChoice] = useState<ModelChoice | null>({
    kind: "preset",
    number: LIFESTYLE_PRESETS[0].number,
    src: LIFESTYLE_PRESETS[0].src,
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const { jobs, track } = useJobs();
  /**
   * The queued model generation, as state rather than a ref alone: the grid
   * draws a tile for it while it runs, so its progress has to re-render.
   */
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await listLifestyleModels();
    if (res.status === "success") setModels(res.models ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;

    listLifestyleModels().then((res) => {
      if (cancelled) return;
      if (res.status === "success") setModels(res.models ?? []);
      setLoading(false);
    });

    // A page unmounted mid-request must not write into state that no longer
    // exists — and on a fast remount, a slow first response must not land
    // after a fresher second one.
    return () => {
      cancelled = true;
    };
  }, []);

  /** The running generation — the grid draws a tile from its progress. */
  const pendingJob = pendingJobId ? (jobs.find((entry) => entry.id === pendingJobId) ?? null) : null;

  /*
   * Settles the generation the moment the queue reports it finished, using
   * the same watcher the tools without a refine loop use rather than a
   * hand-rolled effect — which is what this was, and it painted one extra
   * frame of "still building" after the model had already landed.
   */
  useSettledJob(pendingJob, (settled) => {
    setPendingJobId(null);
    setGenerating(false);

    const saved = settled.status === "completed" ? settled.result?.lifestyleModel : null;
    if (saved) {
      setModels((current) => [saved, ...current]);
      setChoice({ kind: "saved", id: saved.id, src: saved.thumbnailUrl });
    } else {
      setError(failureMessage(settled, "Could not generate that model"));
    }
  });

  /** Queues a new model from the builder's attributes. */
  const generate = useCallback(
    async (attrs: Record<string, string>, notes: string, name: string, model: SparkleModelId = DEFAULT_SPARKLE_MODEL) => {
      setError("");
      setGenerating(true);

      const res = await generateLifestyleModel({ attrs, notes, name, model });
      if (res.status === "queued" && res.job) {
        setPendingJobId(res.job.id);
        track(res.job);
        return true;
      }

      setGenerating(false);
      setError(res.message || "Could not queue that model");
      // Whether it got onto the queue — the builder only steps out of the
      // way once there is a tile to watch instead.
      return false;
    },
    [track]
  );

  /**
   * Uses a photo straight away, and saves it to the library in the
   * background.
   *
   * The choice is set from the bytes rather than from the saved row, so a
   * slow upload never stands between picking a photo and using it — and a
   * save that fails costs a library entry, not the run.
   */
  const upload = useCallback(async (file: File, name?: string) => {
    setError("");
    try {
      const dataUrl = await compressImage(file);
      setChoice({ kind: "upload", dataUrl, src: dataUrl });

      const res = await saveLifestyleModel({ name, imageDataUri: dataUrl });
      if (res.status === "success" && res.model) {
        const saved = res.model;
        setModels((current) => [saved, ...current]);
        setChoice({ kind: "saved", id: saved.id, src: saved.thumbnailUrl });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that photo");
    }
  }, []);

  const rename = useCallback(async (id: string, name: string) => {
    const res = await updateLifestyleModel(id, { name });
    if (res.status === "success" && res.model) {
      setModels((current) => current.map((entry) => (entry.id === id ? res.model! : entry)));
    } else {
      setError(res.message || "Could not rename that model");
    }
  }, []);

  /**
   * Shares a model with the whole organization, or takes it back.
   *
   * The server allows this to a super admin only and answers 403 otherwise;
   * the message is surfaced rather than swallowed, because a button that
   * silently does nothing is worse than one that says why.
   */
  const setPublic = useCallback(async (id: string, isPublic: boolean) => {
    const res = await updateLifestyleModel(id, { isPublic });
    if (res.status === "success" && res.model) {
      setModels((current) => current.map((entry) => (entry.id === id ? res.model! : entry)));
    } else {
      setError(res.message || "Could not change who can see that model");
    }
  }, []);

  const remove = useCallback(
    async (id: string) => {
      const res = await deleteLifestyleModel(id);
      if (res.status === "success") {
        setModels((current) => current.filter((entry) => entry.id !== id));
        // Fall back to the first preset rather than leaving the page with a
        // selection that no longer exists.
        setChoice((current) =>
          current?.kind === "saved" && current.id === id
            ? { kind: "preset", number: LIFESTYLE_PRESETS[0].number, src: LIFESTYLE_PRESETS[0].src }
            : current
        );
      } else {
        setError(res.message || "Could not delete that model");
      }
    },
    []
  );

  return {
    models,
    loading,
    choice,
    setChoice,
    error,
    setError,
    generating,
    pendingJob,
    generate,
    upload,
    rename,
    setPublic,
    remove,
    refresh,
  };
}

export type ModelLibraryState = ReturnType<typeof useModelLibrary>;
