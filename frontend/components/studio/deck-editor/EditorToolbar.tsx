"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlignCenter,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignLeft,
  AlignRight,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  ArrowDownToLine,
  ArrowUpToLine,
  Bold,
  BringToFront,
  ChevronDown,
  Copy,
  Group,
  Italic,
  Lock,
  Minus,
  Plus,
  Redo2,
  Replace,
  SendToBack,
  Trash2,
  Underline,
  Undo2,
  Ungroup,
  Unlock,
  Baseline,
  Blend,
  Move,
  Scan,
  Square,
} from "lucide-react";
import { BRAND_COLORS, FONTS, fontStack, type DesignElement, type ShapeElement, type TextElement } from "@/lib/deckDesign";
import { cn } from "@/lib/utils";
import type { EditorApi } from "./DeckEditor";

/**
 * The bar above the page. What it offers follows the selection — type
 * controls for text, fill and outline for shapes, fit and corners for
 * images — with arrange, group, lock and delete for anything.
 */
export function EditorToolbar({ api, onOpenImages }: { api: EditorApi; onOpenImages: () => void }) {
  const elements = api.selectedElements;
  const texts = elements.filter((element): element is TextElement => element.type === "text");
  const shapes = elements.filter((element): element is ShapeElement => element.type === "shape");
  const images = elements.filter((element) => element.type === "image");
  const allText = elements.length > 0 && texts.length === elements.length;
  const allShapes = elements.length > 0 && shapes.length === elements.length;
  const allImages = elements.length > 0 && images.length === elements.length;
  const first = elements[0];
  const locked = elements.some((element) => element.locked);
  const grouped = elements.some((element) => element.groupId);

  const setText = (patch: Partial<TextElement>) => api.update(texts.map((element) => element.id), patch as Partial<DesignElement>);
  const setShape = (patch: Partial<ShapeElement>) => api.update(shapes.map((element) => element.id), patch as Partial<DesignElement>);

  return (
    <div
      className="flex min-h-11 flex-wrap items-center gap-0.5 border-b border-black/10 bg-white px-2 py-1 text-[12px] text-[#2B2620] md:min-h-12 md:gap-1 md:px-3 md:py-1.5"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Tool title="Undo (Ctrl+Z)" onClick={api.undo} disabled={!api.canUndo}>
        <Undo2 size={15} />
      </Tool>
      <Tool title="Redo (Ctrl+Y)" onClick={api.redo} disabled={!api.canRedo}>
        <Redo2 size={15} />
      </Tool>
      <Divider />

      {elements.length === 0 && <ColorButton brand={api.design.brand?.colors} label="Background" value={api.slide.background} onChange={(color) => api.setBackground(color)} />}

      {allText && first?.type === "text" && (
        <>
          <select
            value={first.fontFamily}
            onChange={(event) => setText({ fontFamily: event.target.value })}
            className="h-7 w-[100px] rounded-md border border-black/15 bg-white px-1.5 text-[12px] focus:outline-none md:h-8 md:w-[150px] md:px-2"
            title="Font"
          >
            {[...new Set([first.fontFamily, ...FONTS])].map((font) => (
              <option key={font} value={font} style={{ fontFamily: fontStack(font) }}>
                {font}
              </option>
            ))}
          </select>
          <div className="flex h-7 items-center rounded-md border border-black/15 md:h-8">
            <button type="button" className="px-1.5 text-black/60 hover:text-black" onClick={() => setText({ fontSize: Math.max(4, Math.round(first.fontSize) - 1) })} title="Smaller">
              <Minus size={12} />
            </button>
            <input
              value={Math.round(first.fontSize * 10) / 10}
              onChange={(event) => {
                const size = Number(event.target.value);
                if (size > 0 && size <= 400) setText({ fontSize: size });
              }}
              className="w-8 bg-transparent text-center text-[12px] focus:outline-none md:w-10"
              title="Font size"
            />
            <button type="button" className="px-1.5 text-black/60 hover:text-black" onClick={() => setText({ fontSize: Math.round(first.fontSize) + 1 })} title="Bigger">
              <Plus size={12} />
            </button>
          </div>
          <ColorButton brand={api.design.brand?.colors} value={first.color} onChange={(color) => setText({ color })} text />
          <Tool title="Bold" active={first.bold} onClick={() => setText({ bold: !first.bold })}>
            <Bold size={15} />
          </Tool>
          <Tool title="Italic" active={first.italic} onClick={() => setText({ italic: !first.italic })}>
            <Italic size={15} />
          </Tool>
          <Tool title="Underline" active={first.underline} onClick={() => setText({ underline: !first.underline })}>
            <Underline size={15} />
          </Tool>
          <Tool title="Upper case" active={first.uppercase} onClick={() => setText({ uppercase: !first.uppercase })}>
            <span className="text-[12px] font-semibold">aA</span>
          </Tool>
          <Tool
            title="Alignment"
            onClick={() => setText({ align: first.align === "left" ? "center" : first.align === "center" ? "right" : "left" })}
          >
            {first.align === "left" ? <AlignLeft size={15} /> : first.align === "center" ? <AlignCenter size={15} /> : <AlignRight size={15} />}
          </Tool>
          <Popover label="Spacing" icon={<Baseline size={15} />}>
            <Slider label="Letter spacing" value={first.letterSpacing} min={-2} max={20} step={0.5} onChange={(letterSpacing) => setText({ letterSpacing })} />
            <Slider label="Line height" value={first.lineHeight} min={0.8} max={3} step={0.05} onChange={(lineHeight) => setText({ lineHeight })} />
          </Popover>
          <Divider />
        </>
      )}

      {allShapes && first?.type === "shape" && (
        <>
          {first.shape !== "line" && <ColorButton brand={api.design.brand?.colors} label="Fill" value={first.fill} onChange={(fill) => setShape({ fill })} allowNone />}
          <ColorButton
            brand={api.design.brand?.colors}
            label={first.shape === "line" ? "Colour" : "Outline"}
            value={first.stroke}
            onChange={(stroke) => setShape({ stroke, strokeWidth: first.strokeWidth || 2 })}
            allowNone={first.shape !== "line"}
          />
          <Popover label="Outline & corners" icon={<Square size={15} />}>
            <Slider label="Outline width" value={first.strokeWidth} min={0} max={24} step={0.5} onChange={(strokeWidth) => setShape({ strokeWidth })} />
            <p className="mb-1 text-[11px] text-black/60">Style</p>
            <div className="mb-2 grid grid-cols-3 gap-1">
              {(["solid", "dash", "dot"] as const).map((dash) => (
                <button
                  key={dash}
                  type="button"
                  onClick={() => setShape({ dash, strokeWidth: first.strokeWidth || 2 })}
                  className={cn(
                    "flex h-7 items-center justify-center rounded-md border",
                    (first.dash ?? "solid") === dash ? "border-[#8B5CF6] bg-[#8B5CF6]/10" : "border-black/10 hover:bg-black/5"
                  )}
                  title={dash === "solid" ? "Solid" : dash === "dash" ? "Dashed" : "Dotted"}
                >
                  <svg width="36" height="4">
                    <line
                      x1="2"
                      y1="2"
                      x2="34"
                      y2="2"
                      stroke="#2B2620"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeDasharray={dash === "dash" ? "7 4" : dash === "dot" ? "0 4" : undefined}
                    />
                  </svg>
                </button>
              ))}
            </div>
            {first.shape === "rect" && <Slider label="Corner rounding" value={first.radius} min={0} max={200} step={1} onChange={(radius) => setShape({ radius })} />}
          </Popover>
          <Divider />
        </>
      )}

      {allImages && first?.type === "image" && (
        <>
          <Tool title="Swap the picture" onClick={onOpenImages}>
            <Replace size={14} />
            <span className="ml-1">Replace</span>
          </Tool>
          <Tool
            title={first.fit === "cover" ? "Fill the frame (crops) — click to show the whole picture" : "Show the whole picture — click to fill the frame"}
            active={first.fit === "cover"}
            onClick={() => api.update(images.map((element) => element.id), { fit: first.fit === "cover" ? "contain" : "cover" } as Partial<DesignElement>)}
          >
            <span>{first.fit === "cover" ? "Fill" : "Fit"}</span>
          </Tool>
          <Popover label="Corners" icon={<Scan size={15} />}>
            <Slider
              label="Corner rounding"
              value={first.radius}
              min={0}
              max={200}
              step={1}
              onChange={(radius) => api.update(images.map((element) => element.id), { radius } as Partial<DesignElement>)}
            />
          </Popover>
          <Divider />
        </>
      )}

      {elements.length > 0 && (
        <>
          <Popover label="Position" icon={<Move size={15} />}>
            <p className="mb-1 text-[10px] uppercase tracking-wider text-black/40">
              Align {elements.length > 1 ? "to each other" : "to the page"}
            </p>
            <div className="grid grid-cols-3 gap-1">
              <MenuTool onClick={() => api.align("left")} icon={<AlignStartVertical size={14} />} label="Left" />
              <MenuTool onClick={() => api.align("center")} icon={<AlignCenterVertical size={14} />} label="Centre" />
              <MenuTool onClick={() => api.align("right")} icon={<AlignEndVertical size={14} />} label="Right" />
              <MenuTool onClick={() => api.align("top")} icon={<AlignStartHorizontal size={14} />} label="Top" />
              <MenuTool onClick={() => api.align("middle")} icon={<AlignCenterHorizontal size={14} />} label="Middle" />
              <MenuTool onClick={() => api.align("bottom")} icon={<AlignEndHorizontal size={14} />} label="Bottom" />
            </div>
            <p className="mb-1 mt-3 text-[10px] uppercase tracking-wider text-black/40">Space evenly (3 or more)</p>
            <div className="grid grid-cols-2 gap-1">
              <MenuTool onClick={() => api.distribute("x")} icon={<AlignHorizontalDistributeCenter size={14} />} label="Across" />
              <MenuTool onClick={() => api.distribute("y")} icon={<AlignVerticalDistributeCenter size={14} />} label="Down" />
            </div>
            <p className="mb-1 mt-3 text-[10px] uppercase tracking-wider text-black/40">Layer</p>
            <div className="grid grid-cols-2 gap-1">
              <MenuTool onClick={() => api.reorder("front")} icon={<BringToFront size={14} />} label="To front" />
              <MenuTool onClick={() => api.reorder("back")} icon={<SendToBack size={14} />} label="To back" />
              <MenuTool onClick={() => api.reorder("forward")} icon={<ArrowUpToLine size={14} />} label="Forward" />
              <MenuTool onClick={() => api.reorder("backward")} icon={<ArrowDownToLine size={14} />} label="Backward" />
            </div>
          </Popover>
          <Popover label="Transparency" icon={<Blend size={15} />}>
            <Slider
              label="Opacity"
              value={Math.round(first.opacity * 100)}
              min={0}
              max={100}
              step={1}
              suffix="%"
              onChange={(value) => api.updateSelected({ opacity: value / 100 })}
            />
            {elements.length === 1 && (
              <Slider label="Rotation" value={first.rotation} min={0} max={359} step={1} suffix="°" onChange={(rotation) => api.updateSelected({ rotation })} />
            )}
          </Popover>
          {elements.length > 1 && !api.isOneGroup && (
            <Tool title="Group (Ctrl+G) — move and resize them as one" onClick={api.group}>
              <Group size={15} />
              <span className="ml-1">Group</span>
            </Tool>
          )}
          {grouped && (
            <Tool title="Ungroup (Ctrl+Shift+G)" onClick={api.ungroup}>
              <Ungroup size={15} />
              <span className="ml-1">Ungroup</span>
            </Tool>
          )}
          <div className="ml-auto flex items-center gap-1">
            <Tool title={locked ? "Unlock" : "Lock in place"} active={locked} onClick={() => api.setLocked(!locked)}>
              {locked ? <Lock size={15} /> : <Unlock size={15} />}
            </Tool>
            <Tool title="Duplicate (Ctrl+D)" onClick={api.duplicateSelected}>
              <Copy size={15} />
            </Tool>
            <Tool title="Delete (Del)" onClick={api.removeSelected} disabled={locked}>
              <Trash2 size={15} />
            </Tool>
          </div>
        </>
      )}
    </div>
  );
}

