"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Copy,
  Files,
  Group,
  Image as ImageIcon,
  Layers,
  Lock,
  Plus,
  Shapes,
  Trash2,
  Type,
  Unlock,
  PaintBucket,
  Stamp,
  Upload,
  X,
  MoreHorizontal,
  ArrowLeft,
  ArrowRight,
  LayoutTemplate,
} from "lucide-react";
import { DECK, type AffinityPiece } from "@/lib/affinity";
import {
  SLIDE_H,
  SLIDE_W,
  describe,
  freeCardSlot,
  imageElement,
  productCard,
  shapeElement,
  slideTitle,
  textElement,
  boundsOf,
  unionBox,
  summarize,
  uid,
  type DesignElement,
  type ShapeElement,
  type ShapeKind,
} from "@/lib/deckDesign";
import { compressGraphic } from "@/lib/image";
import { cn } from "@/lib/utils";
import type { EditorApi } from "./DeckEditor";
import { BackgroundPanel } from "./BackgroundPanel";
import { BrandPanel } from "./BrandPanel";
import { ElementBody, SlideView, elementFrame } from "./SlideView";

export type PanelTab = "pages" | "layers" | "text" | "elements" | "templates" | "images" | "background" | "brand";

const TABS: { id: PanelTab; label: string; icon: typeof Files }[] = [
  { id: "pages", label: "Pages", icon: Files },
  { id: "layers", label: "Layers", icon: Layers },
  { id: "text", label: "Text", icon: Type },
  { id: "elements", label: "Elements", icon: Shapes },
  { id: "templates", label: "Templates", icon: LayoutTemplate },
  { id: "images", label: "Images", icon: ImageIcon },
  { id: "background", label: "Backdrop", icon: PaintBucket },
  { id: "brand", label: "Brand", icon: Stamp },
];

