"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchLookbook,
  publishLookbook,
  renameLookbookSlug,
  saveLookbook,
  unpublishLookbook,
  type Lookbook,
  type LookbookSummary,
} from "../api";
import { refreshPublicLookbooks } from "@/app/(dashboard)/live-lookbook/actions";
import { normalizeDesign } from "./defaults";
import type { LookbookDesign } from "./types";

export type SaveState = "saved" | "pending" | "saving" | "error" | "conflict";

export type EditorSummary = LookbookSummary & { previousSlugs: string[] };

/** Past this many steps the oldest undo is dropped. */
const HISTORY_LIMIT = 150;
/** Edits under one coalesce key this close together undo as one step: a word typed, a slider dragged. */
const COALESCE_MS = 1500;
/** Quiet time before an edit is saved. */
const SAVE_DELAY_MS = 900;
const RETRY_DELAY_MS = 5000;

function summaryOf(lookbook: Lookbook): EditorSummary {
  // Everything but the working copy, which the editor holds itself.
  const { design: _design, revision: _revision, ...summary } = lookbook;
  void _design;
  void _revision;
  return summary;
}

/**
 * The builder's document: the page, its undo history and its saving.
 *
 * Saves are automatic, a moment after the last edit, one at a time and in
 * order. Each carries the revision it was based on, so the same page open in
 * a second tab can't silently overwrite this one (and vice versa): the later
 * save is refused, and the person chooses which copy to keep.
 */