function Divider() {
  // Phones drop the dividers: the wrapped rows already group the controls.
  return <span className="mx-1 hidden h-5 w-px bg-black/10 md:inline-block" />;
}

function Tool({
  title,
  onClick,
  disabled,
  active,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-7 min-w-7 items-center justify-center rounded-md px-1 text-[12px] transition-colors disabled:opacity-30 md:h-8 md:min-w-8 md:px-1.5",
        active ? "bg-[#8B5CF6]/12 text-[#5B3FB0]" : "text-black/70 hover:bg-black/5 hover:text-black"
      )}
    >
      {children}
    </button>
  );
}

function MenuTool({ onClick, icon, label }: { onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[11px] hover:bg-black/5">
      {icon}
      {label}
    </button>
  );
}

/**
 * A toolbar button's drop-down: whether it is open, closed by a press anywhere
 * outside `ref`, and a `panelRef` for the panel itself.
 */
function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  // Shifted left when it would run off the right edge of a narrow screen.
  const panelRef = (panel: HTMLDivElement | null) => {
    if (!panel) return;
    const overflow = panel.getBoundingClientRect().right - (window.innerWidth - 12);
    if (overflow > 0) panel.style.transform = `translateX(-${overflow}px)`;
  };

  return { open, setOpen, ref, panelRef };
}

