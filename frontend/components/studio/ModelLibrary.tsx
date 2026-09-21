"use client";

import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { Globe, Loader2, Lock, type LucideIcon, Pencil, Trash2, Upload, Wand2, X } from "lucide-react";
import { Chip } from "./OptionChips";
import { Lightbox } from "./Lightbox";
import { ConfirmDialog } from "./ToolChrome";
import { useAuth } from "@/lib/auth-context";
import { LIFESTYLE_PRESETS } from "@/lib/api";
import { MODEL_ATTRS } from "@/lib/lifestyleOptions";
import type { ModelLibraryState } from "@/lib/useModelLibrary";
import { useEscapeKey } from "@/lib/useEscapeKey";
import { cn } from "@/lib/utils";

/**
 * The model picker: the built-in mannequins, this organization's saved
 * models, and the two ways to add one — upload a photo, or describe a person
 * and have one generated.
 *
 * Shared by Lifestyle and Campaign Kit. The state lives in
 * `useModelLibrary`; this is only how it looks.
 */
export function ModelLibrary({ library }: { library: ModelLibraryState }) {
  const { user } = useAuth();
  const [building, setBuilding] = useState(false);
  /** The saved model open in the viewer, and the one being renamed in place. */
  const [preview, setPreview] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  /** A pending share/unshare, held until it is confirmed. */
  const [confirming, setConfirming] = useState<{ id: string; name: string; share: boolean } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const { choice, setChoice, models, generating, pendingJob } = library;

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
          <AddModelAction icon={Upload} label="Upload a photo" onClick={() => fileInput.current?.click()} />
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

        {LIFESTYLE_PRESETS.map((preset) => (
          <ModelTile
            key={`preset-${preset.number}`}
            src={preset.src}
            label={`Model ${preset.number}`}
            active={choice?.kind === "preset" && choice.number === preset.number}
            onSelect={() => setChoice({ kind: "preset", number: preset.number, src: preset.src })}
          />
        ))}

        {models.map((model) => (
          <ModelTile
            key={model.id}
            src={model.thumbnailUrl}
            label={model.name}
            shared={model.isPublic}
            active={choice?.kind === "saved" && choice.id === model.id}
            onSelect={() => setChoice({ kind: "saved", id: model.id, src: model.thumbnailUrl })}
            onPreview={() => setPreview(model.imageUrl || model.thumbnailUrl)}
            renaming={renaming === model.id}
            onRename={() => setRenaming(model.id)}
            onRenamed={(name) => {
              setRenaming(null);
              if (name && name !== model.name) library.rename(model.id, name);
            }}
            onShare={
              isAdmin
                ? () => setConfirming({ id: model.id, name: model.name, share: !model.isPublic })
                : undefined
            }
            onDelete={isAdmin ? () => library.remove(model.id) : undefined}
          />
        ))}

        {choice?.kind === "upload" && (
          <ModelTile src={choice.src} label="Just uploaded" active onSelect={() => undefined} />
        )}
      </ul>

      {building && (
        // Queued is done as far as this drawer goes: the tile in the grid is
        // where the wait is watched from, and it is behind the drawer.
        <ModelBuilder library={library} busy={generating} onClose={() => setBuilding(false)} />
      )}

      {/* The grid's tiles are ~100px wide; this is how you actually look at
          a model before placing jewellery on her. */}
      <Lightbox src={preview} onClose={() => setPreview(null)} downloadName="model.jpg" />

      {/* Who can see a photograph of a person is worth one deliberate click
          — in either direction: sharing exposes her to the whole
          organization, and unsharing pulls her out of everyone else's
          picker, including runs they were about to make. */}
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
 * The builder, as a sheet up from the bottom of the window.
 *
 * It is a long form — eight attribute rows — and inlining it pushed the
 * whole page down and left the grid it belongs to off screen. Portalled to
 * <body> so the page's own scroll containers can't clip or scroll it.
 */
function ModelBuilderDrawer({
  onClose,
  header,
  children,
}: {
  onClose: () => void;
  /** Sits in the sticky bar beside the title — the name, the note and Build. */
  header: ReactNode;
  children: ReactNode;
}) {
  useEscapeKey(onClose);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Build a model"
        onClick={(event) => event.stopPropagation()}
        className="animate-drawer-up max-h-[85vh] w-full overflow-y-auto rounded-t-2xl border-t border-white/[0.08] bg-surface-deep shadow-2xl"
      >
        {/* Naming it and building it ride in the sticky bar: they are the
            two things you reach for last, and putting them at the foot of a
            form this wide means scrolling back down past every chip. */}
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-white/[0.06] bg-surface-deep px-4 py-2.5">
          <h3 className="flex shrink-0 items-center gap-2 text-xs font-semibold uppercase tracking-wider text-cream">
            <Wand2 size={13} className="text-gold/70" /> Build a model
          </h3>
          {header}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the builder"
            className="shrink-0 rounded-lg p-1 text-faint transition-colors hover:text-cream"
          >
            <X size={15} />
          </button>
        </div>
        <div className="space-y-4 p-4">{children}</div>
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
  src,
  label,
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
  src: string;
  label: string;
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
    <li className="group relative">
      <button
        type="button"
        onClick={onSelect}
        // A tile is small, and looking closely at a model is a second thing
        // you do to the same picture — so it is the same target, twice.
        onDoubleClick={onPreview}
        aria-pressed={active}
        title={onPreview ? `${label} — double-click to enlarge` : label}
        className={cn(
          "relative block aspect-[3/4] w-full overflow-hidden rounded-lg border transition-colors",
          active ? "border-gold/50 ring-1 ring-gold/30" : "border-white/10 hover:border-white/25"
        )}
      >
        <Image src={src} alt={label} fill sizes="140px" className="object-cover" />
        {!renaming && (
          <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/75 to-transparent px-1.5 pb-1 pt-4 text-left text-[10px] font-medium text-white/85">
            {label}
            {shared && <span className="ml-1 text-gold/70">· shared</span>}
          </span>
        )}
      </button>

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
      {(onRename || onShare || onDelete) && (
        <div className="absolute right-1 top-1 flex items-center gap-0.5 rounded-full border border-white/20 bg-black/60 p-0.5 opacity-0 backdrop-blur-sm transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {onRename && <TileAction icon={Pencil} label={`Rename ${label}`} onClick={onRename} />}
          {onShare && (
            <TileAction
              icon={shared ? Globe : Lock}
              label={shared ? `Stop sharing ${label} with the organization` : `Share ${label} with the organization`}
              active={shared}
              onClick={onShare}
            />
          )}
          {onDelete && <TileAction icon={Trash2} label={`Delete ${label}`} onClick={onDelete} danger />}
        </div>
      )}
    </li>
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

/** Gender sits in the drawer's header; everything else in the grid below it. */
const GENDER_ATTR = MODEL_ATTRS.find((attr) => attr.key === "gender");
const BODY_ATTRS = MODEL_ATTRS.filter((attr) => attr.key !== "gender");

/**
 * Attributes that take the grid's full width.
 *
 * Not a count of options but a measure of their labels: the wardrobe has
 * thirty, and hair colour only six, but "Light blonde / platinum (Level
 * 9–10)" wraps to three lines in a quarter-width column.
 */
const FULL_WIDTH_ATTRS = new Set(["outfit", "hairColor"]);

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

  const SINGLE_PICK = new Set(["gender", "age"]);

  function toggle(key: string, option: string) {
    setPicks((current) => {
      const chosen = current[key] ?? [];
      if (SINGLE_PICK.has(key)) return { ...current, [key]: chosen[0] === option ? [] : [option] };
      return {
        ...current,
        [key]: chosen.includes(option) ? chosen.filter((entry) => entry !== option) : [...chosen, option],
      };
    });
  }

  async function build() {
    const attrs = Object.fromEntries(
      Object.entries(picks)
        .filter(([, chosen]) => chosen.length)
        .map(([key, chosen]) => [key, chosen.join(", ")])
    );
    if (await library.generate(attrs, notes, name)) onClose();
  }

  return (
    <ModelBuilderDrawer
      onClose={onClose}
      header={
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
          {/* Gender rides up here with them: it is the one attribute that
              changes what every other pick means, so it is picked first. */}
          {GENDER_ATTR && (
            <div className="mr-auto flex shrink-0 items-center gap-1.5">
              {GENDER_ATTR.options.map((option) => (
                <Chip
                  key={option}
                  label={option}
                  size="sm"
                  active={(picks[GENDER_ATTR.key] ?? []).includes(option)}
                  onClick={() => toggle(GENDER_ATTR.key, option)}
                />
              ))}
            </div>
          )}
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Name this model (optional)"
            className="min-h-8 w-40 min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-[12px] text-cream placeholder:text-faint focus:border-gold/30 focus:outline-none sm:max-w-[220px]"
          />
          <input
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Anything else about her look"
            className="min-h-8 w-44 min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-[12px] text-cream placeholder:text-faint focus:border-gold/30 focus:outline-none sm:max-w-[320px]"
          />
          <button
            type="button"
            onClick={build}
            disabled={busy}
            className="flex min-h-8 shrink-0 items-center justify-center gap-2 rounded-lg border border-gold/30 bg-gold/15 px-4 text-xs font-semibold text-gold transition-colors hover:bg-gold/25 disabled:opacity-50"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
            {busy ? "Building…" : "Build this model"}
          </button>
        </div>
      }
    >
      {/*
       * Columns rather than one tall list.
       *
       * Eight of the nine attributes are two to six chips — stacked, they
       * made a form twice the height of the window for maybe 400px of
       * actual content. Side by side they all fit at once, which is what
       * this form wants: the picks are read together, not in order.
       *
       * The one long list (the wardrobe) keeps the full width to itself and
       * wraps there.
       */}
      <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
        {BODY_ATTRS.map((attr) => (
          <div
            key={attr.key}
            className={cn("space-y-1.5", FULL_WIDTH_ATTRS.has(attr.key) && "sm:col-span-2 lg:col-span-4")}
          >
            <p className="text-[10px] font-medium uppercase tracking-widest text-faint">
              {attr.label}
              {attr.note && <span className="ml-1.5 normal-case tracking-normal text-faint/60">{attr.note}</span>}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {attr.options.map((option) => (
                <Chip
                  key={option}
                  label={option}
                  size="sm"
                  active={(picks[attr.key] ?? []).includes(option)}
                  onClick={() => toggle(attr.key, option)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-faint">
        It joins the queue like any other generation — you can leave this page and it will still be here.
      </p>
    </ModelBuilderDrawer>
  );
}
