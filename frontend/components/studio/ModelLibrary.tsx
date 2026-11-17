"use client";

import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { ArrowRight, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Droplet, Droplets, Globe, Layers, Loader2, Lock, type LucideIcon, Maximize2, MoreVertical, NotebookPen, Palette, Pencil, PersonStanding, RotateCcw, Ruler, Scissors, Shirt, Sparkles, Trash2, Upload, UserRound, Wand2, Waves, X } from "lucide-react";
import { Lightbox } from "./Lightbox";
import { ConfirmDialog } from "./ToolChrome";
import { useAuth } from "@/lib/auth-context";
import { doubleTap } from "@/lib/doubleTap";
import type { LifestyleModel } from "@/lib/api";
import { MODEL_ATTRS, outfitsFor } from "@/lib/lifestyleOptions";
import type { ModelLibraryState } from "@/lib/useModelLibrary";
import { useEscapeKey } from "@/lib/useEscapeKey";
import { cn } from "@/lib/utils";

/**
 * Tiles in two rows of the grid at each width — it is 3 across on a phone,
 * 5 from `sm` and 6 from `lg` (see the <ul> below), so the count must follow.
 */
const TWO_ROWS = { base: 6, sm: 10, lg: 12 };

/**
 * The classes that fold a tile away when it falls past the second row — per
 * breakpoint, since which tiles that is depends on how many fit across.
 * Spelled out in full so Tailwind sees every class it needs.
 */
function beyondTwoRows(position: number) {
  if (position < TWO_ROWS.base) return undefined;
  if (position < TWO_ROWS.sm) return "hidden sm:block";
  if (position < TWO_ROWS.lg) return "hidden lg:block";
  return "hidden";
}

/** "See all" only at the widths where tiles are actually folded away. */
function seeAllVisibility(tileCount: number) {
  if (tileCount > TWO_ROWS.lg) return undefined;
  if (tileCount > TWO_ROWS.sm) return "lg:hidden";
  if (tileCount > TWO_ROWS.base) return "sm:hidden";
  return "hidden";
}

/**
 * The model picker: this organization's saved models (the old built-in
 * Model 4 and 5 are shared library models now), and the two ways to add one —
 * upload a photo, or describe a person and have one generated.
 *
 * Shared by Lifestyle and Campaign Kit. The state lives in
 * `useModelLibrary`; this is only how it looks.
 */
