"use client";

import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { ChevronDown, ChevronUp, Globe, Loader2, Lock, type LucideIcon, Pencil, Trash2, Upload, Wand2, X } from "lucide-react";
import { Chip } from "./OptionChips";
import { Lightbox } from "./Lightbox";
import { ConfirmDialog } from "./ToolChrome";
import { useAuth } from "@/lib/auth-context";
import { LIFESTYLE_PRESETS } from "@/lib/api";
import { MODEL_ATTRS, outfitsFor } from "@/lib/lifestyleOptions";
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
        className="animate-drawer-up flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-2xl border border-white/[0.08] bg-surface-deep shadow-2xl sm:max-h-[85vh] sm:max-w-2xl sm:rounded-2xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/[0.06] px-5 py-3.5">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-cream">
              <Wand2 size={14} className="text-gold/70" /> Build a model
            </h3>
            <p className="mt-0.5 text-[11px] text-faint">
              Pick only what matters to you — anything you leave blank is chosen for you.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the builder"
            className="shrink-0 rounded-lg p-1 text-faint transition-colors hover:text-cream"
          >
            <X size={16} />
          </button>
        </div>

        <div className="thin-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">{children}</div>

        <div className="shrink-0 border-t border-white/[0.06] px-5 py-3">{footer}</div>
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

/**
 * A step slider for an attribute whose options are a single ordered scale —
 * Skin Tone, Hair Color, Age, Height — rather than an unordered set. Reading
 * "where along the line" is faster than reading five same-styled chips and
 * comparing their wording, and it makes the single-pick constraint visible
 * instead of just enforced.
 *
 * Still single-pick underneath: `onChange` replaces the whole selection, the
 * same as `toggle` already does for these keys via `SINGLE_PICK`.
 */
const SLIDER_ATTRS = new Set(["skinTone", "hairColor", "age", "height"]);

