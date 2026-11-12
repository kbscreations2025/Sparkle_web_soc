"use client";

import { useCallback, useEffect, useState } from "react";
import {
  deleteLifestyleModel,
  generateLifestyleModel,
  listLifestyleModels,
  saveLifestyleModel,
  updateLifestyleModel,
  DEFAULT_SPARKLE_MODEL,
  type LifestyleModel,
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

/**
 * The two ways a run can name its model. Every model is a library row now —
 * the old built-in Model 4 and 5 included (seeded as shared models) — so
 * "upload" is only the moment between picking a photo and its save finishing.
 */
export type ModelChoice =
  | { kind: "saved"; id: string; src: string }
  | { kind: "upload"; dataUrl: string; src: string };

/**
 * A chosen model as the request fields that name it.
 *
 * Lives beside `ModelChoice` because it is the other half of that type.
 * Lifestyle and Campaign Kit both send one. A library model goes by id — the
 * run points at its photo instead of storing a copy.
 */
export function modelRequestFields(choice: ModelChoice) {
  if (choice.kind === "saved") return { modelId: choice.id };
  return { modelImage: choice.dataUrl };
}

/** The first model in the library, as a choice — what a page starts on. */
function firstChoice(models: LifestyleModel[]): ModelChoice | null {
  const first = models[0];
  return first ? { kind: "saved", id: first.id, src: first.thumbnailUrl } : null;
}

export function useModelLibrary() {
  const [models, setModels] = useState<LifestyleModel[]>([]);
  /** Null until the library loads (then its first model), or when it is empty. */
  const [choice, setChoice] = useState<ModelChoice | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [generating, setGenerating] = useState(false);
  /**
   * An uploaded photo is still saving to the library. A run waits for it, so
   * it can name the model by id instead of carrying (and storing) a copy.
   */
  const [saving, setSaving] = useState(false);

  const { jobs, track } = useJobs();
  /**
   * The queued model generation, as state rather than a ref alone: the grid
   * draws a tile for it while it runs, so its progress has to re-render.
   */
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    listLifestyleModels().then((res) => {
      if (cancelled) return;
      if (res.status === "success") {
        const list = res.models ?? [];
        setModels(list);
        // Start on the first model, unless something was already picked.
        setChoice((current) => current ?? firstChoice(list));
      }
      setLoaded(true);
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
    async (attrs: Record<string, string>, notes: string, name: string) => {
      setError("");
      setGenerating(true);

      const res = await generateLifestyleModel({ attrs, notes, name, model: DEFAULT_SPARKLE_MODEL });
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
   * Shows a photo straight away and saves it to the library.
   *
   * The page holds Generate while `saving`, so the run names the saved model
   * by id rather than sending (and storing) its own copy. If the save fails,
   * the photo itself is still usable — a run then carries it, as runs used to.
   */
  const upload = useCallback(async (file: File) => {
    setError("");
    setSaving(true);
    try {
      const dataUrl = await compressImage(file);
      setChoice({ kind: "upload", dataUrl, src: dataUrl });

      const res = await saveLifestyleModel({ imageDataUri: dataUrl });
      if (res.status === "success" && res.model) {
        const saved = res.model;
        setModels((current) => [saved, ...current]);
        setChoice({ kind: "saved", id: saved.id, src: saved.thumbnailUrl });
      } else {
        setError(res.message || "Could not save that photo to the library — it will still be used for this run");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that photo");
    } finally {
      setSaving(false);
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

  /**
   * Deletes a model from every picker — past runs keep showing it. With
   * `purge` (admins only) the photo itself is removed too, and past runs show
   * "model removed".
   */
  const remove = useCallback(async (id: string, options: { purge?: boolean } = {}) => {
    const res = await deleteLifestyleModel(id, options);
    if (res.status === "success") {
      setModels((current) => {
        const next = current.filter((entry) => entry.id !== id);
        // Fall back to the first model left rather than a selection that no longer exists.
        setChoice((picked) => (picked?.kind === "saved" && picked.id === id ? firstChoice(next) : picked));
        return next;
      });
    } else {
      setError(res.message || "Could not delete that model");
    }
  }, []);

  return {
    models,
    choice,
    setChoice,
    /** Whether the library has answered — before that an empty list means "loading", not "none". */
    loaded,
    error,
    generating,
    saving,
    pendingJob,
    generate,
    upload,
    rename,
    setPublic,
    remove,
  };
}

export type ModelLibraryState = ReturnType<typeof useModelLibrary>;