export function ModelLibrary({ library }: { library: ModelLibraryState }) {
  const { user } = useAuth();
  const [building, setBuilding] = useState(false);
  /** The saved model open in the viewer, and the one being renamed in place. */
  const [preview, setPreview] = useState<string | null>(null);
  /** The saved model being previewed, for its details panel — none for a preset. */
  const [previewModel, setPreviewModel] = useState<LifestyleModel | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  /** A pending share/unshare, held until it is confirmed. */
  const [confirming, setConfirming] = useState<{ id: string; name: string; share: boolean } | null>(null);
  /** A pending delete, held until it is confirmed — one stray click used to remove a model from everyone's picker. */
  const [deleting, setDeleting] = useState<{ id: string; name: string; owner: string | null } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  /**
   * Shown before the file picker: a model photo with jewellery already on
   * her carries it into every shot, and a photo of a piece itself isn't a
   * model at all — both were being uploaded here.
   */
  const [uploadNotice, setUploadNotice] = useState(false);

  const { choice, setChoice, models, generating, pendingJob, loaded } = library;

  /*
   * Two rows until asked for more: the library grows with every model anyone
   * builds, and a page that opens on four rows of faces pushes the jewellery
   * and the placement out of sight.
   */
  const [showAll, setShowAll] = useState(false);
  // The add tile, the one being built, then the saved models.
  const tileCount = 1 + (generating ? 1 : 0) + models.length;
  const firstModelPosition = 1 + (generating ? 1 : 0);
  /** Whether a tile at `position` (0-based, in grid order) is folded away right now. */
  const foldClass = (position: number, active: boolean) => (showAll || active ? undefined : beyondTwoRows(position));

  /*
   * Sharing a photograph of a person with everyone in the organization — and
   * removing one from the library — are decisions rather than conveniences.
   * The API allows both only to an organization's admin (or the platform
   * super admin), and the buttons follow that rather than offering what
   * would be refused.
   */
  const isAdmin = Boolean(user?.isSuperAdmin || user?.role === "admin");

  return (
    <div className="space-y-3">
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) library.upload(file);
          event.target.value = "";
        }}
      />

      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-6">
        {/* The two ways to add a model, as the first tile rather than a row
            of buttons underneath: adding one is a choice alongside the
            models themselves, and reads that way at the head of the grid. */}
        <li className="flex aspect-[3/4] flex-col gap-1 rounded-lg border border-dashed border-white/[0.14] bg-white/[0.02] p-1.5">
          <AddModelAction icon={Upload} label="Upload a photo" onClick={() => setUploadNotice(true)} />
          <AddModelAction
            icon={Wand2}
            label={building ? "Close" : "Build a model"}
            expanded={building}
            onClick={() => setBuilding((open) => !open)}
          />
        </li>

        {/* A model being built holds its place at the head of the grid, so
            the wait is visible where the result will appear — the run is on
            the queue, so this survives nothing but a page leave. */}
        {generating && <PendingModelTile percent={pendingJob?.progress ?? 0} />}

        {models.map((model, index) => (
          <ModelTile
            key={model.id}
            // The picked model stays in view even past the second row.
            className={foldClass(firstModelPosition + index, choice?.kind === "saved" && choice.id === model.id)}
            src={model.thumbnailUrl}
            label={model.name}
            owner={model.isOwn ? undefined : model.userName}
            shared={model.isPublic}
            active={choice?.kind === "saved" && choice.id === model.id}
            onSelect={() => setChoice({ kind: "saved", id: model.id, src: model.thumbnailUrl })}
            onPreview={() => {
              setPreviewModel(model);
              setPreview(model.imageUrl || model.thumbnailUrl);
            }}
            renaming={renaming === model.id}
            onRename={model.isOwn ? () => setRenaming(model.id) : undefined}
            onRenamed={(name) => {
              setRenaming(null);
              if (name && name !== model.name) library.rename(model.id, name);
            }}
            onShare={
              isAdmin
                ? () => setConfirming({ id: model.id, name: model.name, share: !model.isPublic })
                : undefined
            }
            onDelete={isAdmin ? () => setDeleting({ id: model.id, name: model.name, owner: model.isOwn ? null : model.userName }) : undefined}
          />
        ))}

        {/* Nothing to pick yet — a new organization, or every model deleted. */}
        {loaded && models.length === 0 && !generating && choice?.kind !== "upload" && (
          <li className="col-span-2 flex aspect-[3/2] items-center rounded-lg border border-white/[0.08] bg-white/[0.02] p-3 sm:col-span-3">
            <p className="text-[11px] leading-relaxed text-faint">
              No models yet. Upload a photo of a person or build one — it&apos;s saved here for every shot after.
            </p>
          </li>
        )}

        {choice?.kind === "upload" && (
          <ModelTile src={choice.src} label={library.saving ? "Saving…" : "Just uploaded"} active onSelect={() => undefined} />
        )}
      </ul>

      {/* Shown only at the widths where something is actually folded away. */}
      {(showAll ? tileCount > TWO_ROWS.base : true) && (
        <button
          type="button"
          onClick={() => setShowAll((open) => !open)}
          className={cn(
            "mx-auto flex items-center gap-1 rounded-full border border-white/10 px-3 py-1 text-[11px] font-medium text-muted transition-colors hover:border-gold/30 hover:text-gold",
            !showAll && seeAllVisibility(tileCount)
          )}
        >
          {showAll ? (
            <>
              Show less <ChevronUp size={12} />
            </>
          ) : (
            <>
              See all {tileCount - 1} models <ChevronDown size={12} />
            </>
          )}
        </button>
      )}

      {building && (
        // Queued is done as far as this drawer goes: the tile in the grid is
        // where the wait is watched from, and it is behind the drawer.
        <ModelBuilder library={library} busy={generating} onClose={() => setBuilding(false)} />
      )}

      {/* The grid's tiles are ~100px wide; this is how you actually look at
          a model before placing jewellery on her. */}
      <Lightbox
        src={preview}
        onClose={() => {
          setPreview(null);
          setPreviewModel(null);
        }}
        downloadName="model.jpg"
        info={previewModel ? <ModelDetails model={previewModel} /> : undefined}
      />

      {/* Who can see a photograph of a person is worth one deliberate click
          — in either direction: sharing exposes her to the whole
          organization, and unsharing pulls her out of everyone else's
          picker, including runs they were about to make. */}
      {uploadNotice && (
        <ConfirmDialog
          title="Upload a plain model photo"
          body="Use a photo of the person only, with no jewellery on: no earrings, necklace, rings, bracelets or watch. Any jewellery already in the photo can end up in the final image next to your piece. Don't upload a photo of the jewellery itself here; add that under The jewellery."
          confirmLabel="Choose photo"
          onCancel={() => setUploadNotice(false)}
          onConfirm={() => {
            setUploadNotice(false);
            fileInput.current?.click();
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete this model?"
          body={`${deleting.name}${deleting.owner ? ` (${deleting.owner}'s model)` : ""} will be removed from the model library and from everyone's picker. Past results that used it keep showing it.`}
          confirmLabel="Yes, delete"
          danger
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            library.remove(deleting.id);
            setDeleting(null);
          }}
        />
      )}

      {confirming && (
        <ConfirmDialog
          title={confirming.share ? "Share with the organization?" : "Stop sharing?"}
          body={
            confirming.share
              ? `Everyone in your organization will be able to pick ${confirming.name} for their own shots.`
              : `${confirming.name} will go back to being yours alone, and will disappear from everyone else's picker.`
          }
          confirmLabel={confirming.share ? "Share" : "Stop sharing"}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            library.setPublic(confirming.id, confirming.share);
            setConfirming(null);
          }}
        />
      )}
    </div>
  );
}

/** The essentials about a saved model, for the preview: its name, who added it, and when. */
function ModelDetails({ model }: { model: LifestyleModel }) {
  const created = new Date(model.createdAt);
  const date = Number.isNaN(created.getTime()) ? null : created.toLocaleDateString(undefined, { dateStyle: "medium" });
  const by = model.isOwn ? "you" : model.userName;

  // Laid out like the History viewer's header: the name as a chip, then when and by whom.
  return (
    <div className="flex flex-wrap items-center gap-2 md:gap-3">
      <span className="max-w-[60vw] truncate rounded-full border border-gold/30 bg-gold/10 px-2.5 py-1 text-[11px] font-semibold text-gold">
        {model.name}
      </span>
      <p className="whitespace-nowrap text-[11px] text-white/60">
        {date ? `${date} · ` : ""}by {by}
      </p>
    </div>
  );
}

/** The tile a model occupies while it is still being generated. */
function PendingModelTile({ percent }: { percent: number }) {
  return (
    <li className="relative flex aspect-[3/4] flex-col items-center justify-center gap-2 overflow-hidden rounded-lg border border-gold/30 bg-gold/[0.06]">
      <Loader2 size={16} className="animate-spin text-gold/80" />
      <span className="px-1 text-center text-[9px] font-medium leading-tight text-gold/80">Building…</span>
      <span className="absolute inset-x-0 bottom-0 h-0.5 bg-white/10">
        <span
          className="block h-full bg-gold transition-[width] duration-500"
          style={{ width: `${Math.max(4, Math.min(100, percent))}%` }}
        />
      </span>
    </li>
  );
}

/**
 * The rounded notch in the builder panel's top-right corner that the close
 * button sits in, with small fillets where it meets the top and right edges
 * so the curve flows into them instead of meeting at a point.
 *
 * Drawn on a 64×64 box at the corner, matching the close button: 32px
 * across, centred 15px in from the top and right edges (so it sits on the
 * corner, a pixel proud), a 6px gap all round (notch radius 22, fillets 6).
 * `NOTCH_EDGE` is just the curved part, stroked to carry the panel's border
 * round the notch.
 */
