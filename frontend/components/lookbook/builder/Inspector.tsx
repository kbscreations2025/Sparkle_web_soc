"use client";

import type { ReactNode } from "react";
import { AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowUp, ImagePlus, Play, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { uid } from "@/lib/lookbook/defaults";
import { ASPECT_LABELS, thumbOf } from "@/lib/lookbook/media";
import { move } from "@/lib/lookbook/edit";
import type { ResolvedTheme } from "@/lib/lookbook/theme";
import {
  CARD_HINTS,
  CARD_LABELS,
  MEDIA_CARDS,
  VARIANTS,
  type Aspect,
  type CardAnimation,
  type CardStyle,
  type ContactButton,
  type ContactKind,
  type LookbookCard,
  type Media,
  type MediaKind,
} from "@/lib/lookbook/types";
import type { MediaSlot } from "../context";
import { ColorField, Field, Hint, Range, Section, Segmented, Select, TextArea, TextInput, Toggle } from "./controls";
import { CARD_ICONS } from "./cardMeta";

type InspectorProps = {
  card: LookbookCard;
  theme: ResolvedTheme;
  update: (update: (card: LookbookCard) => LookbookCard, coalesce?: string) => void;
  pickMedia: (slot: MediaSlot, kind: MediaKind) => void;
  /** Replays this card's entrance in the preview. */
  onReplay: () => void;
};

const ASPECTS: Aspect[] = ["auto", "1:1", "4:5", "3:4", "2:3", "3:2", "16:9", "9:16"];

/** Everything about the selected card that isn't typed straight onto the page. */
export function Inspector({ card, theme, update, pickMedia, onReplay }: InspectorProps) {
  const Icon = CARD_ICONS[card.type];
  const set = (patch: Partial<LookbookCard>, key?: string) => update((current) => ({ ...current, ...patch }) as LookbookCard, key && `${card.id}:${key}`);
  const setStyle = (patch: Partial<CardStyle>, key?: string) =>
    update((current) => ({ ...current, style: { ...current.style, ...patch } }), key && `${card.id}:style:${key}`);
  const setAnimation = (patch: Partial<CardAnimation>, key?: string) =>
    update((current) => ({ ...current, animation: { ...current.animation, ...patch } }), key && `${card.id}:anim:${key}`);
  const { style, animation } = card;
  const swatches = [theme.colors.bg, theme.colors.surface, theme.colors.text, theme.colors.heading, theme.colors.accent, "#FFFFFF", "#000000"];

  return (
    <div>
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gold/10 text-gold">
          <Icon size={13} />
        </span>
        <p className="min-w-0 flex-1 truncate text-[12px] font-semibold text-cream">{CARD_LABELS[card.type]}</p>
        <Hint text={`${CARD_HINTS[card.type]}. Click any text on the page to change it.`} />
      </div>

      <Section title="Layout">
        <Segmented
          value={style.variant}
          options={VARIANTS[card.type].map((variant) => ({ id: variant.id, label: variant.label }))}
          onChange={(variant) => setStyle(card.type === "hero" ? { variant, fit: variant === "overlay" ? "fill" : "whole" } : { variant })}
          columns={VARIANTS[card.type].length > 3 ? 2 : VARIANTS[card.type].length}
        />
        {card.type !== "spacer" && (
          <>
            <Field label="Width">
              <Segmented
                value={style.width}
                options={[
                  { id: "full", label: "Edge to edge" },
                  { id: "wide", label: "Page" },
                  { id: "narrow", label: "Narrow" },
                ]}
                onChange={(width) => setStyle({ width })}
              />
            </Field>
            <Field label="Alignment">
              <Segmented
                value={style.align}
                options={[
                  { id: "left", label: <AlignLeft size={14} />, title: "Left" },
                  { id: "center", label: <AlignCenter size={14} />, title: "Centre" },
                  { id: "right", label: <AlignRight size={14} />, title: "Right" },
                ]}
                onChange={(align) => setStyle({ align })}
              />
            </Field>
          </>
        )}
      </Section>

      <ContentSection card={card} set={set} update={update} pickMedia={pickMedia} />

      {MEDIA_CARDS.includes(card.type) && (
        <Section title="Pictures">
          <Field label="Fit" hint={style.fit === "whole" ? "Every pixel shows. Nothing is cropped." : "Fills the frame edge to edge; edges may be trimmed."}>
            <Segmented
              value={style.fit}
              options={[
                { id: "whole", label: "Whole" },
                { id: "fill", label: "Fill" },
              ]}
              onChange={(fit) => setStyle({ fit })}
            />
          </Field>
          {!(card.type === "hero" && style.variant === "overlay" && card.height !== "auto") && (
            <Field label="Shape" hint={card.type === "gallery" && style.variant === "grid" && style.aspect === "auto" ? "Original keeps each photo whole in a square tile." : undefined}>
              <Segmented value={style.aspect} options={ASPECTS.map((id) => ({ id, label: ASPECT_LABELS[id] }))} onChange={(aspect) => setStyle({ aspect })} columns={4} />
            </Field>
          )}
          {card.type === "hero" && style.variant === "overlay" && (
            <>
              <Field label="Shade over the picture" hint="Keeps the words readable on a bright photo.">
                <Range value={Math.round(style.overlay * 100)} min={0} max={85} onChange={(value) => setStyle({ overlay: value / 100 }, "overlay")} format={(value) => `${value}%`} />
              </Field>
              <Field label="Shade colour">
                <ColorField value={style.overlayColor} allowClear clearLabel="Black" onChange={(overlayColor) => setStyle({ overlayColor })} swatches={["#000000", "#FFFFFF", theme.colors.bg, theme.colors.accent]} />
              </Field>
            </>
          )}
        </Section>
      )}

      <Section title="Style" defaultOpen={false}>
        {card.type !== "spacer" && (
          <Field label="Background">
            <Segmented
              value={style.background}
              options={[
                { id: "none", label: "None" },
                { id: "surface", label: "Soft" },
                { id: "accent", label: "Accent" },
                { id: "custom", label: "Colour" },
              ]}
              onChange={(background) => setStyle({ background, bgColor: background === "custom" ? style.bgColor ?? theme.colors.surface : style.bgColor })}
            />
          </Field>
        )}
        {style.background === "custom" && (
          <ColorField value={style.bgColor} onChange={(bgColor) => setStyle({ bgColor }, "bg")} swatches={swatches} />
        )}
        <Field label="Text colour">
          <ColorField value={style.textColor} allowClear clearLabel="Page's" onChange={(textColor) => setStyle({ textColor }, "text")} swatches={swatches} />
        </Field>
        <Field label="Title colour">
          <ColorField value={style.headingColor} allowClear clearLabel="Page's" onChange={(headingColor) => setStyle({ headingColor }, "heading")} swatches={swatches} />
        </Field>
        <Field label="Text size">
          <Range value={Math.round(style.textScale * 100)} min={70} max={180} step={5} onChange={(value) => setStyle({ textScale: value / 100 }, "scale")} format={(value) => `${value}%`} />
        </Field>
        <Field label="Corners" hint={style.radius === null ? `Following the page (${theme.radius}px).` : undefined}>
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <Range value={style.radius ?? theme.radius} min={0} max={48} onChange={(radius) => setStyle({ radius }, "radius")} format={(value) => `${value}px`} />
            </div>
            {style.radius !== null && (
              <button type="button" onClick={() => setStyle({ radius: null })} className="shrink-0 text-[11px] text-faint hover:text-cream">
                Reset
              </button>
            )}
          </div>
        </Field>
        <Field label="Padding, top and bottom">
          <Range value={style.paddingY} min={0} max={200} step={4} onChange={(paddingY) => setStyle({ paddingY }, "padY")} format={(value) => `${value}px`} />
        </Field>
        <Field label="Padding, sides">
          <Range value={style.paddingX} min={0} max={120} step={4} onChange={(paddingX) => setStyle({ paddingX }, "padX")} format={(value) => `${value}px`} />
        </Field>
        <Field label="Space above">
          <Range value={style.spaceAbove} min={0} max={200} step={4} onChange={(spaceAbove) => setStyle({ spaceAbove }, "space")} format={(value) => `${value}px`} />
        </Field>
      </Section>

      {card.type !== "spacer" && (
        <Section
          title="Animation"
          aside={
            animation.type !== "none" && (
              <button type="button" onClick={onReplay} className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-gold hover:bg-gold/10">
                <Play size={11} /> Play
              </button>
            )
          }
        >
          <Segmented
            value={animation.type}
            options={[
              { id: "none", label: "None" },
              { id: "fade", label: "Fade" },
              { id: "slide", label: "Slide" },
              { id: "zoom", label: "Zoom" },
              { id: "parallax", label: "Parallax" },
            ]}
            onChange={(type) => setAnimation({ type })}
            columns={3}
          />
          {animation.type === "slide" && (
            <Field label="From">
              <Segmented
                value={animation.direction}
                options={[
                  { id: "up", label: "Below" },
                  { id: "down", label: "Above" },
                  { id: "left", label: "Right" },
                  { id: "right", label: "Left" },
                ]}
                onChange={(direction) => setAnimation({ direction })}
              />
            </Field>
          )}
          {animation.type === "parallax" ? (
            <Field label="Strength" hint="How far the picture drifts as the page scrolls.">
              <Range value={Math.round(animation.strength * 100)} min={10} max={100} step={5} onChange={(value) => setAnimation({ strength: value / 100 }, "strength")} format={(value) => `${value}%`} />
            </Field>
          ) : (
            animation.type !== "none" && (
              <>
                <Field label="Speed" hint="How long the entrance takes.">
                  <Range value={animation.duration} min={0.2} max={2.5} step={0.1} onChange={(duration) => setAnimation({ duration }, "duration")} format={(value) => `${value.toFixed(1)}s`} />
                </Field>
                <Field label="Delay">
                  <Range value={animation.delay} min={0} max={2} step={0.1} onChange={(delay) => setAnimation({ delay }, "delay")} format={(value) => `${value.toFixed(1)}s`} />
                </Field>
              </>
            )
          )}
        </Section>
      )}
    </div>
  );
}

/* ── Per-type settings ─────────────────────────────────────────────── */

function ContentSection({
  card,
  set,
  update,
  pickMedia,
}: {
  card: LookbookCard;
  set: (patch: Partial<LookbookCard>, key?: string) => void;
  update: InspectorProps["update"];
  pickMedia: InspectorProps["pickMedia"];
}) {
  let body: ReactNode = null;
  switch (card.type) {
    case "hero":
      body = (
        <>
          <MediaField label="Picture or clip" media={card.media} onPick={() => pickMedia("media", card.media?.kind ?? "image")} onPickVideo={() => pickMedia("media", "video")} onRemove={() => set({ media: null })} allowVideo />
          <Field label="Height">
            <Segmented
              value={card.height}
              options={[
                { id: "screen", label: "Screen" },
                { id: "tall", label: "Tall" },
                { id: "medium", label: "Medium" },
                { id: "auto", label: "Photo's" },
              ]}
              onChange={(height) => set({ height })}
            />
          </Field>
          <Field label="Button goes to">
            <Segmented
              value={card.buttonTarget}
              options={[
                { id: "next", label: "Next card" },
                { id: "contact", label: "Contact" },
                { id: "none", label: "No button" },
              ]}
              onChange={(buttonTarget) => set({ buttonTarget })}
            />
          </Field>
        </>
      );
      break;
    case "gallery":
      body = (
        <>
          <GalleryItems card={card} update={update} pickMedia={pickMedia} />
          <Field label="Columns on a computer">
            <Range value={card.columns} min={1} max={6} onChange={(columns) => set({ columns }, "columns")} />
          </Field>
          <Field label="Columns on a phone">
            <Range value={card.mobileColumns} min={1} max={3} onChange={(mobileColumns) => set({ mobileColumns }, "mobileColumns")} />
          </Field>
          <Field label="Captions under photos" inline>
            <Toggle checked={card.showCaptions} onChange={(showCaptions) => set({ showCaptions })} />
          </Field>
        </>
      );
      break;
    case "spotlight":
      body = (
        <>
          <MediaField label="Photo" media={card.media} onPick={() => pickMedia("media", "image")} onRemove={() => set({ media: null })} />
          <Field label="Show the price" hint="Hidden prices are left out of the public page completely." inline>
            <Toggle checked={card.showPrice} onChange={(showPrice) => set({ showPrice })} />
          </Field>
          {card.showPrice && (
            <Field label="Price">
              <TextInput value={card.price} onChange={(price) => set({ price }, "price")} placeholder="₹ 1,25,000" />
            </Field>
          )}
        </>
      );
      break;
    case "before_after":
      body = (
        <>
          <MediaField label="Before" media={card.before} onPick={() => pickMedia("before", "image")} onRemove={() => set({ before: null })} />
          <MediaField label="After" media={card.after} onPick={() => pickMedia("after", "image")} onRemove={() => set({ after: null })} />
          {card.style.variant === "slider" && (
            <Field label="Divider starts at">
              <Range value={card.start} min={5} max={95} onChange={(start) => set({ start }, "start")} format={(value) => `${value}%`} />
            </Field>
          )}
        </>
      );
      break;
    case "video":
      body = (
        <>
          <MediaField label="Clip" media={card.media} onPick={() => pickMedia("media", "video")} onRemove={() => set({ media: null })} kind="video" />
          <Field label="Play by itself" hint="Muted and looping, while on screen." inline>
            <Toggle checked={card.autoplay} onChange={(autoplay) => set({ autoplay })} />
          </Field>
          <Field label="Loop" inline>
            <Toggle checked={card.loop} onChange={(loop) => set({ loop })} />
          </Field>
          <Field label="Show controls" inline>
            <Toggle checked={card.showControls} onChange={(showControls) => set({ showControls })} />
          </Field>
        </>
      );
      break;
    case "specs":
      body = (
        <>
          <Field label="Show prices" hint="Hidden prices are left out of the public page completely, not just hidden." inline>
            <Toggle checked={card.showPrices} onChange={(showPrices) => set({ showPrices })} />
          </Field>
          <button
            type="button"
            onClick={() => update((current) => (current.type === "specs" ? { ...current, rows: [...current.rows, { id: uid(), name: "", detail: "", price: "" }] } : current))}
            className="flex items-center gap-1 text-[12px] font-medium text-gold hover:underline"
          >
            <Plus size={13} /> Add a row
          </button>
          <p className="text-[11px] text-faint">Type the pieces, details and prices straight into the table.</p>
        </>
      );
      break;
    case "contact":
      body = <ContactButtons card={card} update={update} set={set} />;
      break;
    case "spacer":
      body = (
        <Field label="Height">
          <Range value={card.height} min={0} max={240} step={4} onChange={(height) => set({ height }, "height")} format={(value) => `${value}px`} />
        </Field>
      );
      break;
    default:
      body = null;
  }
  if (!body) return null;
  return <Section title="Content">{body}</Section>;
}

function MediaField({
  label,
  media,
  onPick,
  onPickVideo,
  onRemove,
  allowVideo = false,
  kind = "image",
}: {
  label: string;
  media: Media | null;
  onPick: () => void;
  onPickVideo?: () => void;
  onRemove: () => void;
  allowVideo?: boolean;
  kind?: MediaKind;
}) {
  const thumb = media ? thumbOf(media) : null;
  return (
    <Field label={label}>
      <div className="flex items-center gap-2.5">
        <button type="button" onClick={onPick} className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/[0.08] bg-white/[0.04] text-faint hover:border-gold/40">
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element -- a small thumbnail
            <img src={thumb} alt="" className="h-full w-full object-cover" />
          ) : media?.kind === "video" ? (
            <Play size={16} />
          ) : (
            <ImagePlus size={16} />
          )}
        </button>
        <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          <button type="button" onClick={onPick} className="flex items-center gap-1 rounded-md border border-white/[0.08] px-2 py-1 text-[11.5px] font-medium text-cream hover:border-gold/40">
            {media ? <RefreshCw size={11} /> : <Plus size={11} />}
            {media ? "Replace" : kind === "video" ? "Add a clip" : "Add a photo"}
          </button>
          {allowVideo && onPickVideo && (
            <button type="button" onClick={onPickVideo} className="flex items-center gap-1 rounded-md border border-white/[0.08] px-2 py-1 text-[11.5px] font-medium text-cream hover:border-gold/40">
              <Play size={11} /> Use a clip
            </button>
          )}
          {media && (
            <button type="button" onClick={onRemove} className="flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] text-faint hover:text-red-400">
              <Trash2 size={11} /> Remove
            </button>
          )}
        </div>
      </div>
    </Field>
  );
}

