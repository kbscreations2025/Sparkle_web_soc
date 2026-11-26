"use client";

import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Globe, Link2, Loader2, MessageCircle, RotateCcw, Undo2, X } from "lucide-react";
import { checkLookbookSlug } from "@/lib/api";
import { whatsappShareHref } from "@/lib/lookbook/media";
import { publicUrl, slugify } from "@/lib/lookbook/slug";
import type { LookbookMeta } from "@/lib/lookbook/types";
import type { EditorSummary } from "@/lib/lookbook/useLookbookEditor";
import { cn } from "@/lib/utils";
import { Field, TextArea, TextInput } from "./controls";

type SharePanelProps = {
  lookbookId: string;
  summary: EditorSummary;
  title: string;
  meta: LookbookMeta;
  setMeta: (patch: Partial<LookbookMeta>) => void;
  shareImage: string | null;
  renameSlug: (slug: string) => Promise<{ ok: boolean; message?: string; suggestion?: string }>;
  publish: () => Promise<{ ok: boolean; message?: string }>;
  unpublish: () => Promise<{ ok: boolean; message?: string }>;
  busy: "publish" | "unpublish" | null;
};

type SlugCheck = { state: "idle" | "checking" | "free" | "taken" | "short" | "error"; slug: string; suggestion?: string };

/**
 * The link and everything about sharing it: its name, whether it's live,
 * copying it, sending it on WhatsApp, and how its preview reads in a chat.
 */