const NOTCH_EDGE = "M22.49 0A6 6 0 0 1 28.17 7.93A22 22 0 0 0 56.07 35.83A6 6 0 0 1 64 41.51";
const NOTCH_CORNER_SVG = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M0 0H22.49A6 6 0 0 1 28.17 7.93A22 22 0 0 0 56.07 35.83A6 6 0 0 1 64 41.51V64H0Z"/></svg>`
);
/** Three mask layers, unioned: the notched corner, plus two plain blocks covering the rest of the panel. */
const CORNER_NOTCH_MASK = (() => {
  const layers = [
    `url("data:image/svg+xml,${NOTCH_CORNER_SVG}") right top / 64px 64px no-repeat`,
    "linear-gradient(#000, #000) left top / calc(100% - 64px) 64px no-repeat",
    "linear-gradient(#000, #000) left 64px / 100% calc(100% - 64px) no-repeat",
  ].join(", ");
  return { mask: layers, WebkitMask: layers } as const;
})();

/**
 * The builder, as a dialog in the middle of the window.
 *
 * A full-width sheet stretched nine short attribute rows across the whole
 * screen, so the eye had to sweep a metre of chips to read one choice. A
 * column about as wide as a form reads top to bottom, in the order the
 * choices are made, and on a phone it is a sheet from the bottom as before.
 *
 * The title stays pinned at the top and the name and Build button at the
 * bottom, so the form scrolls between them and the one thing left to do is
 * always in view. Portalled to <body> so the page's own scroll containers
 * can't clip or scroll it.
 */
function ModelBuilderDrawer({
  onClose,
  footer,
  children,
}: {
  onClose: () => void;
  /** The name field and the Build button, pinned under the form. */
  footer: ReactNode;
  children: ReactNode;
}) {
  useEscapeKey(onClose);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Build a model"
        onClick={(event) => event.stopPropagation()}
        className="animate-drawer-up relative w-full sm:max-w-3xl sm:drop-shadow-[0_24px_48px_rgba(0,0,0,0.35)]"
      >
        {/* Sits half out of the corner, in the notch cut by `CORNER_NOTCH_MASK`
            — outside the panel so the mask and overflow don't clip it. */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the builder"
          // Panel colours, graded top to bottom, with a soft warm drop shadow
          // and a faint top highlight so it reads as a raised pebble of the
          // panel rather than a separate dark control.
          className="absolute -right-px -top-px z-20 flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.08] bg-gradient-to-b from-surface-raised to-surface text-muted shadow-[0_6px_14px_-4px_rgba(60,40,10,0.35),0_1px_3px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.18)] transition-[color,box-shadow,transform] hover:-translate-y-px hover:text-gold hover:shadow-[0_8px_18px_-4px_rgba(60,40,10,0.42),0_1px_3px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.18)]"
        >
          <X size={15} strokeWidth={1.75} />
        </button>
        <div
          style={CORNER_NOTCH_MASK}
          className="relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-white/[0.08] bg-surface sm:max-h-[90vh] sm:rounded-2xl"
        >
          {/* The panel's border, carried round the notch. Stroked 2px on the
              cut line so the mask leaves the inner 1px — the same weight and
              place as the CSS border it continues. */}
          <svg
            aria-hidden
            viewBox="0 0 64 64"
            className="pointer-events-none absolute -right-px -top-px z-30 h-16 w-16 text-cream/10"
          >
            <path d={NOTCH_EDGE} fill="none" stroke="currentColor" strokeWidth={2} />
          </svg>
          {/* Banner: serif title on the left, a model photo fading in on the right. */}
          <div className="relative flex shrink-0 items-stretch overflow-hidden border-b border-white/[0.06] bg-gradient-to-r from-gold/[0.10] via-gold/[0.04] to-transparent">
            {/* Small on phones; a step bigger from tablet width (md) up. */}
            <div className="relative z-10 min-w-0 flex-1 py-3 pl-4 pr-2 md:px-7 md:py-5">
              <h3 className="font-display text-lg font-semibold leading-tight text-cream md:text-[28px]">Build a Model</h3>
              <p className="mt-0.5 text-[11px] text-muted md:mt-1 md:text-[13px]">
                Pick what matters — anything left blank is chosen for you.
              </p>
            </div>
            <div
              aria-hidden
              className="relative w-20 shrink-0 [mask-image:linear-gradient(to_right,transparent,black_45%)] md:w-44"
            >
              <Image src="/raw_to_ai/model_1.png" alt="" fill sizes="(min-width: 768px) 176px, 80px" className="object-cover object-[50%_15%]" />
            </div>
          </div>

          <div className="thin-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">{children}</div>

          <div className="shrink-0 border-t border-white/[0.06] bg-surface-deep/60 px-3 py-2.5 sm:px-6 sm:py-3">{footer}</div>
        </div>
      </div>
    </div>,
    document.body
  );
}

/** One half of the add-a-model tile — stacked, so the two share one card. */
function AddModelAction({
  icon: Icon,
  label,
  expanded,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  expanded?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-expanded={expanded}
      className="flex flex-1 flex-col items-center justify-center gap-1 rounded-md border border-white/[0.07] bg-white/[0.03] px-1 text-[9px] font-medium leading-tight text-muted transition-colors hover:border-gold/30 hover:text-gold"
    >
      <Icon size={13} />
      <span className="text-center">{label}</span>
    </button>
  );
}