/** The rail of tools down the left, and the panel each one opens. */
export function EditorPanels({
  api,
  pieces,
  tab,
  onTab,
  open,
  onOpenChange,
}: {
  api: EditorApi;
  pieces: AffinityPiece[];
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  /** Below desktop width the panel floats over the page and can be closed; on desktop it is always shown. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    // Phones and tablets: a tab bar along the bottom, opening a sheet above
    // it, so the page keeps the full width. Desktop (1024px and up): the rail
    // down the left with its panel beside it, always open.
    <div className="relative z-20 flex shrink-0 border-t border-black/10 bg-white text-[#2B2620] lg:border-r lg:border-t-0">
      <div className="slim-scrollbar flex w-full flex-row items-center justify-around gap-0.5 overflow-x-auto bg-[#FAF8F5] px-1 py-1 lg:w-[52px] lg:flex-col lg:justify-start lg:border-r lg:border-black/5 lg:px-0 lg:py-1.5">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              // Tapping the open tab again closes it, where the panel can close.
              if (tab === id && open) onOpenChange(false);
              else {
                onTab(id);
                onOpenChange(true);
              }
            }}
            className={cn(
              "flex w-11 shrink-0 flex-col items-center gap-0.5 rounded-md py-1.5 text-[8px] transition-colors",
              tab === id ? "bg-white text-[#6B5D42] shadow-sm" : "text-black/50 hover:bg-white/70 hover:text-black/80"
            )}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      <div
        className={cn(
          "slim-scrollbar z-30 flex-col overflow-y-auto bg-white",
          "absolute bottom-full left-0 right-0 max-h-[42vh] rounded-t-xl border-t border-black/10 shadow-[0_-8px_30px_rgba(0,0,0,0.12)]",
          "lg:static lg:flex lg:max-h-none lg:w-[196px] lg:rounded-none lg:border-t-0 lg:shadow-none",
          open ? "flex" : "hidden"
        )}
      >
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="absolute right-2 top-2 z-20 flex h-6 w-6 items-center justify-center rounded-md text-black/50 hover:bg-black/5 lg:hidden"
          aria-label="Close panel"
        >
          <X size={14} />
        </button>
        {tab === "pages" && <PagesPanel api={api} pieces={pieces} open={open} />}
        {tab === "layers" && <LayersPanel api={api} pieces={pieces} />}
        {tab === "text" && <TextPanel api={api} />}
        {tab === "elements" && <ElementsPanel api={api} />}
        {tab === "templates" && <TemplatesPanel api={api} onTab={onTab} />}
        {tab === "images" && <ImagesPanel api={api} pieces={pieces} />}
        {tab === "background" && <BackgroundPanel api={api} pieces={pieces} />}
        {tab === "brand" && <BrandPanel api={api} />}
      </div>
    </div>
  );
}

function PanelTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    // Room on the right below desktop width, where the panel's close button sits.
    <div className="sticky top-0 z-10 flex items-center justify-between bg-white pb-1.5 pl-2.5 pr-10 pt-2 lg:pr-2.5">
      <p className="text-[12px] font-semibold">{children}</p>
      {action}
    </div>
  );
}

/* ── Pages ─────────────────────────────────────────────────────────────── */

function PagesPanel({ api, pieces, open }: { api: EditorApi; pieces: AffinityPiece[]; /** Whether the panel is showing below desktop width — see EditorPanels. */ open: boolean }) {
  /** The page whose ⋯ menu is open on a phone, and where to draw it on screen. */
  const [menu, setMenu] = useState<{ index: number; x: number; y: number } | null>(null);
  // Below desktop width the pages run in a sideways row, with smaller thumbnails so more of it fits.
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 1023px)");
    const sync = () => setNarrow(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  const thumbScale = (narrow ? 120 : 168) / SLIDE_W;

  /*
   * Reordering by pointer rather than HTML drag-and-drop, which touch screens
   * never fire. A mouse picks a page up once it moves a few pixels; a finger
   * after a short press-and-hold, so an ordinary swipe still scrolls the row.
   * `insertAt` is the gap the page will land in: 0 is before the first page,
   * n is after the last.
   */
  const [drag, setDragState] = useState<{ from: number; insertAt: number; x: number; y: number } | null>(null);
  // Mirrored in a ref so the drop reads it directly: a state updater can run
  // twice in development, and must not move the page twice.
  const dragRef = useRef<typeof drag>(null);
  const setDrag = (next: typeof drag) => {
    dragRef.current = next;
    setDragState(next);
  };
  const listRef = useRef<HTMLOListElement>(null);
  const pending = useRef<{ index: number; x: number; y: number; touch: boolean; timer?: number; started: boolean } | null>(null);
  /** Swallows the click a drop would otherwise turn into "open this page". */
  const justDropped = useRef(false);

  const gapAt = (x: number, y: number) => {
    const items = [...(listRef.current?.querySelectorAll<HTMLElement>(":scope > li:not([data-slot])") ?? [])];
    const across = narrow; // the phone and tablet row runs sideways
    const at = items.findIndex((item) => {
      const box = item.getBoundingClientRect();
      return across ? x < box.left + box.width / 2 : y < box.top + box.height / 2;
    });
    return at === -1 ? items.length : at;
  };

  useEffect(() => {
    const list = listRef.current;
    // While a page is held, the finger moves it rather than scrolling the row.
    const blockScroll = (event: TouchEvent) => {
      if (pending.current?.started) event.preventDefault();
    };
    list?.addEventListener("touchmove", blockScroll, { passive: false });

    const move = (event: PointerEvent) => {
      const press = pending.current;
      if (!press) return;
      const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y);
      if (!press.started) {
        if (press.touch) {
          // Moving before the hold completes is a swipe: let it scroll.
          if (moved > 8) {
            window.clearTimeout(press.timer);
            pending.current = null;
          }
          return;
        }
        if (moved < 5) return;
        press.started = true;
      }
      setDrag({ from: press.index, insertAt: gapAt(event.clientX, event.clientY), x: event.clientX, y: event.clientY });
      // Near either end of the row, keep it scrolling towards the pointer.
      if (narrow && list) {
        const box = list.getBoundingClientRect();
        if (event.clientX < box.left + 32) list.scrollLeft -= 10;
        else if (event.clientX > box.right - 32) list.scrollLeft += 10;
      }
    };
    const end = () => {
      const press = pending.current;
      pending.current = null;
      if (press) window.clearTimeout(press.timer);
      const current = dragRef.current;
      if (press?.started && current) {
        justDropped.current = true;
        window.setTimeout(() => (justDropped.current = false), 0);
        const to = current.insertAt > current.from ? current.insertAt - 1 : current.insertAt;
        if (to !== current.from) api.moveSlide(current.from, to);
      }
      if (current) setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      list?.removeEventListener("touchmove", blockScroll);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- gapAt reads only the DOM and `narrow`
  }, [api, narrow]);

  // The gap the page would land in, marked only where dropping would move it.
  const slot = drag && drag.insertAt !== drag.from && drag.insertAt !== drag.from + 1 ? drag.insertAt : null;

  const pickUp = (event: React.PointerEvent, index: number) => {
    if (event.button !== 0) return;
    const touch = event.pointerType !== "mouse";
    const press: NonNullable<typeof pending.current> = { index, x: event.clientX, y: event.clientY, touch, started: false };
    if (touch) {
      press.timer = window.setTimeout(() => {
        press.started = true;
        navigator.vibrate?.(15);
        setDrag({ from: index, insertAt: index, x: press.x, y: press.y });
      }, 280);
    }
    pending.current = press;
  };

  /*
   * The page being edited always stays in view in this list — after the
   * arrows, Page Up/Down, scrolling the stage, adding or moving a page, or
   * opening this panel. Only the list's own scroller moves (the sideways row
   * on a phone, the panel column elsewhere), never the page around it:
   * instantly as the panel appears, smoothly after that.
   */
  const shown = useRef(false);
  useEffect(() => {
    const item = listRef.current?.querySelector<HTMLElement>(`:scope > li[data-page="${api.active}"]`);
    if (!item) return;
    const across = narrow;
    let scroller: HTMLElement | null = null;
    for (let node = item.parentElement; node; node = node.parentElement) {
      const overflow = getComputedStyle(node)[across ? "overflowX" : "overflowY"];
      if (overflow === "auto" || overflow === "scroll") {
        scroller = node;
        break;
      }
    }
    // A closed panel has no layout to scroll; it is revealed when it opens.
    if (!scroller || item.offsetParent === null || scroller.clientHeight === 0) {
      shown.current = false;
      return;
    }
    const box = scroller.getBoundingClientRect();
    const rect = item.getBoundingClientRect();
    // The panel title sticks over the top of the column.
    const inset = across ? 0 : scroller.querySelector<HTMLElement>(":scope > .sticky")?.offsetHeight ?? 0;
    const gap = 8;
    let delta = 0;
    if (across) {
      if (rect.left < box.left + gap) delta = rect.left - box.left - gap;
      else if (rect.right > box.right - gap) delta = rect.right - box.right + gap;
    } else if (rect.top < box.top + inset + gap) delta = rect.top - box.top - inset - gap;
    else if (rect.bottom > box.bottom - gap) delta = rect.bottom - box.bottom + gap;
    // A hidden tab never runs a smooth scroll to the end, so it jumps there.
    const behavior: ScrollBehavior = shown.current && document.visibilityState === "visible" ? "smooth" : "auto";
    shown.current = true;
    if (delta) scroller.scrollBy(across ? { left: delta, behavior } : { top: delta, behavior });
  }, [api.active, api.design.slides.length, narrow, open]);

  return (
    <>
      <PanelTitle
        action={
          <button
            type="button"
            onClick={() => api.addSlide()}
            className="flex items-center gap-1 rounded-md bg-[#6B5D42] px-2 py-1 text-[10px] font-medium text-white hover:opacity-90"
          >
            <Plus size={11} /> Add page
          </button>
        }
      >
        {api.design.slides.length} pages
      </PanelTitle>

      {/* Phones and tablets: one compact row that scrolls sideways; desktop: a column. */}
      <ol ref={listRef} className="slim-scrollbar flex gap-2 overflow-x-auto px-2.5 pb-3 lg:block lg:space-y-1.5 lg:overflow-visible">
        {api.design.slides.map((slide, index) => (
          <Fragment key={slide.id}>
          {slot === index && <DropSlot narrow={narrow} />}
          <li
            data-page={index}
            className={cn(
              "group/page relative w-[124px] shrink-0 select-none transition-opacity lg:w-auto",
              drag?.from === index && "opacity-40"
            )}
          >
            <button
              type="button"
              onPointerDown={(event) => pickUp(event, index)}
              onContextMenu={(event) => event.preventDefault()}
              onClick={() => {
                if (!justDropped.current) api.setActive(index);
              }}
              className={cn(
                "block w-full overflow-hidden rounded-md border-2 text-left transition-colors",
                api.active === index ? "border-[#8B5CF6]" : "border-transparent hover:border-black/15"
              )}
              title="Open this page — drag to reorder"
            >
              <div className="pointer-events-none" style={{ width: SLIDE_W * thumbScale, height: SLIDE_H * thumbScale }}>
                <SlideView slide={slide} pieces={pieces} scale={thumbScale} className="border border-black/5" />
              </div>
            </button>
            <div className="mt-0.5 flex items-start gap-1">
              <span className="mt-px text-[10px] font-semibold text-black/40">{index + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[10px] font-medium leading-tight">{slideTitle(slide)}</p>
                <p className="truncate text-[9px] leading-tight text-black/45">{summarize(slide)}</p>
              </div>
              {/* Phones: one ⋯ button beside the name, always there since there is no hover. */}
              <button
                type="button"
                title="Page options"
                aria-label="Page options"
                onClick={(event) => {
                  const box = event.currentTarget.getBoundingClientRect();
                  setMenu(menu?.index === index ? null : { index, x: box.right, y: box.top });
                }}
                className="-mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-black/60 hover:bg-black/5 lg:hidden"
              >
                <MoreHorizontal size={14} />
              </button>
            </div>
            <div className="absolute right-1 top-1 hidden gap-0.5 opacity-0 transition-opacity group-hover/page:opacity-100 lg:flex">
              <MiniButton title="Duplicate page" onClick={() => api.duplicateSlide(index)}>
                <Copy size={11} />
              </MiniButton>
              <MiniButton title="Delete page" onClick={() => api.removeSlide(index)} disabled={api.design.slides.length <= 1}>
                <Trash2 size={11} />
              </MiniButton>
            </div>
          </li>
          </Fragment>
        ))}
        {slot === api.design.slides.length && <DropSlot narrow={narrow} />}
      </ol>

      {/* A small copy of the held page that follows the finger or cursor. */}
      {drag &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[70] rotate-2 overflow-hidden rounded-md border-2 border-[#8B5CF6] bg-white opacity-90 shadow-2xl"
            // Held just above the finger, so the finger never hides it.
            style={{ left: drag.x - 50, top: drag.y - 72 }}
          >
            <SlideView slide={api.design.slides[drag.from]} pieces={pieces} scale={100 / SLIDE_W} />
          </div>,
          document.body
        )}

      {/* Portalled to the body: the panel scrolls, and would clip it. */}
      {menu &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[60]" onClick={() => setMenu(null)} />
            <div
              className="fixed z-[61] w-40 rounded-lg border border-black/10 bg-white py-1 text-[12px] shadow-xl"
              // Opens upward from the button: the sheet sits at the bottom of the screen.
              style={{ left: Math.max(8, Math.min(menu.x - 160, window.innerWidth - 168)), bottom: window.innerHeight - menu.y + 4 }}
            >
              {[
                { label: "Move left", icon: <ArrowLeft size={13} />, run: () => api.moveSlide(menu.index, menu.index - 1), disabled: menu.index === 0 },
                { label: "Move right", icon: <ArrowRight size={13} />, run: () => api.moveSlide(menu.index, menu.index + 1), disabled: menu.index === api.design.slides.length - 1 },
                { label: "Duplicate", icon: <Copy size={13} />, run: () => api.duplicateSlide(menu.index) },
                { label: "Delete", icon: <Trash2 size={13} />, run: () => api.removeSlide(menu.index), disabled: api.design.slides.length <= 1, danger: true },
              ].map((item) => (
                <button
                  key={item.label}
                  type="button"
                  disabled={item.disabled}
                  onClick={() => {
                    item.run();
                    setMenu(null);
                  }}
                  className={cn("flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-black/5 disabled:opacity-30", item.danger && "text-red-600")}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </div>
          </>,
          document.body
        )}

      <button
        type="button"
        onClick={() => api.addSlide(api.design.slides.length)}
        className="mx-2.5 mb-3 hidden items-center lg:flex justify-center gap-1 rounded-md border border-dashed border-black/20 py-1.5 text-[10px] text-black/55 hover:border-[#6B5D42] hover:text-[#6B5D42]"
      >
        <Plus size={12} /> Add a blank page at the end
      </button>
    </>
  );
}

/** The line that marks the gap a dragged page will land in, with a dot at each end. */
function DropSlot({ narrow }: { narrow: boolean }) {
  return (
    <li
      data-slot
      aria-hidden
      className={cn("relative shrink-0 rounded-full bg-[#8B5CF6]", narrow ? "-mx-1 h-[71px] w-[3px]" : "-my-0.5 h-[3px] w-full")}
    >
      <span className={cn("absolute h-2 w-2 rounded-full bg-[#8B5CF6]", narrow ? "-top-1 left-1/2 -translate-x-1/2" : "-left-1 top-1/2 -translate-y-1/2")} />
      <span className={cn("absolute h-2 w-2 rounded-full bg-[#8B5CF6]", narrow ? "-bottom-1 left-1/2 -translate-x-1/2" : "-right-1 top-1/2 -translate-y-1/2")} />
    </li>
  );
}

function MiniButton({ title, onClick, disabled, children }: { title: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      className="flex h-6 w-6 items-center justify-center rounded bg-white/95 text-black/60 shadow-sm hover:text-black disabled:opacity-30"
    >
      {children}
    </button>
  );
}

/* ── Layers ────────────────────────────────────────────────────────────── */

function LayersPanel({ api, pieces }: { api: EditorApi; pieces: AffinityPiece[] }) {
  const elements = api.slide.elements;
  const [dragFrom, setDragFrom] = useState<string | null>(null);
  // Top of the list is the front of the page — the reverse of the array.
  const listed = [...elements].reverse();

  return (
    <>
      <PanelTitle>
        Page {api.active + 1} · {elements.length} layer{elements.length === 1 ? "" : "s"}
      </PanelTitle>
      {elements.length === 0 && <p className="px-3 text-[11px] text-black/45">Nothing on this page yet — add text, shapes or images.</p>}
      <ul className="space-y-0.5 px-2 pb-4">
        {listed.map((element) => {
          const isSelected = api.selected.includes(element.id);
          return (
            <li
              key={element.id}
              draggable
              onDragStart={() => setDragFrom(element.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (dragFrom && dragFrom !== element.id) api.moveLayer(dragFrom, elements.findIndex((entry) => entry.id === element.id));
                setDragFrom(null);
              }}
              onClick={(event) =>
                api.setSelected(
                  event.shiftKey || event.ctrlKey || event.metaKey
                    ? isSelected
                      ? api.selected.filter((id) => id !== element.id)
                      : [...api.selected, element.id]
                    : [element.id]
                )
              }
              className={cn(
                "group/layer flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[11px]",
                isSelected ? "bg-[#8B5CF6]/10" : "hover:bg-black/5"
              )}
            >
              <span className="relative flex h-8 w-12 shrink-0 items-center justify-center overflow-hidden rounded border border-black/10 bg-white">
                <LayerThumb element={element} pieces={pieces} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{describe(element)}</span>
                {element.groupId && (
                  <span className="flex items-center gap-1 text-[9px] text-black/40">
                    <Group size={9} /> In a group
                  </span>
                )}
              </span>
              <button
                type="button"
                title={element.locked ? "Unlock" : "Lock"}
                onClick={(event) => {
                  event.stopPropagation();
                  api.update([element.id], { locked: !element.locked });
                }}
                className={cn("text-black/40 hover:text-black", !element.locked && "opacity-0 group-hover/layer:opacity-100")}
              >
                {element.locked ? <Lock size={11} /> : <Unlock size={11} />}
              </button>
              <button
                type="button"
                title="Delete"
                onClick={(event) => {
                  event.stopPropagation();
                  api.removeElement(element.id);
                }}
                className="text-black/40 opacity-0 hover:text-red-600 group-hover/layer:opacity-100"
              >
                <Trash2 size={11} />
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** A tiny stand-in for one element, fitted into the layers list's swatch. */
function LayerThumb({ element, pieces }: { element: DesignElement; pieces: AffinityPiece[] }) {
  if (element.type === "text") return <Type size={13} className="text-black/45" />;
  const scale = Math.min(44 / Math.max(element.w, 1), 28 / Math.max(element.h, 1));
  return (
    <div style={{ width: element.w * scale, height: element.h * scale, position: "relative" }}>
      <div style={{ width: element.w, height: element.h, transform: `scale(${scale})`, transformOrigin: "0 0", position: "absolute" }}>
        <ElementBody element={element} pieces={pieces} />
      </div>
    </div>
  );
}

/* ── Text ──────────────────────────────────────────────────────────────── */

function TextPanel({ api }: { api: EditorApi }) {
  const presets = [
    { label: "Add a heading", style: "text-[16px] font-normal lg:text-[22px]", font: "Cambria", preset: { text: "", fontSize: 56, color: DECK.titleGold, w: 720, placeholder: "Heading" } },
    { label: "Add a subheading", style: "text-[13px] lg:text-[16px]", font: "Cambria", preset: { text: "", fontSize: 30, italic: true, w: 600, placeholder: "Subheading" } },
    {
      label: "Add body text",
      style: "text-[11px] lg:text-[12px]",
      font: "Helvetica",
      preset: { text: "", fontFamily: "Helvetica", fontSize: 18, w: 520, lineHeight: 1.5, placeholder: "Body text" },
    },
    {
      label: "ADD A CAPTION",
      style: "text-[9px] tracking-[0.2em] lg:text-[10px] lg:tracking-[0.25em]",
      font: "Helvetica",
      preset: { text: "", fontFamily: "Helvetica", fontSize: 13, uppercase: true, letterSpacing: 3, w: 420, placeholder: "Caption" },
    },
  ];

  return (
    <>
      <PanelTitle>Text</PanelTitle>
      <div className="space-y-2 px-3 pb-4">
        <button
          type="button"
          onClick={() => api.addText({ text: "", fontFamily: "Helvetica", fontSize: 20, placeholder: "Your text" })}
          className="flex w-full items-center justify-center gap-1.5 rounded-md bg-[#6B5D42] py-1.5 text-[12px] font-medium text-white hover:opacity-90 lg:py-2"
        >
          <Type size={13} /> Add a text box
        </button>
        <p className="pt-1 text-[10px] uppercase tracking-wider text-black/40">Default styles</p>
        {/* Phones: two to a row in smaller type; wider screens: one per row. */}
        <div className="grid grid-cols-2 gap-1.5 md:grid-cols-4 lg:grid-cols-1 lg:gap-2">
          {presets.map(({ label, style, font, preset }) => (
            <button
              key={label}
              type="button"
              onClick={() => api.addText(preset)}
              className={cn(
                "w-full truncate rounded-md border border-black/10 px-2.5 py-2 text-left hover:border-[#6B5D42]/50 hover:bg-[#F7F2EC] lg:px-3 lg:py-2.5",
                style
              )}
              style={{ fontFamily: `"${font}", Georgia, serif` }}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="pt-2 text-[10px] max-lg:hidden leading-relaxed text-black/45">
          Double-click any text on the page to edit it. Drag a text box&apos;s corner to scale the type, or its sides to rewrap it.
        </p>
      </div>
    </>
  );
}

/* ── Elements ──────────────────────────────────────────────────────────── */

type Preset = { label: string; make: () => DesignElement[] };

const GOLD = DECK.borderGold;
const at = (w: number, h: number) => ({ x: Math.round((SLIDE_W - w) / 2), y: Math.round((SLIDE_H - h) / 2), w, h });
const filled = (shape: ShapeKind, w: number, h: number, extra: Partial<ShapeElement> = {}) => () => [
  shapeElement({ ...at(w, h), shape, fill: GOLD, ...extra }),
];
const outlined = (shape: ShapeKind, w: number, h: number, extra: Partial<ShapeElement> = {}) => () => [
  shapeElement({ ...at(w, h), shape, fill: "transparent", stroke: GOLD, strokeWidth: 2, ...extra }),
];
const line = (extra: Partial<ShapeElement> = {}, w = 320) => () => [
  shapeElement({ ...at(w, 6), shape: "line", fill: "transparent", stroke: GOLD, strokeWidth: 2, ...extra }),
];

/** Shapes and text that belong together, placed as one group. */
function grouped(...make: ((group: string) => DesignElement)[]) {
  return () => {
    const group = uid();
    return make.map((build) => build(group));
  };
}

const SECTIONS: { title: string; presets: Preset[] }[] = [
  {
    title: "Shapes",
    presets: [
      { label: "Square", make: filled("rect", 200, 200) },
      { label: "Rounded", make: filled("rect", 240, 170, { radius: 28 }) },
      { label: "Pill", make: filled("rect", 260, 80, { radius: 40 }) },
      { label: "Circle", make: filled("ellipse", 200, 200) },
      { label: "Oval", make: filled("ellipse", 260, 160) },
      { label: "Triangle", make: filled("triangle", 180, 160) },
      { label: "Diamond", make: filled("diamond", 140, 140) },
      { label: "Star", make: filled("star", 180, 180) },
      { label: "Sparkle", make: filled("sparkle", 90, 90) },
      { label: "Hexagon", make: filled("hexagon", 200, 176) },
      { label: "Octagon", make: filled("octagon", 180, 180) },
      { label: "Heart", make: filled("heart", 180, 165) },
      { label: "Arrow", make: filled("arrow", 220, 120) },
      { label: "Chevron", make: filled("chevron", 200, 120) },
      { label: "Plus", make: filled("plus", 150, 150) },
      { label: "Slant", make: filled("parallelogram", 240, 130) },
    ],
  },
  {
    title: "Outlines",
    presets: [
      { label: "Box", make: outlined("rect", 240, 170) },
      { label: "Rounded", make: outlined("rect", 240, 170, { radius: 28 }) },
      { label: "Circle", make: outlined("ellipse", 200, 200) },
      { label: "Diamond", make: outlined("diamond", 140, 140) },
      { label: "Star", make: outlined("star", 180, 180) },
      { label: "Hexagon", make: outlined("hexagon", 200, 176) },
      { label: "Dashed box", make: outlined("rect", 240, 170, { dash: "dash" }) },
      { label: "Dotted ring", make: outlined("ellipse", 200, 200, { dash: "dot", strokeWidth: 3 }) },
      { label: "Heart", make: outlined("heart", 180, 165) },
    ],
  },
  {
    title: "Lines",
    presets: [
      { label: "Line", make: line() },
      { label: "Thick", make: line({ strokeWidth: 6 }) },
      { label: "Dashed", make: line({ dash: "dash" }) },
      { label: "Dotted", make: line({ dash: "dot", strokeWidth: 3 }) },
      {
        label: "Vertical",
        make: () => [shapeElement({ ...at(320, 6), shape: "line", fill: "transparent", stroke: GOLD, strokeWidth: 2, rotation: 90 })],
      },
      {
        label: "Double",
        make: grouped(
          (group) => shapeElement({ ...at(320, 4), y: 352, shape: "line", fill: "transparent", stroke: GOLD, strokeWidth: 1.5, groupId: group }),
          (group) => shapeElement({ ...at(320, 4), y: 362, shape: "line", fill: "transparent", stroke: GOLD, strokeWidth: 1.5, groupId: group })
        ),
      },
      {
        label: "Divider",
        make: grouped(
          (group) => shapeElement({ x: 552, y: 359, w: 72, h: 2, shape: "line", stroke: GOLD, strokeWidth: 1.5, fill: "transparent", groupId: group }),
          (group) => shapeElement({ x: 634, y: 354, w: 12, h: 12, shape: "diamond", fill: GOLD, groupId: group }),
          (group) => shapeElement({ x: 656, y: 359, w: 72, h: 2, shape: "line", stroke: GOLD, strokeWidth: 1.5, fill: "transparent", groupId: group })
        ),
      },
      {
        label: "Sparkle rule",
        make: grouped(
          (group) => shapeElement({ x: 500, y: 359, w: 120, h: 2, shape: "line", stroke: GOLD, strokeWidth: 1, fill: "transparent", groupId: group }),
          (group) => shapeElement({ x: 628, y: 348, w: 24, h: 24, shape: "sparkle", fill: GOLD, groupId: group }),
          (group) => shapeElement({ x: 660, y: 359, w: 120, h: 2, shape: "line", stroke: GOLD, strokeWidth: 1, fill: "transparent", groupId: group })
        ),
      },
      {
        label: "Arrow line",
        make: grouped(
          (group) => shapeElement({ x: 480, y: 359, w: 300, h: 2, shape: "line", stroke: GOLD, strokeWidth: 2, fill: "transparent", groupId: group }),
          (group) => shapeElement({ x: 772, y: 352, w: 16, h: 16, shape: "chevron", fill: GOLD, groupId: group })
        ),
      },
    ],
  },
  {
    title: "Frames",
    presets: [
      {
        label: "Page frame",
        make: () => [
          shapeElement({ x: 24, y: 24, w: SLIDE_W - 48, h: SLIDE_H - 48, fill: "transparent", stroke: GOLD, strokeWidth: 1.5, name: "Frame" }),
        ],
      },
      {
        label: "Double frame",
        make: grouped(
          (group) =>
            shapeElement({ x: 20, y: 20, w: SLIDE_W - 40, h: SLIDE_H - 40, fill: "transparent", stroke: GOLD, strokeWidth: 1.5, groupId: group, name: "Frame" }),
          (group) =>
            shapeElement({ x: 32, y: 32, w: SLIDE_W - 64, h: SLIDE_H - 64, fill: "transparent", stroke: GOLD, strokeWidth: 0.75, groupId: group, name: "Frame" })
        ),
      },
      {
        label: "Photo frame",
        make: grouped(
          (group) => shapeElement({ ...at(340, 420), fill: "#FFFFFF", stroke: GOLD, strokeWidth: 1.5, groupId: group }),
          (group) => imageElement({ ...at(300, 380), fit: "cover", groupId: group, name: "Photo" })
        ),
      },
      {
        label: "Round photo",
        make: grouped(
          (group) => shapeElement({ ...at(300, 300), shape: "ellipse", fill: "transparent", stroke: GOLD, strokeWidth: 2, groupId: group }),
          (group) => imageElement({ ...at(276, 276), fit: "cover", radius: 138, groupId: group, name: "Photo" })
        ),
      },
      {
        label: "Panel",
        make: () => [shapeElement({ x: 0, y: 0, w: Math.round(SLIDE_W * 0.42), h: SLIDE_H, fill: DECK.cream, name: "Panel" })],
      },
      {
        label: "Band",
        make: () => [shapeElement({ x: 0, y: SLIDE_H - 120, w: SLIDE_W, h: 120, fill: DECK.cream, name: "Band" })],
      },
    ],
  },
  {
    title: "Labels & badges",
    presets: [
      {
        label: "Tag",
        make: grouped(
          (group) => shapeElement({ ...at(180, 48), fill: DECK.titleGold, radius: 24, groupId: group }),
          (group) =>
            textElement({
              ...at(180, 22),
              text: "NEW",
              fontFamily: "Helvetica",
              fontSize: 16,
              bold: true,
              letterSpacing: 4,
              align: "center",
              color: "#FFFFFF",
              groupId: group,
            })
        ),
      },
      {
        label: "Number",
        make: grouped(
          (group) => shapeElement({ ...at(96, 96), shape: "ellipse", fill: "transparent", stroke: GOLD, strokeWidth: 2, groupId: group }),
          (group) => textElement({ ...at(96, 46), text: "01", fontSize: 36, align: "center", color: DECK.titleGold, groupId: group })
        ),
      },
      {
        label: "Price",
        make: grouped(
          (group) => shapeElement({ ...at(260, 64), fill: DECK.cream, stroke: GOLD, strokeWidth: 1.5, groupId: group }),
          (group) => textElement({ ...at(260, 34), text: "₹ 00,000", fontSize: 26, align: "center", color: DECK.titleGold, groupId: group })
        ),
      },
      {
        label: "Badge",
        make: grouped(
          (group) => shapeElement({ ...at(150, 150), shape: "star", fill: DECK.titleGold, groupId: group }),
          (group) =>
            textElement({
              ...at(150, 16),
              text: "BEST",
              fontFamily: "Helvetica",
              fontSize: 13,
              bold: true,
              letterSpacing: 2,
              align: "center",
              color: "#FFFFFF",
              groupId: group,
            })
        ),
      },
      {
        label: "Heading",
        make: grouped(
          (group) => textElement({ ...at(560, 64), y: 300, text: "Section Title", fontSize: 48, align: "center", color: DECK.titleGold, groupId: group }),
          (group) => shapeElement({ x: 552, y: 389, w: 72, h: 2, shape: "line", stroke: GOLD, strokeWidth: 1.5, fill: "transparent", groupId: group }),
          (group) => shapeElement({ x: 634, y: 384, w: 12, h: 12, shape: "diamond", fill: GOLD, groupId: group }),
          (group) => shapeElement({ x: 656, y: 389, w: 72, h: 2, shape: "line", stroke: GOLD, strokeWidth: 1.5, fill: "transparent", groupId: group })
        ),
      },
      {
        label: "Quote",
        make: grouped(
          (group) => textElement({ x: 340, y: 230, w: 100, h: 110, text: "“", fontSize: 120, color: GOLD, groupId: group }),
          (group) =>
            textElement({
              x: 400,
              y: 300,
              w: 520,
              h: 90,
              text: "Crafted to be cherished for generations.",
              fontSize: 32,
              italic: true,
              lineHeight: 1.35,
              color: DECK.ink,
              groupId: group,
            })
        ),
      },
      {
        label: "Spec card",
        make: grouped(
          (group) => shapeElement({ ...at(320, 180), fill: "#FFFFFF", stroke: GOLD, strokeWidth: 1, radius: 8, groupId: group }),
          (group) =>
            textElement({
              x: 500,
              y: 290,
              w: 280,
              h: 22,
              text: "SPECIFICATIONS",
              fontFamily: "Helvetica",
              fontSize: 12,
              letterSpacing: 3,
              bold: true,
              color: DECK.titleGold,
              groupId: group,
            }),
          (group) =>
            textElement({
              x: 500,
              y: 322,
              w: 280,
              h: 100,
              text: "Metal: 18K Yellow Gold\nWeight: 0.00 g\nDiamonds: 0.00 ct",
              fontFamily: "Helvetica",
              fontSize: 14,
              lineHeight: 1.6,
              color: DECK.ink,
              groupId: group,
            })
        ),
      },
      {
        label: "Caption bar",
        make: grouped(
          (group) => shapeElement({ ...at(420, 56), fill: "#FFFFFF", opacity: 0.9, groupId: group }),
          (group) =>
            textElement({
              ...at(420, 20),
              text: "COLLECTION 2026",
              fontFamily: "Helvetica",
              fontSize: 14,
              letterSpacing: 4,
              align: "center",
              color: DECK.ink,
              groupId: group,
            })
        ),
      },
    ],
  },
];

/** Shapes shown per section on a phone before "See all" — two rows of six. */
const PHONE_PREVIEW = 12;

function ElementsPanel({ api }: { api: EditorApi }) {
  const [expanded, setExpanded] = useState<string[]>([]);
  return (
    <>
      <PanelTitle>Elements</PanelTitle>
      <div className="space-y-3 px-2.5 pb-4">
        {SECTIONS.map((section) => (
          <div key={section.title}>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-[10px] uppercase tracking-wider text-black/40">{section.title}</p>
              {section.presets.length > PHONE_PREVIEW && (
                <button
                  type="button"
                  onClick={() =>
                    setExpanded((open) => (open.includes(section.title) ? open.filter((t) => t !== section.title) : [...open, section.title]))
                  }
                  className="text-[10px] font-medium text-[#6B5D42] md:hidden"
                >
                  {expanded.includes(section.title) ? "Show less" : `See all (${section.presets.length})`}
                </button>
              )}
            </div>
            {/* Phones get the panel full-width, so small tiles, six to a row, two rows until "See all". */}
            <div className="grid grid-cols-6 gap-1 md:grid-cols-10 lg:grid-cols-3 lg:gap-1.5">
              {section.presets.map((preset, index) => (
                <button
                  key={section.title + preset.label}
                  type="button"
                  onClick={() => api.addElements(preset.make())}
                  title={`Add ${preset.label.toLowerCase()}`}
                  className={cn(
                    "flex aspect-square flex-col items-center justify-center gap-0.5 rounded-md border border-black/10 p-0.5 text-[8px] text-black/55 lg:gap-1 lg:p-1 lg:text-[9px] hover:border-[#6B5D42]/50 hover:bg-[#F7F2EC]",
                    index >= PHONE_PREVIEW && !expanded.includes(section.title) && "max-md:hidden"
                  )}
                >
                  <PresetPreview make={preset.make} />
                  <span className="w-full truncate text-center leading-none">{preset.label}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        <p className="text-[10px] leading-relaxed text-black/45">
          Everything here can be changed once placed — colours, outlines and text in the bar above the page. Grouped ones move
          together; double-click to change one part.
        </p>
      </div>
    </>
  );
}

/** A preset drawn small from the very elements it adds, so the tile is what you get. */
function PresetPreview({ make, size = 34 }: { make: () => DesignElement[]; size?: number }) {
  const [elements] = useState(make);
  const box = unionBox(elements.map(boundsOf)) ?? { x: 0, y: 0, w: 1, h: 1 };
  const scale = Math.min(size / Math.max(box.w, 1), size / Math.max(box.h, 1));
  return (
    // A shape tile is a touch smaller on phones, where six of them share a row.
    <span
      className={cn("pointer-events-none relative block shrink-0", size === 34 && "max-md:-my-1 max-md:scale-75")}
      style={{ width: size, height: size }}
    >
      <span
        className="absolute block"
        style={{
          width: box.w,
          height: box.h,
          left: (size - box.w * scale) / 2,
          top: (size - box.h * scale) / 2,
          transform: `scale(${scale})`,
          transformOrigin: "0 0",
        }}
      >
        {elements.map((element) => (
          <span key={element.id} style={{ ...elementFrame({ ...element, x: element.x - box.x, y: element.y - box.y }), display: "block" }}>
            {/* Shrunk this far a 2px line would vanish, so strokes are drawn at least ~1.4px on screen. */}
            <ElementBody
              element={
                element.type === "shape" && element.strokeWidth > 0
                  ? { ...element, strokeWidth: Math.max(element.strokeWidth, 1.4 / scale) }
                  : element
              }
              pieces={[]}
            />
          </span>
        ))}
      </span>
    </span>
  );
}

/* ── Templates ─────────────────────────────────────────────────────────── */

/** What the tile shows: the card with sample words in it, so its layout reads at a glance. */
const SAMPLE_CARD = () =>
  productCard({ x: 0, y: 0, label: "Pendant", code: "DPF-0000", title: "Product name", caption: "Metal · stones · total weight" });

/**
 * Ready-made blocks for the page. A product card is the deck's own card —
 * same size, fonts and spacing — so an extra piece or two slots in beside the
 * rest without rebuilding one by hand. Each lands in the page's next free spot.
 */
function TemplatesPanel({ api, onTab }: { api: EditorApi; onTab: (tab: PanelTab) => void }) {
  /** The photo slot of the card just added, for "Choose its photo". */
  const [lastPhoto, setLastPhoto] = useState<string | null>(null);
  const lastPhotoOnPage = lastPhoto && api.slide.elements.some((element) => element.id === lastPhoto) ? lastPhoto : null;

  function addCard() {
    const { x, y } = freeCardSlot(api.slide.elements);
    const card = productCard({ x, y });
    api.addElements(card);
    setLastPhoto(card.find((element) => element.type === "image")?.id ?? null);
  }

  return (
    <>
      <PanelTitle>Templates</PanelTitle>
      <div className="space-y-2 px-2.5 pb-4">
        <button
          type="button"
          onClick={addCard}
          title="Add a product card"
          className="flex w-full items-center gap-3 rounded-md border border-black/10 p-2 text-left hover:border-[#6B5D42]/50 hover:bg-[#F7F2EC] lg:flex-col lg:items-stretch lg:gap-1.5"
        >
          <span className="flex shrink-0 justify-center rounded bg-white">
            <PresetPreview make={SAMPLE_CARD} size={110} />
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-1 text-[11px] font-semibold">
              <Plus size={11} /> Product card
            </span>
            <span className="block text-[10px] leading-snug text-black/50">
              Photo, label, code, name and details — added in the page&apos;s next free spot.
            </span>
          </span>
        </button>

        {lastPhotoOnPage && (
          <div className="space-y-1.5 rounded-md bg-[#8B5CF6]/10 px-2 py-1.5 text-[10px] leading-snug text-[#5B3FB0]">
            <p>Card added. Double-click any line on it to type.</p>
            <button
              type="button"
              onClick={() => {
                // The photo alone, so the Images panel swaps a picture into it.
                api.setSelected([lastPhotoOnPage]);
                onTab("images");
              }}
              className="flex items-center gap-1 rounded bg-white px-2 py-1 font-medium shadow-sm hover:bg-white/80"
            >
              <ImageIcon size={11} /> Choose its photo
            </button>
          </div>
        )}
      </div>
    </>
  );
}

/* ── Images ────────────────────────────────────────────────────────────── */

function ImagesPanel({ api, pieces }: { api: EditorApi; pieces: AffinityPiece[] }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const selectedImage = api.selectedElements.length === 1 && api.selectedElements[0].type === "image" ? api.selectedElements[0] : null;

  // Pictures the person has added this deck, so one can be placed again.
  const uploads = [
    ...new Set(
      api.design.slides.flatMap((slide) => slide.elements.flatMap((element) => (element.type === "image" && element.src ? [element.src] : [])))
    ),
  ];

  /** Places a picture at its own proportions — or, with an image selected, swaps that one's picture. */
  async function place(source: { pieceIndex?: number; src?: string }, url: string) {
    if (selectedImage) {
      api.update([selectedImage.id], { pieceIndex: source.pieceIndex, src: source.src } as Partial<DesignElement>);
      return;
    }
    const ratio = await new Promise<number>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img.naturalWidth / Math.max(1, img.naturalHeight));
      img.onerror = () => resolve(1);
      img.src = url;
    });
    const w = ratio >= 1 ? 420 : Math.round(420 * ratio);
    const h = ratio >= 1 ? Math.round(420 / ratio) : 420;
    api.addElements([imageElement({ x: (SLIDE_W - w) / 2, y: (SLIDE_H - h) / 2, w, h, fit: "contain", ...source })]);
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const file of [...files]) {
        const src = await compressGraphic(file);
        await place({ src }, src);
      }
    } finally {
      setBusy(false);
    }
  }

  const photos = pieces.map((piece, index) => ({ index, image: piece.image })).filter((entry) => entry.image);

  return (
    <>
      <PanelTitle>Images</PanelTitle>
      <div className="space-y-3 px-3 pb-4">
        <input ref={input} type="file" accept="image/*" multiple hidden onChange={(event) => { upload(event.target.files); event.target.value = ""; }} />
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy}
          className="flex w-full items-center justify-center gap-1.5 rounded-md bg-[#6B5D42] py-2 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-60"
        >
          <Upload size={13} /> {busy ? "Adding…" : "Upload an image"}
        </button>

        {selectedImage && (
          <p className="rounded-md bg-[#8B5CF6]/10 px-2 py-1.5 text-[10px] text-[#5B3FB0]">
            An image is selected — click a photo below to swap it in.
          </p>
        )}

        {uploads.length > 0 && (
          <div>
            <p className="mb-1.5 text-[10px] uppercase tracking-wider text-black/40">Your uploads</p>
            <div className="grid grid-cols-5 gap-1 md:grid-cols-8 lg:grid-cols-3 lg:gap-1.5">
              {uploads.map((src) => (
                <PhotoButton key={src.slice(-40)} src={src} onClick={() => place({ src }, src)} />
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="mb-1.5 text-[10px] uppercase tracking-wider text-black/40">Pieces in this deck · {photos.length}</p>
          <div className="grid grid-cols-5 gap-1 md:grid-cols-8 lg:grid-cols-3 lg:gap-1.5">
            {photos.map(({ index, image }) => (
              <PhotoButton key={index} src={image} onClick={() => place({ pieceIndex: index }, image)} />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function PhotoButton({ src, onClick }: { src: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="aspect-square overflow-hidden rounded-md border border-black/10 bg-white hover:border-[#6B5D42]"
      title="Add to the page"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a picture already in the deck */}
      <img src={src} alt="" className="h-full w-full object-contain" />
    </button>
  );
}