export function SharePanel({ lookbookId, summary, title, meta, setMeta, shareImage, renameSlug, publish, unpublish, busy }: SharePanelProps) {
  const [draft, setDraft] = useState(summary.slug ?? "");
  const [check, setCheck] = useState<SlugCheck>({ state: "idle", slug: summary.slug ?? "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");

  // The server knows the origin only from the request; the browser knows it outright.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from the browser after mount
    setOrigin(window.location.origin);
  }, []);

  // A name saved elsewhere (or taken back by an undo) shows here.
  const [savedSlug, setSavedSlug] = useState(summary.slug);
  if (summary.slug !== savedSlug) {
    setSavedSlug(summary.slug);
    setDraft(summary.slug ?? "");
  }

  const wanted = slugify(draft);
  const changed = wanted !== (summary.slug ?? "");

  // Asks the server whether the name is free, a moment after typing stops.
  useEffect(() => {
    if (!changed) return;
    if (wanted.length < 3) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- a local verdict, no request needed
      setCheck({ state: "short", slug: wanted });
      return;
    }
    const controller = new AbortController();
    setCheck({ state: "checking", slug: wanted });
    const timer = window.setTimeout(async () => {
      const result = await checkLookbookSlug(wanted, lookbookId, controller.signal);
      if (controller.signal.aborted) return;
      if (result.status !== "success") setCheck({ state: "error", slug: wanted });
      else if (result.free) setCheck({ state: "free", slug: result.slug });
      else setCheck({ state: result.reason === "too_short" ? "short" : "taken", slug: result.slug, suggestion: result.suggestion });
    }, 350);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [wanted, changed, lookbookId]);

  async function saveName(name = wanted) {
    setSaving(true);
    setError("");
    const result = await renameSlug(name);
    setSaving(false);
    if (!result.ok) {
      setError(result.message || "Couldn't change the link.");
      if (result.suggestion) setCheck({ state: "taken", slug: name, suggestion: result.suggestion });
    }
  }

  const live = summary.status === "published";
  const url = summary.slug ? publicUrl(summary.slug, origin) : "";
  const shareText = `${meta.title || title}\n${url}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Couldn't copy. Select the link and copy it by hand.");
    }
  }

  async function act(action: () => Promise<{ ok: boolean; message?: string }>) {
    setError("");
    const result = await action();
    if (!result.ok) setError(result.message || "Something went wrong.");
  }

  return (
    <div className="space-y-5 p-4">
      {/* Status and the big buttons */}
      <div className="space-y-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3.5">
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 rounded-full", live ? (summary.hasUnpublishedChanges ? "bg-amber-400" : "bg-emerald-400") : "bg-white/25")} />
          <p className="text-[13px] font-semibold text-cream">
            {live ? (summary.hasUnpublishedChanges ? "Live · changes not published yet" : "Live") : "Draft · only you can see it"}
          </p>
        </div>
        <p className="text-[11.5px] leading-relaxed text-faint">
          {live
            ? summary.hasUnpublishedChanges
              ? "Clients still see the last published version. Update the page to show your latest edits."
              : "Anyone with the link can open the page. No sign-in needed."
            : "Publish to make the link work. Until then it shows “page not available”."}
        </p>
        <div className="flex flex-wrap gap-2">
          {(!live || summary.hasUnpublishedChanges) && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => act(publish)}
              className="flex h-9 items-center gap-1.5 rounded-lg bg-gold px-3.5 text-[12.5px] font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy === "publish" ? <Loader2 size={14} className="animate-spin" /> : <Globe size={14} />}
              {live ? "Update page" : "Publish"}
            </button>
          )}
          {live && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => act(unpublish)}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-white/[0.1] px-3 text-[12px] font-medium text-muted transition-colors hover:text-cream disabled:opacity-50"
            >
              {busy === "unpublish" ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} />}
              Unpublish
            </button>
          )}
        </div>
      </div>

      {/* The link's name */}
      <Field label="Link name" hint="Lower case, with hyphens for spaces. You can change it later; once published, the old link keeps working.">
        <div className="flex h-9 items-center overflow-hidden rounded-md border border-white/[0.08] bg-white/[0.03] focus-within:border-gold/40">
          <span className="shrink-0 select-none pl-2.5 text-[12px] text-faint">/l/</span>
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && changed && check.state === "free") void saveName();
            }}
            spellCheck={false}
            aria-label="Link name"
            className="h-full min-w-0 flex-1 bg-transparent px-1 text-[13px] text-cream outline-none"
          />
          {changed && (
            <button type="button" title="Undo" onClick={() => setDraft(summary.slug ?? "")} className="px-2 text-faint hover:text-cream">
              <RotateCcw size={12} />
            </button>
          )}
        </div>
        {changed && (
          <div className="mt-2 space-y-2">
            {wanted !== draft.trim() && wanted && <p className="text-[11px] text-faint">Will be: /l/{wanted}</p>}
            <SlugVerdict check={check} onUse={(suggestion) => setDraft(suggestion)} />
            <button
              type="button"
              disabled={check.state !== "free" || saving}
              onClick={() => void saveName()}
              className="flex h-8 items-center gap-1.5 rounded-md bg-gold/15 px-3 text-[12px] font-semibold text-gold transition-colors hover:bg-gold/25 disabled:opacity-40"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              Save link name
            </button>
          </div>
        )}
        {summary.previousSlugs.length > 0 && (
          <p className="mt-2 text-[11px] leading-snug text-faint">
            Still redirecting here: {summary.previousSlugs.slice(0, 4).map((slug) => `/l/${slug}`).join(", ")}
          </p>
        )}
      </Field>

      {/* Sharing */}
      {summary.slug && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 rounded-md border border-white/[0.08] bg-white/[0.02] px-2.5 py-2">
            <Link2 size={13} className="shrink-0 text-faint" />
            <span className="min-w-0 flex-1 truncate text-[12px] text-cream">{url}</span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <button type="button" onClick={copy} className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-white/[0.08] text-[12px] font-medium text-cream hover:border-gold/30">
              {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
              {copied ? "Copied" : "Copy"}
            </button>
            <a
              href={whatsappShareHref(shareText)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-9 items-center justify-center gap-1.5 rounded-lg bg-[#25D366] text-[12px] font-semibold text-[#06230F] hover:opacity-90"
            >
              <MessageCircle size={13} /> WhatsApp
            </a>
            <a href={url} target="_blank" rel="noopener noreferrer" className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-white/[0.08] text-[12px] font-medium text-cream hover:border-gold/30">
              <ExternalLink size={13} /> Open
            </a>
          </div>
          {!live && <p className="text-[11px] text-amber-500/90">Not published yet: the link shows “page not available” until you publish.</p>}
        </div>
      )}

      {/* How it looks in a chat */}
      <div className="space-y-3 border-t border-white/[0.06] pt-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Link preview</p>
        <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#E7FFDB] text-[#111B21]">
          {shareImage && (
            // eslint-disable-next-line @next/next/no-img-element -- preview of the preview
            <img src={shareImage} alt="" className="aspect-[1.91] w-full object-contain" style={{ background: "#0d0d0d" }} />
          )}
          <div className="space-y-0.5 px-3 py-2">
            <p className="line-clamp-1 text-[13px] font-semibold">{meta.title || title}</p>
            {meta.description && <p className="line-clamp-2 text-[12px] text-[#54656F]">{meta.description}</p>}
            <p className="text-[11px] text-[#667781]">{origin.replace(/^https?:\/\//, "")}</p>
          </div>
        </div>
        <Field label="Title in the preview" hint="Empty uses the lookbook's name.">
          <TextInput value={meta.title} onChange={(value) => setMeta({ title: value })} placeholder={title} />
        </Field>
        <Field label="Description">
          <TextArea value={meta.description} onChange={(value) => setMeta({ description: value })} placeholder="A line about the collection" rows={2} />
        </Field>
        <p className="text-[11px] leading-snug text-faint">The preview uses the page&apos;s first photo, shown whole. Publish again after changing these.</p>
      </div>

      {error && (
        <p className="flex items-start gap-1.5 text-[12px] text-red-400">
          <X size={13} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}
    </div>
  );
}

function SlugVerdict({ check, onUse }: { check: SlugCheck; onUse: (slug: string) => void }) {
  switch (check.state) {
    case "checking":
      return (
        <p className="flex items-center gap-1.5 text-[11.5px] text-faint">
          <Loader2 size={12} className="animate-spin" /> Checking…
        </p>
      );
    case "free":
      return (
        <p className="flex items-center gap-1.5 text-[11.5px] text-emerald-500">
          <Check size={12} /> /l/{check.slug} is free
        </p>
      );
    case "taken":
      return (
        <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-red-400">
          <X size={12} /> Taken.
          {check.suggestion && (
            <button type="button" onClick={() => onUse(check.suggestion!)} className="rounded-full border border-gold/40 px-2 py-0.5 font-medium text-gold hover:bg-gold/10">
              Use {check.suggestion}
            </button>
          )}
        </div>
      );
    case "short":
      return <p className="text-[11.5px] text-faint">Use at least 3 letters or numbers.</p>;
    case "error":
      return <p className="text-[11.5px] text-red-400">Couldn&apos;t check that name. Try again.</p>;
    default:
      return null;
  }
}