function ModelTile({
  className,
  src,
  label,
  owner,
  active,
  shared,
  renaming,
  onSelect,
  onPreview,
  onRename,
  onRenamed,
  onShare,
  onDelete,
}: {
  /** Extra classes for the tile's <li> — how the grid folds it past two rows. */
  className?: string;
  src: string;
  label: string;
  /** Whose model it is, shown when it isn't the viewer's own. */
  owner?: string;
  active: boolean;
  shared?: boolean;
  /** Whether the name is currently an input rather than a caption. */
  renaming?: boolean;
  onSelect: () => void;
  onPreview?: () => void;
  onRename?: () => void;
  /** The committed name, or "" when the edit was abandoned. */
  onRenamed?: (name: string) => void;
  /** Omitted for anyone who may not share — see `canShare`. */
  onShare?: () => void;
  onDelete?: () => void;
}) {
  return (
    <li className={cn("group relative", className)}>
      <button
        type="button"
        onClick={onSelect}
        // A tile is small, and looking closely at a model is a second thing
        // you do to the same picture — so it is the same target, twice.
        {...(onPreview ? doubleTap(src, onPreview) : {})}
        aria-pressed={active}
        title={onPreview ? `${label} — double-click or double-tap to enlarge` : label}
        className={cn(
          "relative block aspect-[3/4] w-full overflow-hidden rounded-lg border transition-colors",
          active ? "border-gold/50 ring-1 ring-gold/30" : "border-white/10 hover:border-white/25"
        )}
      >
        <Image src={src} alt={label} fill sizes="140px" className="object-cover" />
        {owner && (
          <span
            title={`${owner}'s model`}
            // Steps aside on hover, where the action pill takes the top edge.
            className="absolute left-1 top-1 max-w-[calc(100%-0.5rem)] truncate rounded-full bg-black/60 px-1.5 py-0.5 text-[8px] font-medium text-white/85 backdrop-blur-sm transition-opacity group-hover:opacity-0 [@media(hover:none)]:max-w-[calc(100%-2.25rem)] [@media(hover:none)]:opacity-100"
          >
            {owner}
          </span>
        )}
        {!renaming && (
          <span
            className={cn(
              "absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/75 to-transparent pb-1 pl-1.5 pt-4 text-left text-[10px] font-medium text-white/85",
              // Room for the corner pill when it is always on show (a shared
              // model), so a long name truncates before it rather than under it.
              shared ? "pr-8" : "pr-1.5"
            )}
          >
            {/* Kept for the gradient's height when the name is its own button below. */}
            <span className={onRename ? "invisible" : undefined}>{label}</span>
          </span>
        )}
      </button>

      {/* Whoever may rename clicks the name itself — no separate pencil.
          Outside the tile's button, since a button can't hold another. */}
      {!renaming && onRename && (
        <button
          type="button"
          onClick={onRename}
          title={`Rename ${label}`}
          aria-label={`Rename ${label}`}
          className={cn(
            "absolute bottom-1 left-1.5 max-w-[calc(100%-0.75rem)] cursor-text truncate rounded-sm text-left text-[10px] font-medium leading-[15px] text-white/85 decoration-white/40 underline-offset-2 hover:underline",
            shared && "max-w-[calc(100%-2.5rem)]"
          )}
        >
          {label}
        </button>
      )}

      {/* Bottom-right: whether the model is shared. The globe stays visible on
          a shared model, since it is the "shared" label; for an admin it is
          also the toggle, and an unshared model shows the lock on hover. */}
      {!renaming && (shared || onShare) && (
        <div
          className={cn(
            "absolute bottom-1 right-1 flex items-center gap-0.5 rounded-full border border-white/20 bg-black/60 p-0.5 backdrop-blur-sm transition-opacity",
            !shared && "opacity-0 focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:hidden"
          )}
        >
          {onShare ? (
            <TileAction
              icon={shared ? Globe : Lock}
              label={shared ? `Shared with the organization — stop sharing ${label}` : `Share ${label} with the organization`}
              active={shared}
              onClick={onShare}
            />
          ) : (
            shared && (
              <span title="Shared with the organization" aria-label="Shared with the organization" className="flex h-5 w-5 items-center justify-center text-gold">
                <Globe size={11} />
              </span>
            )
          )}
        </div>
      )}

      {/* Renaming happens where the name is, rather than in a dialog — it is
          one short field, and the picture is the context for it. */}
      {renaming && (
        <input
          autoFocus
          defaultValue={label}
          onClick={(event) => event.stopPropagation()}
          onBlur={(event) => onRenamed?.(event.target.value.trim())}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            // Escape abandons it: blurring after clearing would otherwise
            // read as "rename to nothing".
            if (event.key === "Escape") {
              event.currentTarget.value = label;
              event.currentTarget.blur();
            }
          }}
          className="absolute inset-x-1 bottom-1 rounded border border-gold/40 bg-black/80 px-1 py-0.5 text-[10px] text-white focus:outline-none"
        />
      )}

      {/* The actions, pooled in one pill on hover — three separate circles
          over a ~100px tile is more chrome than picture. */}
      {/* A touch screen has no hover, so the pill there is a ⋯ menu instead. */}
      {(onPreview || onDelete || onShare || onRename) && !renaming && (
        <TileMenu
          title={owner ? `${label} · ${owner}` : label}
          items={[
            onPreview && { icon: Maximize2, label: "Preview", onClick: onPreview },
            onRename && { icon: Pencil, label: "Rename", onClick: onRename },
            onShare && {
              icon: shared ? Lock : Globe,
              label: shared ? "Stop sharing" : "Share with organization",
              onClick: onShare,
            },
            onDelete && { icon: Trash2, label: "Delete", onClick: onDelete, danger: true },
          ]}
        />
      )}

      {(onPreview || onDelete) && (
        <div className="absolute right-1 top-1 flex items-center gap-0.5 rounded-full border border-white/20 bg-black/60 p-0.5 opacity-0 backdrop-blur-sm transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:hidden">
          {onPreview && <TileAction icon={Maximize2} label={`Preview ${label}`} onClick={onPreview} />}
          {onDelete && <TileAction icon={Trash2} label={`Delete ${label}`} onClick={onDelete} danger />}        </div>
      )}
    </li>
  );
}

type TileMenuItem = { icon: LucideIcon; label: string; onClick: () => void; danger?: boolean };

/** A tile's actions behind a ⋯ button — touch screens only, where hover can't reveal them. */
function TileMenu({ title, items }: { title: string; items: (TileMenuItem | undefined | false)[] }) {
  const [open, setOpen] = useState(false);
  const actions = items.filter(Boolean) as TileMenuItem[];

  return (
    <div className="absolute right-1 top-1 hidden [@media(hover:none)]:block">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Model options"
        aria-expanded={open}
        className="flex h-6 w-6 items-center justify-center rounded-full border border-white/20 bg-black/60 text-white/90 backdrop-blur-sm"
      >
        <MoreVertical size={13} />
      </button>
      {/* A sheet from the bottom rather than a dropdown: a dropdown off a
          ~100px tile runs off the screen edge, and a sheet is what a phone
          expects. Portalled so no tile's stacking can sit above it. */}
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-end bg-black/50" onClick={() => setOpen(false)}>
            <div
              className="animate-drawer-up w-full rounded-t-2xl border-t border-white/10 bg-surface-raised px-2 pb-6 pt-3"
              onClick={(event) => event.stopPropagation()}
            >
              <p className="truncate px-3 pb-2 text-xs font-semibold text-cream">{title}</p>
              {actions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    action.onClick();
                  }}
                  className={cn(
                    "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm",
                    action.danger ? "text-error" : "text-cream"
                  )}
                >
                  <action.icon size={16} /> {action.label}
                </button>
              ))}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

