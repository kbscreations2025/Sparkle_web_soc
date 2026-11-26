"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Copy, ExternalLink, Globe, MessageCircle, MoreHorizontal, Pencil, Plus, Sparkles, Trash2, Undo2 } from "lucide-react";
import { BLANK_START, CreateLookbookDialog, type LookbookStart } from "@/components/lookbook/CreateLookbookDialog";
import { ConfirmDialog } from "@/components/studio/ConfirmDialog";
import { ToolAccessNotice } from "@/components/studio/ToolAccessNotice";
import { deleteLookbook, duplicateLookbook, listLookbooks, publishLookbook, unpublishLookbook, type LookbookSummary } from "@/lib/api";
import { whatsappShareHref } from "@/lib/lookbook/media";
import { useAuth } from "@/lib/auth-context";
import { LOOKBOOK_PERMISSION } from "@/lib/lookbook/access";
import { publicUrl } from "@/lib/lookbook/slug";
import { can } from "@/lib/permissions";
import { useDismissable } from "@/lib/useEscapeKey";
import { cn } from "@/lib/utils";
import { refreshPublicLookbooks } from "./actions";

/**
 * Live Lookbook's home: start a new lookbook, or reopen one.
 */
export default function LiveLookbookPage() {
  const { user } = useAuth();
  const allowed = can(user, LOOKBOOK_PERMISSION);
  const [lookbooks, setLookbooks] = useState<LookbookSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState<LookbookStart | null>(null);

  useEffect(() => {
    if (!allowed) return;
    let live = true;
    listLookbooks().then((result) => {
      if (!live) return;
      if (result.status === "success" && result.lookbooks) setLookbooks(result.lookbooks);
      else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [allowed]);

  if (!allowed) return <ToolAccessNotice tool="Live Lookbook" />;

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="space-y-1.5">
          <h1 className="font-display text-2xl text-cream md:text-3xl">Live Lookbook</h1>
          <p className="max-w-2xl text-[13px] leading-relaxed text-muted">
            Build an interactive page for your collection by stacking cards, then share it as a link. Clients open it on their phone, no sign-in, and can zoom into every photo at full resolution.
          </p>
        </header>

        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Your lookbooks</h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {/* First: a clean slate to design from, nothing to undo. */}
            <li>
              <button
                type="button"
                onClick={() => setCreating(BLANK_START)}
                className="group flex h-full min-h-[11rem] w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-gold/45 bg-surface-raised px-5 text-center transition-all hover:-translate-y-0.5 hover:border-gold/70 hover:shadow-[0_12px_40px_-18px_rgba(0,0,0,0.35)]"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-full border border-gold/40 bg-gold/10 text-gold transition-transform group-hover:scale-105">
                  <Plus size={22} strokeWidth={1.6} />
                </span>
                <span className="text-[14px] font-semibold text-cream">New lookbook</span>
                <span className="max-w-[16rem] text-[11.5px] leading-relaxed text-faint">Start fresh with a clean page, and add the cards you want, your way.</span>
              </button>
            </li>
            {lookbooks?.map((lookbook) => (
              <LookbookTile
                key={lookbook.id}
                lookbook={lookbook}
                onDuplicated={(copy) => setLookbooks((list) => (list ? [copy, ...list] : [copy]))}
                onDeleted={() => setLookbooks((list) => list?.filter((entry) => entry.id !== lookbook.id) ?? null)}
                onChanged={(next) => setLookbooks((list) => list?.map((entry) => (entry.id === next.id ? { ...entry, ...next } : entry)) ?? null)}
              />
            ))}
          </ul>
          {failed && <p className="text-[13px] text-red-400">Couldn&apos;t load your lookbooks. Refresh to try again.</p>}
        </section>
      </div>

      {creating && <CreateLookbookDialog start={creating} onClose={() => setCreating(null)} />}
    </div>
  );
}

function LookbookTile({
  lookbook,
  onDuplicated,
  onDeleted,
  onChanged,
}: {
  lookbook: LookbookSummary;
  onDuplicated: (copy: LookbookSummary) => void;
  onDeleted: () => void;
  /** The lookbook after a publish or unpublish, to show in its place. */
  onChanged: (next: LookbookSummary) => void;
}) {
  const [menu, setMenu] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [working, setWorking] = useState<"publish" | "unpublish" | null>(null);
  const [problem, setProblem] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setMenu(false), []);
  useDismissable(menuRef, menu, closeMenu);

  const live = lookbook.status === "published";
  const url = lookbook.slug ? publicUrl(lookbook.slug) : "";
  const updated = new Date(lookbook.updatedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* the link is shown in the builder to copy by hand */
    }
    setMenu(false);
  }

  /** Publish, update or unpublish, right from the list. The public page's cache is cleared at once. */
  async function setLive(publish: boolean) {
    setMenu(false);
    setProblem("");
    setWorking(publish ? "publish" : "unpublish");
    const result = publish ? await publishLookbook(lookbook.id) : await unpublishLookbook(lookbook.id);
    setWorking(null);
    if (result.status !== "success" || !result.lookbook) {
      setProblem(result.message || (publish ? "Couldn't publish. Try again." : "Couldn't unpublish. Try again."));
      return;
    }
    const slugs = [result.lookbook.slug, ...result.lookbook.previousSlugs].filter((slug): slug is string => Boolean(slug));
    if (slugs.length) void refreshPublicLookbooks(slugs).catch(() => {});
    onChanged(result.lookbook);
  }

  async function duplicate() {
    setMenu(false);
    const result = await duplicateLookbook(lookbook.id);
    if (result.status === "success" && result.lookbook) onDuplicated(result.lookbook);
  }

  async function remove() {
    setBusy(true);
    const result = await deleteLookbook(lookbook.id);
    setBusy(false);
    setConfirming(false);
    if (result.status === "success") {
      if (result.changedSlugs?.length) void refreshPublicLookbooks(result.changedSlugs).catch(() => {});
      onDeleted();
    }
  }

  return (
    <li className="group relative overflow-hidden rounded-xl border border-white/[0.08] bg-surface-raised transition-colors hover:border-gold/30">
      <Link href={`/live-lookbook/${lookbook.id}`} className="block">
        <div className="relative aspect-[16/10] overflow-hidden bg-gradient-to-br from-black/[0.04] to-black/[0.09]">
          {lookbook.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- the cover's own thumbnail
            <img src={lookbook.coverUrl} alt="" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
          ) : (
            <div className="flex h-full items-center justify-center text-faint">
              <Sparkles size={22} />
            </div>
          )}
          <span
            className={cn(
              "absolute left-2.5 top-2.5 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold backdrop-blur",
              live ? "bg-emerald-500/85 text-white" : "bg-black/55 text-white/90"
            )}
          >
            {live ? <Globe size={10} /> : <Pencil size={10} />}
            {working ? (working === "publish" ? "Publishing…" : "Unpublishing…") : live ? (lookbook.hasUnpublishedChanges ? "Live · edits pending" : "Live") : "Draft"}
          </span>
        </div>
        <div className="space-y-0.5 px-3.5 py-3">
          <p className="truncate text-[13px] font-semibold text-cream">{lookbook.title}</p>
          <p className="truncate text-[11.5px] text-faint">
            {lookbook.slug ? `/l/${lookbook.slug}` : "No link yet"} · {updated}
          </p>
          {problem && <p className="text-[11px] text-red-400">{problem}</p>}
        </div>
      </Link>
      <div ref={menuRef} className="absolute right-2 top-2">
        <button
          type="button"
          aria-label="More"
          onClick={() => setMenu((value) => !value)}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur transition-opacity hover:bg-black/70"
        >
          {copied ? <Check size={14} /> : <MoreHorizontal size={14} />}
        </button>
        {menu && (
          <div className="absolute right-0 top-full z-20 mt-1 w-48 overflow-hidden rounded-lg border border-white/[0.1] bg-surface-raised py-1 shadow-xl">
            <MenuItem icon={<Pencil size={13} />} label="Edit" href={`/live-lookbook/${lookbook.id}`} />
            <MenuRule />
            {!live && <MenuItem icon={<Globe size={13} />} label="Publish" onClick={() => void setLive(true)} />}
            {live && lookbook.hasUnpublishedChanges && <MenuItem icon={<Globe size={13} />} label="Update live page" onClick={() => void setLive(true)} />}
            {live && <MenuItem icon={<Undo2 size={13} />} label="Unpublish" onClick={() => void setLive(false)} />}
            {live && lookbook.slug && (
              <>
                <MenuItem icon={<Copy size={13} />} label="Copy link" onClick={copy} />
                <MenuItem icon={<ExternalLink size={13} />} label="Open page" href={url} external />
                <MenuItem icon={<MessageCircle size={13} />} label="Share on WhatsApp" href={whatsappShareHref(`${lookbook.title}
${url}`)} external />
              </>
            )}
            <MenuRule />
            <MenuItem icon={<Plus size={13} />} label="Duplicate" onClick={duplicate} />
            <MenuItem
              icon={<Trash2 size={13} />}
              label="Delete"
              danger
              onClick={() => {
                setMenu(false);
                setConfirming(true);
              }}
            />
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirming}
        title="Delete this lookbook?"
        message={
          <>
            <strong>{lookbook.title}</strong> will be deleted{live ? " and its link will stop working" : ""}. This can&apos;t be undone.
          </>
        }
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setConfirming(false)}
      />
    </li>
  );
}

function MenuRule() {
  return <div className="my-1 h-px bg-white/[0.08]" />;
}

function MenuItem({ icon, label, onClick, href, external, danger }: { icon: React.ReactNode; label: string; onClick?: () => void; href?: string; external?: boolean; danger?: boolean }) {
  const className = cn(
    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] transition-colors hover:bg-white/[0.05]",
    danger ? "text-red-400" : "text-cream"
  );
  if (href) {
    return external ? (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
        {icon} {label}
      </a>
    ) : (
      <Link href={href} className={className}>
        {icon} {label}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className}>
      {icon} {label}
    </button>
  );
}