/** A button that opens a small panel under it, closed by clicking anywhere else. */
function Popover({ label, icon, children }: { label: string; icon: ReactNode; children: ReactNode }) {
  const { open, setOpen, ref, panelRef } = useDropdown();

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title={label}
        aria-label={label}
        className={cn("flex h-7 min-w-7 items-center justify-center gap-0.5 rounded-md px-1 text-[11px] md:h-8 md:gap-1 md:px-2 md:text-[12px]", open ? "bg-black/5" : "hover:bg-black/5")}
      >
        {/* Phones: just the icon, so the toolbar fits on one line. */}
        <span className="md:hidden">{icon}</span>
        <span className="hidden md:inline">{label}</span>
        <ChevronDown size={12} className="hidden text-black/40 md:block" />
      </button>
      {open && (
        <div
          ref={panelRef}
          className="absolute left-0 top-full z-50 mt-1 w-[240px] max-w-[calc(100vw-24px)] rounded-lg border border-black/10 bg-white p-3 shadow-xl"
        >
          {children}
        </div>
      )}
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix = "",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="mb-2 block text-[11px]">
      <span className="mb-1 flex justify-between text-black/60">
        {label}
        <span className="tabular-nums text-black">
          {Math.round(value * 100) / 100}
          {suffix}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="slim-range w-full"
        style={{ "--fill": `${((value - min) / (max - min)) * 100}%` } as React.CSSProperties}
      />
    </label>
  );
}