export function useLookbookEditor(initial: Lookbook) {
  const id = initial.id;
  const [design, setDesign] = useState<LookbookDesign>(() => normalizeDesign(initial.design));
  const [title, setTitleState] = useState(initial.title);
  const [summary, setSummary] = useState<EditorSummary>(() => summaryOf(initial));
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [depth, setDepth] = useState({ past: 0, future: 0 });

  const designRef = useRef(design);
  const titleRef = useRef(title);
  const revision = useRef(initial.revision);
  /** The page as this tab last loaded or saved it, to tell a real change elsewhere from a stale revision number. */
  const savedJson = useRef(JSON.stringify(normalizeDesign(initial.design)));
  const past = useRef<LookbookDesign[]>([]);
  const future = useRef<LookbookDesign[]>([]);
  const coalesce = useRef<{ key: string; at: number } | null>(null);

  const dirty = useRef(false);
  const conflict = useRef<{ revision: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const chain = useRef<Promise<boolean>>(Promise.resolve(true));

  /* ── Saving ─────────────────────────────────────────────────────────── */

  const saveOnce = useCallback(async (): Promise<boolean> => {
    if (!dirty.current) return true;
    if (conflict.current) return false;
    dirty.current = false;
    setSaveState("saving");

    let refused = false;
    for (;;) {
      const sent = designRef.current;
      const result = await saveLookbook(id, { title: titleRef.current, design: sent, revision: revision.current });
      if (result.status === "success" && result.lookbook) {
        revision.current = result.lookbook.revision;
        savedJson.current = JSON.stringify(normalizeDesign(sent));
        const { revision: _next, ...fresh } = result.lookbook;
        void _next;
        setSummary((current) => ({ ...current, ...fresh }));
        setSaveState(dirty.current ? "pending" : "saved");
        return true;
      }

      if (result.code === "stale" && !refused) {
        // Refused for an out-of-date revision. If the saved page is the one this tab last saw,
        // nothing was lost: take the new revision and save again, with no fuss.
        refused = true;
        const latest = await fetchLookbook(id);
        const server = latest.status === "success" ? latest.lookbook : null;
        if (server && JSON.stringify(normalizeDesign(server.design)) === savedJson.current) {
          revision.current = server.revision;
          continue;
        }
      }

      dirty.current = true;
      if (result.code === "stale") {
        conflict.current = { revision: typeof result.revision === "number" ? result.revision : revision.current };
        setSaveState("conflict");
      } else {
        setSaveState("error");
      }
      return false;
    }
  }, [id]);

  /** The latest `flush`, for a timer set by an earlier one. */
  const flushRef = useRef<() => Promise<boolean>>(async () => true);
  const schedule = useCallback((delay: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flushRef.current(), delay);
  }, []);

  /** Saves now, after any save already under way. Resolves true once everything is saved. */
  const flush = useCallback((): Promise<boolean> => {
    window.clearTimeout(timer.current);
    const next = chain.current.then(() => saveOnce());
    chain.current = next.catch(() => false);
    return next.then((ok) => {
      // A failure retries by itself; edits made during the save follow it.
      if (!ok && !conflict.current) schedule(RETRY_DELAY_MS);
      else if (dirty.current && !conflict.current) schedule(SAVE_DELAY_MS);
      return ok && !dirty.current;
    });
  }, [saveOnce, schedule]);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  // Leaving the builder inside the app (the back arrow, the nav) unmounts it
  // without a `beforeunload`: an edit still waiting for its save goes now.
  useEffect(
    () => () => {
      if (dirty.current && !conflict.current) void flushRef.current();
    },
    []
  );

  const markDirty = useCallback(() => {
    dirty.current = true;
    if (conflict.current) return;
    setSaveState((state) => (state === "saving" ? state : "pending"));
    schedule(SAVE_DELAY_MS);
  }, [schedule]);

  const saveStateRef = useRef(saveState);
  useEffect(() => {
    saveStateRef.current = saveState;
  }, [saveState]);

  // Leaving with edits not yet saved: the browser asks first. Hiding the tab saves at once.
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty.current || saveStateRef.current === "saving") event.preventDefault();
    };
    const onHide = () => {
      if (document.visibilityState === "hidden" && dirty.current) void flush();
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("visibilitychange", onHide);
      window.clearTimeout(timer.current);
    };
  }, [flush]);

  /* ── Editing and history ───────────────────────────────────────────── */

  const commit = useCallback(
    (update: (current: LookbookDesign) => LookbookDesign, key?: string) => {
      const before = designRef.current;
      const next = update(before);
      if (next === before) return;
      const now = Date.now();
      const last = coalesce.current;
      const merge = Boolean(key) && last !== null && last.key === key && now - last.at < COALESCE_MS;
      if (!merge) {
        past.current.push(before);
        if (past.current.length > HISTORY_LIMIT) past.current.shift();
      }
      coalesce.current = key ? { key, at: now } : null;
      future.current = [];
      designRef.current = next;
      setDesign(next);
      setDepth({ past: past.current.length, future: 0 });
      markDirty();
    },
    [markDirty]
  );

  const restore = useCallback(
    (next: LookbookDesign) => {
      coalesce.current = null;
      designRef.current = next;
      setDesign(next);
      setDepth({ past: past.current.length, future: future.current.length });
      markDirty();
    },
    [markDirty]
  );

  const undo = useCallback(() => {
    const previous = past.current.pop();
    if (!previous) return;
    future.current.push(designRef.current);
    restore(previous);
  }, [restore]);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(designRef.current);
    restore(next);
  }, [restore]);

  const setTitle = useCallback(
    (value: string) => {
      titleRef.current = value;
      setTitleState(value);
      markDirty();
    },
    [markDirty]
  );

  /* ── Publishing and the link ───────────────────────────────────────── */

  const applyLookbook = useCallback((lookbook: Lookbook) => {
    setSummary(summaryOf(lookbook));
  }, []);

  const publish = useCallback(async () => {
    if (!(await flush())) return { ok: false, message: "Save the latest changes first. Check your connection and try again." };
    const result = await publishLookbook(id);
    if (result.status !== "success" || !result.lookbook) return { ok: false, message: result.message || "Couldn't publish. Try again." };
    applyLookbook(result.lookbook);
    if (result.lookbook.slug) void refreshPublicLookbooks([result.lookbook.slug]).catch(() => {});
    return { ok: true };
  }, [applyLookbook, flush, id]);

  const unpublish = useCallback(async () => {
    const result = await unpublishLookbook(id);
    if (result.status !== "success" || !result.lookbook) return { ok: false, message: result.message || "Couldn't unpublish. Try again." };
    applyLookbook(result.lookbook);
    if (result.lookbook.slug) void refreshPublicLookbooks([result.lookbook.slug, ...result.lookbook.previousSlugs]).catch(() => {});
    return { ok: true };
  }, [applyLookbook, id]);

  const renameSlug = useCallback(
    async (slug: string) => {
      const result = await renameLookbookSlug(id, slug);
      if (result.status !== "success" || !result.lookbook) {
        return { ok: false, message: result.message || "Couldn't change the link. Try again.", suggestion: result.suggestion };
      }
      applyLookbook(result.lookbook);
      if (result.changedSlugs?.length) void refreshPublicLookbooks(result.changedSlugs).catch(() => {});
      return { ok: true };
    },
    [applyLookbook, id]
  );

  /** After a refused save: keep this copy (it overwrites the other) or load the other. */
  const resolveConflict = useCallback(
    (keep: "mine" | "theirs") => {
      if (keep === "theirs") {
        dirty.current = false;
        window.location.reload();
        return;
      }
      if (conflict.current) revision.current = conflict.current.revision;
      conflict.current = null;
      dirty.current = true;
      void flush();
    },
    [flush]
  );

  return {
    id,
    design,
    title,
    summary,
    saveState,
    canUndo: depth.past > 0,
    canRedo: depth.future > 0,
    commit,
    undo,
    redo,
    setTitle,
    flush,
    publish,
    unpublish,
    renameSlug,
    resolveConflict,
  };
}

export type LookbookEditor = ReturnType<typeof useLookbookEditor>;