function GalleryItems({ card, update, pickMedia }: { card: Extract<LookbookCard, { type: "gallery" }>; update: InspectorProps["update"]; pickMedia: InspectorProps["pickMedia"] }) {
  const items = card.items;
  const moveItem = (index: number, by: -1 | 1) =>
    update((current) => (current.type === "gallery" ? { ...current, items: move(current.items, index, index + by) } : current));
  const remove = (id: string) =>
    update((current) => (current.type === "gallery" ? { ...current, items: current.items.filter((item) => item.id !== id) } : current));
  return (
    <Field label={`Photos (${items.filter((item) => item.media).length})`}>
      <div className="grid grid-cols-4 gap-1.5">
        {items.map((item, index) => (
          <div key={item.id} className="group relative aspect-square overflow-hidden rounded-md border border-white/[0.08] bg-white/[0.04]">
            {item.media ? (
              // eslint-disable-next-line @next/next/no-img-element -- a small thumbnail
              <img src={thumbOf(item.media)} alt="" className="h-full w-full object-cover" />
            ) : (
              <button type="button" onClick={() => pickMedia(`gallery:${item.id}`, "image")} className="flex h-full w-full items-center justify-center text-faint hover:text-cream">
                <ImagePlus size={14} />
              </button>
            )}
            <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/55 opacity-0 transition-opacity group-hover:opacity-100 touch:opacity-100">
              <button type="button" title="Earlier" disabled={index === 0} onClick={() => moveItem(index, -1)} className="p-1 text-white disabled:opacity-30">
                <ArrowUp size={10} className="-rotate-90" />
              </button>
              <button type="button" title="Remove" onClick={() => remove(item.id)} className="p-1 text-white hover:text-red-300">
                <X size={10} />
              </button>
              <button type="button" title="Later" disabled={index === items.length - 1} onClick={() => moveItem(index, 1)} className="p-1 text-white disabled:opacity-30">
                <ArrowDown size={10} className="-rotate-90" />
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => pickMedia("gallery:add", "image")}
          className="flex aspect-square flex-col items-center justify-center gap-0.5 rounded-md border border-dashed border-gold/40 text-[10px] font-medium text-gold hover:bg-gold/[0.06]"
        >
          <Plus size={14} /> Add
        </button>
      </div>
    </Field>
  );
}

const CONTACT_KINDS: { id: ContactKind; label: string }[] = [
  { id: "whatsapp", label: "WhatsApp" },
  { id: "phone", label: "Phone call" },
  { id: "email", label: "Email" },
  { id: "link", label: "Web link" },
];

const VALUE_HINTS: Record<ContactKind, { label: string; placeholder: string }> = {
  whatsapp: { label: "WhatsApp number, with country code", placeholder: "+91 98765 43210" },
  phone: { label: "Phone number", placeholder: "+91 98765 43210" },
  email: { label: "Email address", placeholder: "hello@yourbrand.com" },
  link: { label: "Web address", placeholder: "https://yourbrand.com" },
};

function ContactButtons({
  card,
  update,
  set,
}: {
  card: Extract<LookbookCard, { type: "contact" }>;
  update: InspectorProps["update"];
  set: (patch: Partial<LookbookCard>, key?: string) => void;
}) {
  const setButton = (id: string, patch: Partial<ContactButton>, key?: string) =>
    update(
      (current) => (current.type === "contact" ? { ...current, buttons: current.buttons.map((button) => (button.id === id ? { ...button, ...patch } : button)) } : current),
      key && `${card.id}:button:${id}:${key}`
    );
  const remove = (id: string) =>
    update((current) => (current.type === "contact" ? { ...current, buttons: current.buttons.filter((button) => button.id !== id) } : current));
  const add = () =>
    update((current) =>
      current.type === "contact"
        ? { ...current, buttons: [...current.buttons, { id: uid(), kind: "phone", label: "Call us", value: "", message: "" }] }
        : current
    );

  return (
    <>
      {card.buttons.map((button, index) => (
        <div key={button.id} className="space-y-2 rounded-lg border border-white/[0.08] bg-white/[0.02] p-2.5">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-faint">{index === 0 ? "Main button" : `Button ${index + 1}`}</span>
            <div className="ml-auto w-32">
              <Select value={button.kind} options={CONTACT_KINDS} onChange={(kind) => setButton(button.id, { kind })} />
            </div>
            <button type="button" title="Remove button" onClick={() => remove(button.id)} className="text-faint hover:text-red-400">
              <X size={14} />
            </button>
          </div>
          <TextInput value={button.label} onChange={(label) => setButton(button.id, { label }, "label")} placeholder="Button words" />
          <div className="space-y-1">
            <p className="text-[11px] text-faint">{VALUE_HINTS[button.kind].label}</p>
            <TextInput value={button.value} onChange={(value) => setButton(button.id, { value }, "value")} placeholder={VALUE_HINTS[button.kind].placeholder} type={button.kind === "email" ? "email" : "text"} />
          </div>
          {(button.kind === "whatsapp" || button.kind === "email") && (
            <div className="space-y-1">
              <p className="text-[11px] text-faint">Message it starts with</p>
              <TextArea value={button.message} onChange={(message) => setButton(button.id, { message }, "message")} rows={2} />
            </div>
          )}
        </div>
      ))}
      <button type="button" onClick={add} className="flex items-center gap-1 text-[12px] font-medium text-gold hover:underline">
        <Plus size={13} /> Add a button
      </button>
      <Field label="Keep the main button floating" hint="A WhatsApp-style button stays at the bottom of the screen as clients scroll." inline>
        <Toggle checked={card.floating} onChange={(floating) => set({ floating })} />
      </Field>
    </>
  );
}