/** One icon button inside a tile's action pill. */
function TileAction({
  icon: Icon,
  label,
  active,
  danger,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        "flex h-5 w-5 items-center justify-center rounded-full transition-colors",
        danger ? "hover:bg-error/75" : "hover:bg-white/20",
        active ? "text-gold" : "text-white/85"
      )}
    >
      <Icon size={11} />
    </button>
  );
}

/**
 * A step slider for an attribute whose options are a single ordered scale —
 * Age and Height — rather than an unordered set. Reading "where along the
 * line" is faster than reading five same-styled chips and comparing their
 * wording, and it makes the single-pick constraint visible instead of just
 * enforced.
 *
 * Still single-pick underneath: `onChange` hands the clicked option to
 * `toggle`, which `SINGLE_PICK` already makes replace the whole selection
 * (and a second click on the picked step clears it, as before).
 */
const SLIDER_ATTRS = new Set(["age", "height"]);

/** Short tick captions for options whose real text is too long to sit under a dot or swatch. Keys not listed here show their option text as-is. */
const TICK_LABELS: Record<string, Record<string, string>> = {
  hairColor: {
    "Black (Level 1)": "Black",
    "Dark brown (Level 2–3)": "Dark brown",
    "Medium / light brown (Level 4–5)": "Medium brown",
    "Dark blonde (Level 6)": "Dark blonde",
    "Blonde (Level 7–8)": "Blonde",
    "Light blonde / platinum (Level 9–10)": "Platinum",
  },
  height: {
    "Petite (under 5'4\")": "Petite",
    "Average (5'4\"–5'7\")": "5'4\"–5'7\"",
    "Tall (5'8\"–5'11\")": "Tall",
    "Very tall (6'+)": "V. tall",
  },
};