const SWATCHES = [...BRAND_COLORS, "#C9A96E", "#8C7853", "#D8CFC4", "#F3E9DC", "#2B2620", "#7A1F2B", "#1F3A5F", "#2F5D50", "#9AA5B1", "#E8D5B7"];

/** Colour choice: the deck's own palette first, then any colour at all. */
function ColorButton({
  label,
  value,
  onChange,
  allowNone,
  text,
  brand = [],
}: {
  label?: string;
  value: string;
  onChange: (color: string) => void;
  allowNone?: boolean;
  text?: boolean;
  /** The deck's brand colours, offered before the standard palette. */
  brand?: string[];
}) {
  const { open, setOpen, ref, panelRef } = useDropdown();
  const none = value === "transparent" || !value;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        title={label ?? "Colour"}
        className="flex h-7 items-center gap-1.5 rounded-md px-1 hover:bg-black/5 md:h-8 md:px-1.5"
      >
        {text ? (
          <span className="flex flex-col items-center leading-none">
            <span className="text-[14px] font-semibold">A</span>
            <span className="mt-0.5 h-1 w-5 rounded-sm border border-black/10" style={{ background: value }} />
          </span>
        ) : (
          <span
            className="h-5 w-5 rounded-full border border-black/15"
            style={{ background: none ? "repeating-conic-gradient(#ddd 0 25%, #fff 0 50%) 50% / 8px 8px" : value }}
          />
        )}
        {label && <span className="hidden text-[12px] md:inline">{label}</span>}
      </button>
      {open && (
        <div
          ref={panelRef}
          className="absolute left-0 top-full z-50 mt-1 w-[212px] rounded-lg border border-black/10 bg-white p-3 shadow-xl">
          <div className="grid grid-cols-6 gap-1.5">
            {allowNone && (
              <button
                type="button"
                title="None"
                onClick={() => onChange("transparent")}
                className={cn("relative h-7 w-7 overflow-hidden rounded-full border", none ? "border-[#8B5CF6] ring-2 ring-[#8B5CF6]/30" : "border-black/15")}
              >
                <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 rotate-45 bg-red-500" />
              </button>
            )}
            {[...new Set([...brand, ...SWATCHES])].map((color) => (
              <button
                key={color}
                type="button"
                title={color}
                onClick={() => onChange(color)}
                className={cn(
                  "h-7 w-7 rounded-full border",
                  value.toLowerCase() === color.toLowerCase() ? "border-[#8B5CF6] ring-2 ring-[#8B5CF6]/30" : "border-black/15"
                )}
                style={{ background: color }}
              />
            ))}
          </div>
          <label className="mt-3 flex items-center gap-2 text-[11px] text-black/60">
            Any colour
            <input
              type="color"
              value={none ? "#ffffff" : toHex(value)}
              onChange={(event) => onChange(event.target.value)}
              className="h-7 w-10 cursor-pointer rounded border border-black/15"
            />
            <input
              key={value}
              defaultValue={value}
              onChange={(event) => /^#[0-9a-f]{6}$/i.test(event.target.value) && onChange(event.target.value)}
              className="w-20 rounded border border-black/15 px-1.5 py-1 font-mono text-[10px]"
            />
          </label>
        </div>
      )}
    </div>
  );
}

function toHex(color: string) {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  if (/^#[0-9a-f]{3}$/i.test(color)) return `#${[...color.slice(1)].map((c) => c + c).join("")}`;
  return "#000000";
}