/** Short tick captions for the sliders whose real option text is too long to sit under a dot. Keys not listed here show their option text as-is. */
const SLIDER_TICK_LABELS: Record<string, Record<string, string>> = {
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
  const labels = SLIDER_TICK_LABELS[attrKey];
  const activeIndex = value ? options.indexOf(value) : -1;
  const fillPct = activeIndex >= 0 ? (activeIndex / (options.length - 1)) * 100 : 0;

  return (
    <div className="pt-5">
      <div className="relative mx-1.5 h-1">
        <div aria-hidden className="absolute inset-0 rounded-full bg-white/10" />
        {activeIndex >= 0 && (
          <div
            aria-hidden
            className="absolute inset-y-0 left-0 rounded-full bg-gold/70"
            style={{ width: `${fillPct}%` }}
          />
        )}
        <div className="absolute inset-0 flex items-center justify-between">
          {options.map((option, index) => {
            const active = index === activeIndex;
            return (
              <button
                key={option}
                type="button"
                onClick={() => onChange(option)}
                aria-pressed={active}
                aria-label={option}
                className={cn(
                  "relative -mx-1.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                  active ? "border-gold bg-surface-deep" : "border-white/25 bg-white/10 hover:border-white/40"
                )}
              >
                {active && (
                  <span className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-gold/30 bg-gold/15 px-2 py-0.5 text-[10px] font-semibold text-gold">
                    {labels?.[option] ?? option}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-2 flex justify-between gap-1">
        {options.map((option) => (
          <span key={option} className="flex-1 text-center text-[9px] leading-tight text-faint">
            {labels?.[option] ?? option}
          </span>
        ))}
      </div>
    </div>
  );
}

const ATTRS_BY_KEY = Object.fromEntries(MODEL_ATTRS.map((attr) => [attr.key, attr]));

/** Attributes that take one value — the rest can blend several. */
const SINGLE_PICK = new Set(["gender", "age", "skinTone", "hairColor", "height", "outfit"]);

/**
 * The form, grouped the way a person describes someone: who they are, then
 * their skin, their hair, and what they are wearing. Within a group the
 * fields sit two to a row, so the dialog stays narrow without getting long.
 *
 * The wardrobe is the one long list, so it has its section to itself.
 */
const SECTIONS: { title: string; fields: string[] }[] = [
  { title: "Basics", fields: ["gender", "body", "age", "height"] },
  { title: "Skin", fields: ["skinTone", "skinFinish"] },
  { title: "Hair", fields: ["hairStyle", "hairColor"] },
  { title: "Outfit", fields: ["outfit"] },
];


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
  /**
   * The wardrobe starts folded. Most people are happy with a random outfit
   * (see the backend's fallback), and twenty-odd chips were the bulk of the
   * form — so it is one line until someone asks to choose.
   */
  const [outfitOpen, setOutfitOpen] = useState(false);

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
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Name this model (optional)"
            className="min-h-9 min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-[12px] text-cream placeholder:text-faint focus:border-gold/30 focus:outline-none"
          />
          <button
            type="button"
            onClick={build}
            disabled={busy}
            className="flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-gold/30 bg-gold/15 px-4 text-xs font-semibold text-gold transition-colors hover:bg-gold/25 disabled:opacity-50"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
            {busy ? "Building…" : "Build this model"}
          </button>
        </div>
      }
    >
      {SECTIONS.map((section) => (
        <section key={section.title} className="space-y-3">
          <h4 className="border-b border-white/[0.06] pb-1.5 text-[11px] font-semibold uppercase tracking-widest text-cream/80">
            {section.title}
          </h4>
          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            {section.fields.map((key) => {
              const attr = ATTRS_BY_KEY[key];
              if (!attr) return null;
              const chosen = picks[key] ?? [];
              // The wardrobe follows gender — see `outfitsFor`.
              const options = key === "outfit" ? outfitsFor(picks.gender) : attr.options;
              const isOutfit = key === "outfit";

              return (
                <div key={key} className={cn("space-y-2", isOutfit && "sm:col-span-2")}>
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-[11px] font-medium text-muted">
                      {attr.label}
                      {/* Says how many it takes, so a second click on a
                          slider doesn't read as the first one being lost. */}
                      <span className="ml-1.5 text-[10px] font-normal text-faint">
                        {SINGLE_PICK.has(key) ? "pick one" : "pick any"}
                      </span>
                    </p>
                    {isOutfit && chosen.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setPicks((current) => ({ ...current, outfit: [] }))}
                        className="text-[10px] text-gold/80 transition-colors hover:text-gold"
                      >
                        Clear
                      </button>
                    )}
                  </div>

                  {attr.note && <p className="-mt-1 text-[10px] text-faint/70">{attr.note}</p>}

                  {isOutfit && !outfitOpen ? (
                    <button
                      type="button"
                      onClick={() => setOutfitOpen(true)}
                      aria-expanded={false}
                      className="flex w-full items-center justify-between gap-3 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-left transition-colors hover:border-white/[0.16]"
                    >
                      <span className="min-w-0 truncate text-[12px] text-cream">
                        {chosen.length ? chosen.join(", ") : "Random"}
                        {!chosen.length && (
                          <span className="ml-1.5 text-[11px] text-faint">— a different outfit is chosen for you</span>
                        )}
                      </span>
                      <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-gold/80">
                        {chosen.length ? "Change" : "Choose"} <ChevronDown size={12} />
                      </span>
                    </button>
                  ) : SLIDER_ATTRS.has(key) ? (
                    <StepSlider attrKey={key} options={options} value={chosen[0]} onChange={(option) => toggle(key, option)} />
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {options.map((option) => (
                        <Chip
                          key={option}
                          label={option}
                          size="sm"
                          active={chosen.includes(option)}
                          onClick={() => {
                            toggle(key, option);
                            // One outfit, so picking it is the end of the choice — fold the list back up.
                            if (isOutfit && !chosen.includes(option)) setOutfitOpen(false);
                          }}
                        />
                      ))}
                    </div>
                  )}

                  {isOutfit && outfitOpen && (
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] text-faint">
                        Pick one outfit, or leave it unpicked for a random one.
                      </p>
                      <button
                        type="button"
                        onClick={() => setOutfitOpen(false)}
                        aria-expanded
                        className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-gold/80 transition-colors hover:text-gold"
                      >
                        Done <ChevronUp size={12} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <section className="space-y-2">
        <h4 className="border-b border-white/[0.06] pb-1.5 text-[11px] font-semibold uppercase tracking-widest text-cream/80">
          Anything else <span className="font-normal normal-case tracking-normal text-faint">(optional)</span>
        </h4>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={2}
          placeholder="e.g. freckles across the nose, a small gap between the front teeth, warm undertones…"
          className="w-full resize-none rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[12px] leading-relaxed text-cream placeholder:text-faint focus:border-gold/30 focus:outline-none"
        />
      </section>
    </ModelBuilderDrawer>
  );
}