function StepSlider({
  attrKey,
  options,
  value,
  onChange,
}: {
  attrKey: string;
  options: string[];
  value?: string;
  onChange: (option: string) => void;
}) {
  const labels = TICK_LABELS[attrKey];
  const activeIndex = value ? options.indexOf(value) : -1;
  const fillPct = activeIndex >= 0 ? (activeIndex / (options.length - 1)) * 100 : 0;

  return (
    <div className="pt-2">
      <div className="relative mx-2 h-1">
        <div aria-hidden className="absolute inset-0 rounded-full bg-white/10" />
        {activeIndex >= 0 && (
          <div
            aria-hidden
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-gold-dim to-gold"
            style={{ width: `${fillPct}%` }}
          />
        )}
        <div className="absolute inset-0 flex items-center justify-between">
          {options.map((option, index) => {
            const active = index === activeIndex;
            const passed = activeIndex >= 0 && index < activeIndex;
            return (
              <button
                key={option}
                type="button"
                onClick={() => onChange(option)}
                aria-pressed={active}
                aria-label={option}
                className={cn(
                  "relative -mx-2 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-all",
                  active
                    ? "scale-125 border-gold bg-gold shadow-[0_0_0_4px_rgba(196,168,106,0.18)]"
                    : passed
                      ? "border-gold bg-surface"
                      : "border-faint/60 bg-surface hover:border-gold/60"
                )}
              />
            );
          })}
        </div>
      </div>

      <div className="mt-3 flex justify-between gap-1">
        {options.map((option, index) => (
          <button
            key={option}
            type="button"
            tabIndex={-1}
            onClick={() => onChange(option)}
            className={cn(
              "flex-1 text-center text-[11px] leading-tight transition-colors",
              index === activeIndex ? "font-semibold text-cream" : "text-muted/80 hover:text-cream"
            )}
          >
            {labels?.[option] ?? option}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Colours for the swatch rows. Display only — the option text sent to the
 * backend is unchanged. Skin runs light to deep along the Monk scale.
 */
const SWATCH_COLORS: Record<string, Record<string, string>> = {
  skinTone: {
    "MST 1–2": "#F4E0CB",
    "MST 3–4": "#E2BF9C",
    "MST 5–6": "#C49470",
    "MST 7–8": "#966646",
    "MST 9–10": "#5A3A27",
  },
  hairColor: {
    "Black (Level 1)": "#1A1615",
    "Dark brown (Level 2–3)": "#3D2920",
    "Medium / light brown (Level 4–5)": "#6E4A33",
    "Dark blonde (Level 6)": "#A27C57",
    "Blonde (Level 7–8)": "#D9B97E",
    "Light blonde / platinum (Level 9–10)": "#EEE5D0",
  },
};

/** Round colour swatches, single-pick, with a check badge on the chosen one. */
function SwatchRow({
  attrKey,
  options,
  value,
  onChange,
}: {
  attrKey: string;
  options: string[];
  value?: string;
  onChange: (option: string) => void;
}) {
  const colors = SWATCH_COLORS[attrKey];
  const labels = TICK_LABELS[attrKey];
  return (
    <div className="grid gap-x-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((option) => {
        const active = option === value;
        const label = labels?.[option] ?? option;
        return (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            aria-pressed={active}
            aria-label={option}
            title={option}
            className="group flex min-w-0 flex-col items-center gap-1.5"
          >
            <span
              className={cn(
                "relative h-8 w-8 shrink-0 rounded-full md:h-10 md:w-10 border shadow-[inset_0_-3px_6px_rgba(0,0,0,0.18),0_1px_3px_rgba(0,0,0,0.25)] transition-all",
                active
                  ? "border-gold ring-2 ring-gold/70 ring-offset-2 ring-offset-surface"
                  : "border-black/10 group-hover:scale-105"
              )}
              style={{ backgroundColor: colors?.[option] }}
            >
              {active && (
                <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-surface bg-gold text-surface-deep">
                  <Check size={10} strokeWidth={3} />
                </span>
              )}
            </span>
            <span
              className={cn(
                "text-center text-[10px] leading-tight transition-colors",
                active ? "font-semibold text-cream" : "text-muted/80 group-hover:text-cream"
              )}
            >
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Line icons for the hair-style chips, drawn on the 20×20 grid lucide uses at size 20. */
const HAIR_ICON_PATHS: Record<string, string> = {
  "Long straight": "M5.5 9a4.5 4.5 0 0 1 9 0v8 M5.5 9v8",
  "Long wavy": "M5.5 8.5a4.5 4.5 0 0 1 9 0c0 2 1.4 3 .6 4.6-.8 1.6.8 2.6 0 4.4 M5.5 8.5c0 2-1.4 3-.6 4.6.8 1.6-.8 2.6 0 4.4",
  Curly:
    "M5.2 10a1.8 1.8 0 0 1 .3-3.4 1.8 1.8 0 0 1 2.4-2.4 1.8 1.8 0 0 1 4.2 0 1.8 1.8 0 0 1 2.4 2.4 1.8 1.8 0 0 1 .3 3.4",
  Short: "M5.7 9a4.3 4.3 0 0 1 8.6 0 M6 7.6c1.8.1 3.3-.6 4.3-2 .8 1.2 2 1.9 3.8 2",
  "Sleek bun": "M5.8 9a4.2 4.2 0 0 1 8.4 0 M10 4.8a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2",
  Ponytail: "M5.8 9a4.2 4.2 0 0 1 8.4 0 M14 7.2c1.9.4 2.6 2.6 2 5.2-.3 1.4-.1 2.6.5 3.6",
};

function HairIcon({ style }: { style: string }) {
  const hair = HAIR_ICON_PATHS[style];
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="10" cy="10" r="3.4" />
      <path d="M4.5 19c.9-2 3-3 5.5-3s4.6 1 5.5 3" />
      {hair && <path d={hair} />}
    </svg>
  );
}

/** A dress silhouette for the outfit cards — lucide has a shirt but nothing for a gown. */
function DressIcon({ size }: { size: number }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 2.5v3.2L7.6 9.5 9.4 11 5.5 21.5h13L14.6 11l1.8-1.5L15 5.7V2.5" />
      <path d="M9 5.7c1 .8 2 1.2 3 1.2s2-.4 3-1.2" />
    </svg>
  );
}

/** Gowns, dresses and one-pieces read as a dress; everything else as a top. */
const isDressLike = (outfit: string) => /dress|gown|kaftan|jumpsuit/i.test(outfit);

/**
 * One outfit card — a placeholder figure rather than a photo, since the repo
 * has no per-outfit images. Selected cards get a gold border and check badge.
 */
function OutfitCard({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="group flex w-[88px] shrink-0 snap-start flex-col items-center gap-1.5 sm:w-24"
    >
      <span
        className={cn(
          "relative flex aspect-[3/4] w-full items-center justify-center overflow-hidden rounded-xl border bg-gradient-to-b from-gold/[0.10] to-gold/[0.02] transition-all",
          active ? "border-gold ring-1 ring-gold/60" : "border-white/[0.08] group-hover:border-gold/40"
        )}
      >
        <span className={cn("transition-colors", active ? "text-gold" : "text-gold/45 group-hover:text-gold/70")}>
          {isDressLike(label) ? <DressIcon size={40} /> : <Shirt size={34} strokeWidth={1.2} />}
        </span>
        {active && (
          <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-gold text-surface-deep">
            <Check size={10} strokeWidth={3} />
          </span>
        )}
      </span>
      <span
        className={cn(
          "line-clamp-2 text-center text-[10.5px] leading-tight transition-colors",
          active ? "font-semibold text-cream" : "text-muted group-hover:text-cream"
        )}
      >
        {label}
      </span>
    </button>
  );
}

/**
 * The wardrobe as a carousel of cards, with arrows and a "View all" that
 * lays every card out in a grid instead. Picking follows `toggle`, so the
 * pick-one / pick-any rule is whatever `SINGLE_PICK` says for "outfit".
 */
function OutfitPicker({
  options,
  chosen,
  onToggle,
}: {
  options: string[];
  chosen: string[];
  onToggle: (option: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const railRef = useRef<HTMLDivElement>(null);

  function scrollRail(direction: 1 | -1) {
    const rail = railRef.current;
    if (rail) rail.scrollBy({ left: direction * rail.clientWidth * 0.8, behavior: "smooth" });
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-[11px] text-faint">
          {chosen.length ? (
            <>
              Picked: <span className="text-cream">{chosen.join(", ")}</span>
            </>
          ) : (
            "None picked — a different outfit is chosen for you."
          )}
        </p>
        <button
          type="button"
          onClick={() => setShowAll((open) => !open)}
          aria-expanded={showAll}
          className="flex shrink-0 items-center gap-0.5 text-[11px] font-medium text-gold/85 transition-colors hover:text-gold"
        >
          {showAll ? "Show less" : `View All (${options.length})`}
          <ChevronRight size={12} className={cn("transition-transform", showAll && "rotate-90")} />
        </button>
      </div>

      {showAll ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] justify-items-center gap-x-2 gap-y-3">
          {options.map((option) => (
            <OutfitCard key={option} label={option} active={chosen.includes(option)} onClick={() => onToggle(option)} />
          ))}
        </div>
      ) : (
        <div className="relative">
          <div ref={railRef} className="no-scrollbar flex snap-x gap-2.5 overflow-x-auto scroll-smooth px-1 pb-1 sm:scroll-px-8 sm:px-8">
            {options.map((option) => (
              <OutfitCard key={option} label={option} active={chosen.includes(option)} onClick={() => onToggle(option)} />
            ))}
          </div>
          {([-1, 1] as const).map((direction) => (
            <button
              key={direction}
              type="button"
              onClick={() => scrollRail(direction)}
              aria-label={direction < 0 ? "Scroll outfits left" : "Scroll outfits right"}
              className={cn(
                "absolute top-[38%] hidden h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-white/[0.1] bg-surface-raised text-muted shadow-md transition-colors hover:border-gold/40 hover:text-gold sm:flex",
                direction < 0 ? "left-0" : "right-0"
              )}
            >
              {direction < 0 ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A text chip for the pick-from-a-list fields, gold when picked. */
function BuilderChip({
  label,
  active,
  icon,
  onClick,
}: {
  label: string;
  active: boolean;
  icon?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex min-h-9 items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[12px] transition-colors",
        active
          ? "border-gold/70 bg-gold/15 font-medium text-cream shadow-[0_1px_6px_rgba(196,168,106,0.18)]"
          : "border-white/[0.09] bg-white/[0.03] text-muted hover:border-gold/35 hover:text-cream"
      )}
    >
      {icon && <span className={active ? "text-gold" : "text-faint"}>{icon}</span>}
      {label}
    </button>
  );
}

const ATTRS_BY_KEY = Object.fromEntries(MODEL_ATTRS.map((attr) => [attr.key, attr]));

/** Attributes that take one value — the rest can blend several. */
const SINGLE_PICK = new Set(["gender", "age", "skinTone", "hairColor", "height", "outfit"]);

/** The small icon beside each field's label. */
const FIELD_ICONS: Record<string, LucideIcon> = {
  gender: UserRound,
  body: PersonStanding,
  age: CalendarDays,
  height: Ruler,
  skinTone: Droplet,
  skinFinish: Sparkles,
  hairStyle: Scissors,
  hairColor: Palette,
  outfit: Shirt,
};

/**
 * The form, grouped the way a person describes someone: who they are, then
 * their skin, their hair, and what they are wearing. Within a group the
 * fields sit two to a row, so the dialog stays narrow without getting long.
 *
 * The wardrobe is the one long list, so it has its section to itself.
 */
const SECTIONS: { title: string; icon: LucideIcon; fields: string[] }[] = [
  { title: "Basics", icon: Layers, fields: ["gender", "body", "age", "height"] },
  { title: "Skin", icon: Droplets, fields: ["skinTone", "skinFinish"] },
  { title: "Hair", icon: Waves, fields: ["hairStyle", "hairColor"] },
  { title: "Outfit & Styling", icon: Shirt, fields: ["outfit"] },
];

/**
 * One-tap heritage descriptions for the "Anything else" box. Tapping one
 * writes its sentence into the notes (so the person can still read and
 * edit it), and tapping again takes that sentence back out. Picking two
 * reads as mixed heritage. They go to the backend as ordinary notes text.
 */
const HERITAGE_PRESETS: { label: string; text: string }[] = [
  { label: "European / White", text: "Of European descent, with natural facial features." },
  { label: "Asian & South Asian", text: "Of East or South Asian descent, with natural facial features." },
  { label: "African", text: "Of African descent, with natural facial features." },
  { label: "Latino & Spanish", text: "Of Latino / Hispanic descent, with natural facial features." },
  { label: "Middle Eastern", text: "Of Middle Eastern descent, with natural facial features." },
];

/** The backend's limit on a saved model's notes (`LifestyleModel.notes`, maxlength 300). */
const NOTES_SAVE_MAX = 300;

/** Adds the sentence if it isn't there (and still fits), or removes it if it is. */
function toggleNote(notes: string, text: string) {
  if (notes.includes(text)) return notes.replace(text, "").replace(/ {2,}/g, " ").trim();
  const trimmed = notes.trimEnd();
  const next = trimmed ? `${trimmed} ${text}` : text;
  return next.length <= NOTES_SAVE_MAX ? next : notes;
}

/** A soft card with an icon-and-heading strip on top. */
function BuilderSection({ title, icon: Icon, aside, children }: { title: string; icon: LucideIcon; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-white/[0.07] bg-surface-raised/60 shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
      <h4 className="flex items-center gap-2.5 border-b border-white/[0.06] bg-gold/[0.06] px-4 py-2.5 text-[13px] font-semibold uppercase tracking-[0.18em] text-cream sm:px-5">
        <Icon size={17} strokeWidth={1.5} className="shrink-0 text-gold" />
        {title}
        {aside && <span className="text-[11px] font-normal normal-case tracking-normal text-faint">{aside}</span>}
      </h4>
      <div className="px-4 py-4 sm:px-5">{children}</div>
    </section>
  );
}

/**
 * Describe a person, get a model.
 *
 * Several attributes are multi-select — the picks are joined with commas,
 * which is what lets Regenerate vary the outfit within the ones chosen
 * instead of across the whole wardrobe.
 */
function ModelBuilder({
  library,
  busy,
  onClose,
}: {
  library: ModelLibraryState;
  busy: boolean;
  onClose: () => void;
}) {
  const [picks, setPicks] = useState<Record<string, string[]>>({});
  const [notes, setNotes] = useState("");
  const [name, setName] = useState("");

  function toggle(key: string, option: string) {
    setPicks((current) => {
      const chosen = current[key] ?? [];
      const next = SINGLE_PICK.has(key)
        ? { ...current, [key]: chosen[0] === option ? [] : [option] }
        : { ...current, [key]: chosen.includes(option) ? chosen.filter((entry) => entry !== option) : [...chosen, option] };

      // The wardrobe is gender-specific (see `outfitsFor`) — a switch drops
      // whatever was picked from the list that no longer applies, rather
      // than silently sending an outfit the new gender was never shown.
      if (key === "gender") delete next.outfit;
      return next;
    });
  }

  const dirty = Object.values(picks).some((chosen) => chosen.length > 0) || notes.length > 0 || name.length > 0;

  function clearAll() {
    setPicks({});
    setNotes("");
    setName("");
  }

  async function build() {
    const attrs = Object.fromEntries(
      Object.entries(picks)
        .filter(([, chosen]) => chosen.length)
        .map(([key, chosen]) => [key, chosen.join(", ")])
    );
    if (await library.generate(attrs, notes, name)) onClose();
  }

  function renderField(key: string) {
    const attr = ATTRS_BY_KEY[key];
    if (!attr) return null;
    const chosen = picks[key] ?? [];
    const FieldIcon = FIELD_ICONS[key];

    let control: ReactNode;
    if (SLIDER_ATTRS.has(key)) {
      control = <StepSlider attrKey={key} options={attr.options} value={chosen[0]} onChange={(option) => toggle(key, option)} />;
    } else if (SWATCH_COLORS[key]) {
      control = <SwatchRow attrKey={key} options={attr.options} value={chosen[0]} onChange={(option) => toggle(key, option)} />;
    } else {
      control = (
        <div className="flex flex-wrap gap-2">
          {attr.options.map((option) => (
            <BuilderChip
              key={option}
              label={option}
              active={chosen.includes(option)}
              icon={
                key === "gender" ? <UserRound size={14} strokeWidth={1.6} /> : key === "hairStyle" ? <HairIcon style={option} /> : undefined
              }
              onClick={() => toggle(key, option)}
            />
          ))}
        </div>
      );
    }

    return (
      <div className="space-y-2.5">
        <div>
          <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-cream">
            {FieldIcon && <FieldIcon size={15} strokeWidth={1.6} className="text-gold/80" />}
            {attr.label}
            {/* Says how many it takes, so a second click on a slider
                doesn't read as the first one being lost. */}
            <span className="text-[10.5px] font-normal text-faint">
              ({SINGLE_PICK.has(key) ? "pick one" : "pick one or more"})
            </span>
          </p>
          {attr.note && <p className="mt-0.5 pl-[21px] text-[10.5px] text-faint">{attr.note}</p>}
        </div>
        {control}
      </div>
    );
  }

  return (
    <ModelBuilderDrawer
      onClose={onClose}
      footer={
        // Phones get one compact row — name box, an icon-only Clear, a short
        // "Build" — and the labelled layout returns from `sm` up.
        <div className="flex items-center gap-1.5 sm:gap-2.5">
          <label className="flex min-w-0 flex-1 items-center gap-2.5">
            <span className="hidden shrink-0 items-center gap-1.5 text-[12px] font-semibold text-cream sm:flex">
              <UserRound size={15} strokeWidth={1.6} className="text-gold/80" />
              Name this Model
              <span className="hidden font-normal text-faint md:inline">(Optional)</span>
            </span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Name (optional)"
              aria-label="Name this model (optional)"
              className="min-h-9 min-w-0 flex-1 rounded-xl border border-white/[0.09] bg-white/[0.03] px-3 py-1.5 text-[12.5px] text-cream placeholder:text-faint focus:border-gold/40 focus:outline-none sm:min-h-10"
            />
          </label>
          <button
            type="button"
            onClick={clearAll}
            disabled={!dirty || busy}
            aria-label="Clear all"
            title="Clear all"
            className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-xl px-2 text-[12px] font-medium text-muted transition-colors hover:text-cream disabled:opacity-40 disabled:hover:text-muted sm:min-h-10 sm:px-3"
          >
            <RotateCcw size={14} /> <span className="hidden sm:inline">Clear All</span>
          </button>
          <button
            type="button"
            onClick={build}
            disabled={busy}
            className="flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-gold-bright via-gold to-gold-dim px-3.5 text-[12.5px] font-semibold text-white shadow-[0_4px_14px_rgba(160,120,40,0.35)] transition-[filter,opacity] hover:brightness-110 disabled:opacity-60 sm:min-h-10 sm:gap-2 sm:px-5 sm:text-[13px]"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
            {busy ? "Building…" : <><span className="sm:hidden">Build</span><span className="hidden sm:inline">Build this Model</span></>}
            {!busy && <ArrowRight size={14} className="hidden sm:block" />}
          </button>
        </div>
      }
    >
      {SECTIONS.map((section) =>
        section.fields[0] === "outfit" ? (
          <BuilderSection key={section.title} title={section.title} icon={section.icon}>
            {/* The wardrobe follows gender — see `outfitsFor`. */}
            <OutfitPicker options={outfitsFor(picks.gender)} chosen={picks.outfit ?? []} onToggle={(option) => toggle("outfit", option)} />
          </BuilderSection>
        ) : (
          <BuilderSection key={section.title} title={section.title} icon={section.icon}>
            <div className="grid gap-y-5 sm:grid-cols-2">
              {section.fields.map((key, index) => (
                <div
                  key={key}
                  className={cn(
                    "min-w-0",
                    index % 2 === 0 ? "sm:pr-6" : "sm:border-l sm:border-white/[0.07] sm:pl-6"
                  )}
                >
                  {renderField(key)}
                </div>
              ))}
            </div>
          </BuilderSection>
        )
      )}

      <BuilderSection title="Anything Else" icon={NotebookPen} aside="(optional)">
        <div className="mb-3 space-y-2">
          <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-cream">
            <Globe size={15} strokeWidth={1.6} className="text-gold/80" />
            Heritage
            <span className="text-[10.5px] font-normal text-faint">(tap to add a description — tap again to remove)</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {HERITAGE_PRESETS.map((preset) => {
              const active = notes.includes(preset.text);
              return (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setNotes((current) => toggleNote(current, preset.text))}
                  aria-pressed={active}
                  title={preset.text}
                  className={cn(
                    "flex min-h-9 items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[12px] transition-colors",
                    active
                      ? "border-gold/70 bg-gold/15 font-medium text-cream shadow-[0_1px_6px_rgba(196,168,106,0.18)]"
                      : "border-white/[0.09] bg-white/[0.03] text-muted hover:border-gold/35 hover:text-cream"
                  )}
                >
                  {active && <Check size={12} strokeWidth={2.5} className="text-gold" />}
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>
        {/* No visible counter — the box grows with the text, up to a scroll.
            The quiet cap is the backend's own: `LifestyleModel.notes` has
            maxlength 300, checked when the finished model is saved, so a
            longer note would fail the build after the image was paid for. */}
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value.slice(0, NOTES_SAVE_MAX))}
          maxLength={NOTES_SAVE_MAX}
          rows={2}
          placeholder="e.g. freckles across the nose, a small gap between the front teeth, warm undertones…"
          className="field-sizing-content block max-h-60 min-h-[4.5rem] w-full resize-none rounded-xl border border-white/[0.09] bg-white/[0.03] px-3 py-2 text-[12.5px] leading-relaxed text-cream placeholder:text-faint focus:border-gold/40 focus:outline-none"
        />
      </BuilderSection>
    </ModelBuilderDrawer>
  );
}
