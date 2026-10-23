"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";
import type { AffinityPiece } from "@/lib/affinity";
import {
  SLIDE_H,
  SLIDE_W,
  blankSlide,
  boundsOf,
  cloneElements,
  cloneSlide,
  textElement,
  unionBox,
  uid,
  type Box,
  type DeckDesign,
  type DesignElement,
  type DesignSlide,
  type SlideBackgroundImage,
  type DeckBrand,
  type LogoCorner,
  BRAND_LOGO_NAME,
  BRAND_STORAGE_KEY,
  imageElement,
  type PageScope,
  chapterPages,
  type TextElement,
} from "@/lib/deckDesign";
import { cn } from "@/lib/utils";
import { ElementBody, SlideView, elementFrame, textStyle } from "./SlideView";
import { EditorPanels, type PanelTab } from "./EditorPanels";
import { EditorToolbar } from "./EditorToolbar";

/**
 * A Canva-style editor for the generated deck.
 *
 * Pages down the left with what each holds; one page large in the middle,
 * where anything can be selected (click, shift-click, or drag a box), moved
 * with snapping guides, resized from any side, rotated, restyled, grouped,
 * layered, copied and deleted; and a toolbar that changes with what is
 * selected. Everything is undoable, and the design saves itself as it
 * changes — there is no Save button, the same as the rest of the deck.
 */

export type EditorApi = ReturnType<typeof useEditorApi>;

const HISTORY_LIMIT = 100;
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 3;
const clampZoom = (value: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value * 100) / 100));
const SNAP = 6;

type Guide = { axis: "x" | "y"; at: number };

export function DeckEditor({
  initial,
  pieces,
  onSave,
  latestRef,
}: {
  initial: DeckDesign;
  pieces: AffinityPiece[];
  /** Called with the design after each change settles. */
  onSave: (design: DeckDesign) => void;
  /** Kept current on every change, for an export that can't wait for the save. */
  latestRef?: MutableRefObject<DeckDesign | null>;
}) {
  const api = useEditorApi(initial);
  const { design, active, slide, selected, setSelected, editingId, setEditingId } = api;

  const [tab, setTab] = useState<PanelTab>("pages");
  /** Whether the panel sheet is showing below desktop width, where it slides up over the page; desktop always shows it. */
  const [panelOpen, setPanelOpen] = useState(false);
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [fitScale, setFitScale] = useState(0.6);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const slideRef = useRef<HTMLDivElement>(null);

  const scale = zoom === "fit" ? fitScale : zoom;

  // The slide fills the space it is given, whatever the window.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const width = stage.clientWidth - 64;
      let height = stage.clientHeight - 64;
      if (panelOpen && window.matchMedia("(max-width: 1023px)").matches) {
        // An open sheet covers the bottom of the stage, so the slide fits
        // between its spot 6vh down and the top of the tallest sheet (42vh):
        // one size whichever panel is open, never running underneath.
        const top = stage.getBoundingClientRect().top + window.innerHeight * 0.06;
        const sheetTop = (stage.parentElement?.getBoundingClientRect().bottom ?? window.innerHeight) - window.innerHeight * 0.42;
        height = Math.min(height, sheetTop - top - 16);
      }
      setFitScale(Math.max(0.2, Math.min(width / SLIDE_W, height / SLIDE_H)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [panelOpen]);

  /*
   * The mouse wheel turns pages, as in PowerPoint's normal view — unless the
   * page is zoomed past the window, when it scrolls the page first and turns
   * over only at the end. Ctrl + wheel (and a trackpad pinch) zooms.
   * A native listener: React's wheel handler is passive and can't stop the
   * browser zooming the whole window.
   */
  const wheelState = useRef({ scale, active, count: design.slides.length, setActive: api.setActive, sum: 0, last: 0 });
  useEffect(() => {
    wheelState.current = { ...wheelState.current, scale, active, count: design.slides.length, setActive: api.setActive };
  });
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      const state = wheelState.current;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        setZoom(clampZoom(state.scale * Math.exp(-event.deltaY * 0.0025)));
        return;
      }
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      const down = event.deltaY > 0;
      const atEdge = down ? stage.scrollTop + stage.clientHeight >= stage.scrollHeight - 2 : stage.scrollTop <= 0;
      if (!atEdge) return;
      event.preventDefault();
      // One notch, or one trackpad swipe, is one page — not one page per event.
      const now = performance.now();
      if (now - state.last < 350) return;
      state.sum += event.deltaY;
      if (Math.abs(state.sum) < 40) return;
      state.sum = 0;
      state.last = now;
      const next = state.active + (down ? 1 : -1);
      if (next < 0 || next >= state.count) return;
      state.setActive(next);
      stage.scrollTop = down ? 0 : stage.scrollHeight;
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, []);

  // Saved once a change settles, rather than once per frame of a drag.
  const first = useRef(true);
  useEffect(() => {
    if (latestRef) latestRef.current = design;
  }, [design, latestRef]);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = setTimeout(() => onSave(design), 700);
    return () => clearTimeout(timer);
  }, [design, onSave]);

  /** Slide coordinates of a pointer. */
  const toSlide = useCallback(
    (clientX: number, clientY: number) => {
      const rect = slideRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale };
    },
    [scale]
  );

  /* ── Moving ──────────────────────────────────────────────────────────── */

  /** `onClick` runs instead when the pointer comes up without having dragged. */
  function startMove(event: ReactPointerEvent, ids: string[], onClick?: () => void) {
    const movable = slide.elements.filter((element) => ids.includes(element.id) && !element.locked);
    if (movable.length === 0) {
      onClick?.();
      return;
    }
    const snapshot = api.designRef.current;
    const origin = { x: event.clientX, y: event.clientY };
    const starts = new Map(movable.map((element) => [element.id, { x: element.x, y: element.y }]));
    const startBox = unionBox(movable.map(boundsOf))!;
    const others = slide.elements.filter((element) => !ids.includes(element.id)).map(boundsOf);
    const xs = [0, SLIDE_W / 2, SLIDE_W, ...others.flatMap((box) => [box.x, box.x + box.w / 2, box.x + box.w])];
    const ys = [0, SLIDE_H / 2, SLIDE_H, ...others.flatMap((box) => [box.y, box.y + box.h / 2, box.y + box.h])];
    let moved = false;

    const move = (moveEvent: PointerEvent) => {
      let dx = (moveEvent.clientX - origin.x) / scale;
      let dy = (moveEvent.clientY - origin.y) / scale;
      if (!moved && Math.hypot(dx, dy) * scale < 3) return;
      moved = true;

      // Snap the moving box's edges and centre to the page and to everything else on it.
      const found: Guide[] = [];
      if (!moveEvent.altKey) {
        const snapAxis = (start: number, size: number, delta: number, lines: number[], axis: "x" | "y") => {
          let best: { diff: number; at: number } | null = null;
          for (const edge of [start, start + size / 2, start + size]) {
            for (const line of lines) {
              const diff = line - (edge + delta);
              if (Math.abs(diff) <= SNAP / scale && (!best || Math.abs(diff) < Math.abs(best.diff))) best = { diff, at: line };
            }
          }
          if (best) found.push({ axis, at: best.at });
          return best ? delta + best.diff : delta;
        };
        dx = snapAxis(startBox.x, startBox.w, dx, xs, "x");
        dy = snapAxis(startBox.y, startBox.h, dy, ys, "y");
      }
      setGuides(found);

      api.setLive((current) =>
        api.mapSlide(current, active, (element) => {
          const start = starts.get(element.id);
          return start ? { ...element, x: Math.round(start.x + dx), y: Math.round(start.y + dy) } : element;
        })
      );
    };

    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setGuides([]);
      if (moved) api.commitFrom(snapshot);
      else onClick?.();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function onElementPointerDown(event: ReactPointerEvent, element: DesignElement) {
    if (event.button !== 0 || editingId === element.id) return;
    event.stopPropagation();
    setMenu(null);
    // An open text editor closes by losing focus, which this click is about to do — closing it
    // here instead would unmount it before its text is saved.

    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      const unit = api.unitOf(element);
      const allIn = unit.every((id) => selected.includes(id));
      setSelected(allIn ? selected.filter((id) => !unit.includes(id)) : [...new Set([...selected, ...unit])]);
      return;
    }

    const ids = selected.includes(element.id) ? selected : api.unitOf(element);
    setSelected(ids);
    /*
     * As in Canva: the first click on a grouped element selects its whole
     * group, and a second click (without dragging) on a member of the
     * selected group picks out just that member. Dragging still moves the
     * whole group.
     */
    const unit = api.unitOf(element);
    const groupSelected = unit.length > 1 && selected.includes(element.id) && unit.every((id) => selected.includes(id));
    startMove(event, ids, groupSelected ? () => setSelected([element.id]) : undefined);
  }

  function onElementDoubleClick(element: DesignElement) {
    // Inside a group, a double-click picks out the one element.
    setSelected([element.id]);
    if (element.type === "text" && !element.locked) setEditingId(element.id);
  }

  /* ── Box select ──────────────────────────────────────────────────────── */

  function onStagePointerDown(event: ReactPointerEvent) {
    if (event.button !== 0) return;
    setMenu(null);
    const start = toSlide(event.clientX, event.clientY);
    const additive = event.shiftKey;
    const before = additive ? selected : [];
    let dragged = false;

    const move = (moveEvent: PointerEvent) => {
      const at = toSlide(moveEvent.clientX, moveEvent.clientY);
      const box = { x: Math.min(start.x, at.x), y: Math.min(start.y, at.y), w: Math.abs(at.x - start.x), h: Math.abs(at.y - start.y) };
      if (!dragged && box.w * scale < 4 && box.h * scale < 4) return;
      dragged = true;
      setMarquee(box);
      const hit = slide.elements.filter((element) => {
        const b = boundsOf(element);
        return b.x < box.x + box.w && b.x + b.w > box.x && b.y < box.y + box.h && b.y + b.h > box.y;
      });
      setSelected([...new Set([...before, ...hit.flatMap((element) => api.unitOf(element))])]);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setMarquee(null);
      if (!dragged && !additive) setSelected([]);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /* ── Resizing and rotating ───────────────────────────────────────────── */

  const selectedElements = slide.elements.filter((element) => selected.includes(element.id));
  const single = selectedElements.length === 1 ? selectedElements[0] : null;
  const selectionBox = single ? null : unionBox(selectedElements.map(boundsOf));
  const anyLocked = selectedElements.some((element) => element.locked);

  function startResize(event: ReactPointerEvent, sx: number, sy: number) {
    event.preventDefault();
    event.stopPropagation();
    const snapshot = api.designRef.current;
    const corner = sx !== 0 && sy !== 0;

    if (single) {
      const el = single;
      const angle = (el.rotation * Math.PI) / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const rot = (x: number, y: number) => ({ x: x * cos - y * sin, y: x * sin + y * cos });
      const center = { x: el.x + el.w / 2, y: el.y + el.h / 2 };
      const anchorLocal = { x: (-sx * el.w) / 2, y: (-sy * el.h) / 2 };
      const anchorOffset = rot(anchorLocal.x, anchorLocal.y);
      const anchor = { x: center.x + anchorOffset.x, y: center.y + anchorOffset.y };
      const origin = { x: event.clientX, y: event.clientY };
      const keepAspect = corner && (el.type !== "shape" || event.shiftKey);

      const move = (moveEvent: PointerEvent) => {
        const world = { x: (moveEvent.clientX - origin.x) / scale, y: (moveEvent.clientY - origin.y) / scale };
        // The pointer's travel along the element's own axes, so a rotated box resizes along its sides.
        const local = { x: world.x * cos + world.y * sin, y: -world.x * sin + world.y * cos };
        let w = sx ? Math.max(8, el.w + sx * local.x) : el.w;
        let h = sy ? Math.max(8, el.h + sy * local.y) : el.h;
        if (keepAspect || (corner && moveEvent.shiftKey)) {
          const ratio = Math.max(w / el.w, h / el.h);
          w = Math.max(8, el.w * ratio);
          h = Math.max(8, el.h * ratio);
        }
        const offset = rot((-sx * w) / 2, (-sy * h) / 2);
        const nextCenter = { x: anchor.x - offset.x, y: anchor.y - offset.y };
        const patch: Partial<DesignElement> = {
          x: Math.round(nextCenter.x - w / 2),
          y: Math.round(nextCenter.y - h / 2),
          w: Math.round(w),
          h: Math.round(h),
        };
        // Pulling a text box's corner scales the type with it, as Canva does; its sides only rewrap it.
        if (el.type === "text" && corner) {
          (patch as Partial<TextElement>).fontSize = Math.max(4, Math.round(el.fontSize * (w / el.w) * 10) / 10);
        }
        api.setLive((current) => api.mapSlide(current, active, (element) => (element.id === el.id ? ({ ...element, ...patch } as DesignElement) : element)));
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        api.commitFrom(snapshot);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      return;
    }

    // Several at once: the box around them scales, and everything in it with it.
    const box = selectionBox!;
    const starts = new Map(selectedElements.map((element) => [element.id, element]));
    const origin = { x: event.clientX, y: event.clientY };
    const anchor = { x: sx < 0 ? box.x + box.w : box.x, y: sy < 0 ? box.y + box.h : box.y };

    const move = (moveEvent: PointerEvent) => {
      const dx = (moveEvent.clientX - origin.x) / scale;
      const dy = (moveEvent.clientY - origin.y) / scale;
      let fx = sx ? Math.max(0.05, (box.w + sx * dx) / box.w) : 1;
      let fy = sy ? Math.max(0.05, (box.h + sy * dy) / box.h) : 1;
      if (corner) fx = fy = Math.max(fx, fy);
      api.setLive((current) =>
        api.mapSlide(current, active, (element) => {
          const start = starts.get(element.id);
          if (!start || start.locked) return element;
          const next = {
            ...start,
            x: Math.round(anchor.x + (start.x - anchor.x) * fx),
            y: Math.round(anchor.y + (start.y - anchor.y) * fy),
            w: Math.max(4, Math.round(start.w * fx)),
            h: Math.max(4, Math.round(start.h * fy)),
          } as DesignElement;
          if (next.type === "text" && start.type === "text" && corner) next.fontSize = Math.max(4, Math.round(start.fontSize * fx * 10) / 10);
          return next;
        })
      );
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      api.commitFrom(snapshot);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function startRotate(event: ReactPointerEvent) {
    if (!single) return;
    event.preventDefault();
    event.stopPropagation();
    const snapshot = api.designRef.current;
    const center = { x: single.x + single.w / 2, y: single.y + single.h / 2 };

    const move = (moveEvent: PointerEvent) => {
      const at = toSlide(moveEvent.clientX, moveEvent.clientY);
      let angle = (Math.atan2(at.y - center.y, at.x - center.x) * 180) / Math.PI + 90;
      angle = ((angle % 360) + 360) % 360;
      if (moveEvent.shiftKey) angle = Math.round(angle / 15) * 15;
      else for (const right of [0, 90, 180, 270, 360]) if (Math.abs(angle - right) < 4) angle = right;
      const rotation = Math.round(angle % 360);
      api.setLive((current) => api.mapSlide(current, active, (element) => (element.id === single.id ? { ...element, rotation } : element)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      api.commitFrom(snapshot);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /* ── Keyboard ────────────────────────────────────────────────────────── */

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (mod && key === "z") {
        event.preventDefault();
        if (event.shiftKey) api.redo();
        else api.undo();
      } else if (mod && key === "y") {
        event.preventDefault();
        api.redo();
      } else if (mod && key === "a") {
        event.preventDefault();
        setSelected(slide.elements.map((element) => element.id));
      } else if (mod && key === "c") {
        api.copy();
      } else if (mod && key === "x") {
        api.copy();
        api.removeSelected();
      } else if (mod && key === "v") {
        event.preventDefault();
        api.paste();
      } else if (mod && key === "d") {
        event.preventDefault();
        api.duplicateSelected();
      } else if (mod && key === "g") {
        event.preventDefault();
        if (event.shiftKey) api.ungroup();
        else api.group();
      } else if (mod && key === "]") {
        event.preventDefault();
        api.reorder(event.shiftKey ? "front" : "forward");
      } else if (mod && key === "[") {
        event.preventDefault();
        api.reorder(event.shiftKey ? "back" : "backward");
      } else if (key === "delete" || key === "backspace") {
        if (selected.length) {
          event.preventDefault();
          api.removeSelected();
        }
      } else if (key === "escape") {
        setSelected([]);
        setMenu(null);
      } else if (key === "enter" && single?.type === "text") {
        event.preventDefault();
        setEditingId(single.id);
      } else if (["arrowleft", "arrowright", "arrowup", "arrowdown"].includes(key) && selected.length) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        api.nudge(key === "arrowleft" ? -step : key === "arrowright" ? step : 0, key === "arrowup" ? -step : key === "arrowdown" ? step : 0);
      } else if (!selected.length && (key === "pagedown" || key === "arrowdown")) {
        api.setActive(Math.min(design.slides.length - 1, active + 1));
      } else if (!selected.length && (key === "pageup" || key === "arrowup")) {
        api.setActive(Math.max(0, active - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [api, slide, selected, single, active, design.slides.length, setSelected, setEditingId]);

  /* ── Drawing ─────────────────────────────────────────────────────────── */

  const renderElement = (element: DesignElement, drawn: React.ReactNode) => {
    const isEditing = editingId === element.id && element.type === "text";
    return (
      <div
        key={element.id}
        // A shape is hit-tested on what it paints (see SlideView), not its whole box.
        style={{ ...elementFrame(element), cursor: element.locked ? "default" : "move", pointerEvents: element.type === "shape" ? "none" : undefined }}
        onPointerDown={(event) => onElementPointerDown(event, element)}
        onDoubleClick={() => onElementDoubleClick(element)}
        onContextMenu={(event) => {
          event.preventDefault();
          if (!selected.includes(element.id)) setSelected(api.unitOf(element));
          setMenu({ x: event.clientX, y: event.clientY });
        }}
        className="group/el"
      >
        {isEditing ? (
          <TextEditor element={element as TextElement} onDone={(text, height) => api.finishText(element.id, text, height)} />
        ) : element.type === "text" ? (
          <ElementBody element={element} pieces={pieces} showPlaceholder />
        ) : (
          drawn
        )}
        {!selected.includes(element.id) && !isEditing && (
          <div className="pointer-events-none absolute -inset-px hidden rounded-[1px] border border-[#8B5CF6]/60 group-hover/el:block" />
        )}
      </div>
    );
  };

  const handle = 10 / scale;

  return (
    <div className="flex min-h-0 flex-1 flex-col-reverse overflow-hidden lg:flex-row" data-app-chrome>
      <EditorPanels api={api} pieces={pieces} tab={tab} onTab={setTab} open={panelOpen} onOpenChange={setPanelOpen} />

      <div className="flex min-w-0 flex-1 flex-col">
        <EditorToolbar api={api} pieces={pieces} onOpenImages={() => {
            setTab("images");
            setPanelOpen(true);
          }} />

        <div
          ref={stageRef}
          className="relative flex-1 overflow-auto bg-[#ECE7E0]"
          onPointerDown={onStagePointerDown}
          onContextMenu={(event) => {
            event.preventDefault();
            setMenu({ x: event.clientX, y: event.clientY });
          }}
        >
          {/* Phones and tablets: centred while no panel is open; with one open, a fixed spot near the top, clear of the sheet. */}
          <div
            className={cn(
              "flex min-h-full min-w-fit flex-col items-center gap-3 p-4 lg:justify-center lg:p-8",
              panelOpen ? "justify-start pt-[6vh]" : "justify-center"
            )}
          >
            <div ref={slideRef} className="shadow-[0_6px_30px_rgba(60,40,10,0.18)]">
              <SlideView slide={slide} pieces={pieces} scale={scale} renderElement={renderElement}>
                {/* Selection frame */}
                {single && !editingId && (
                  <div
                    className="pointer-events-none absolute"
                    style={{ ...elementFrame(single), opacity: 1 }}
                  >
                    <div className="absolute inset-0" style={{ outline: `${2 / scale}px solid #8B5CF6` }} />
                    {!anyLocked && (
                      <Handles handle={handle} scale={scale} onResize={startResize} onRotate={startRotate} rotatable sides />
                    )}
                  </div>
                )}
                {selectionBox && selectedElements.length > 1 && (
                  <>
                    {selectedElements.map((element) => (
                      <div
                        key={element.id}
                        className="pointer-events-none absolute"
                        style={{ ...elementFrame(element), opacity: 1, outline: `${1 / scale}px dashed #8B5CF6` }}
                      />
                    ))}
                    <div
                      className="pointer-events-none absolute"
                      style={{ left: selectionBox.x, top: selectionBox.y, width: selectionBox.w, height: selectionBox.h }}
                    >
                      <div className="absolute inset-0" style={{ outline: `${2 / scale}px solid #8B5CF6` }} />
                      {!anyLocked && <Handles handle={handle} scale={scale} onResize={startResize} sides />}
                    </div>
                  </>
                )}
                {guides.map((guide, i) =>
                  guide.axis === "x" ? (
                    <div key={i} className="pointer-events-none absolute top-0 bg-[#EC4899]" style={{ left: guide.at, width: 1 / scale, height: SLIDE_H }} />
                  ) : (
                    <div key={i} className="pointer-events-none absolute left-0 bg-[#EC4899]" style={{ top: guide.at, height: 1 / scale, width: SLIDE_W }} />
                  )
                )}
                {marquee && (
                  <div
                    className="pointer-events-none absolute border border-[#8B5CF6] bg-[#8B5CF6]/10"
                    style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h, borderWidth: 1 / scale }}
                  />
                )}
              </SlideView>
            </div>
          </div>
        </div>

        {/* The status bar, as in PowerPoint and Word: where you are, and how close. */}
        <div className="flex h-9 shrink-0 items-center gap-2 border-t border-black/10 bg-white px-3 text-[11px] text-[#4A4238]">
          <button
            type="button"
            onClick={() => api.setActive(active - 1)}
            disabled={active === 0}
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-black/5 disabled:opacity-30"
            title="Previous page (Page Up)"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="whitespace-nowrap tabular-nums">
            Page {active + 1} of {design.slides.length}
          </span>
          <button
            type="button"
            onClick={() => api.setActive(active + 1)}
            disabled={active === design.slides.length - 1}
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-black/5 disabled:opacity-30"
            title="Next page (Page Down)"
          >
            <ChevronRight size={14} />
          </button>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setZoom(clampZoom(scale - 0.1))}
              className="flex h-6 w-6 items-center justify-center rounded hover:bg-black/5"
              title="Zoom out"
            >
              <Minus size={12} />
            </button>
            <input
              type="range"
              min={ZOOM_MIN * 100}
              max={ZOOM_MAX * 100}
              value={Math.round(scale * 100)}
              onChange={(event) => setZoom(Number(event.target.value) / 100)}
              className="slim-range hidden w-28 sm:block"
              style={{ "--fill": `${((Math.round(scale * 100) - ZOOM_MIN * 100) / ((ZOOM_MAX - ZOOM_MIN) * 100)) * 100}%` } as React.CSSProperties}
              title="Zoom"
            />
            <button
              type="button"
              onClick={() => setZoom(clampZoom(scale + 0.1))}
              className="flex h-6 w-6 items-center justify-center rounded hover:bg-black/5"
              title="Zoom in"
            >
              <Plus size={12} />
            </button>
            <span className="w-10 text-right tabular-nums">{Math.round(scale * 100)}%</span>
            <button
              type="button"
              onClick={() => setZoom("fit")}
              className={cn("rounded px-2 py-1 hover:bg-black/5", zoom === "fit" && "bg-black/5 font-medium")}
              title="Fit the page to the window"
            >
              Fit
            </button>
          </div>
        </div>
      </div>

      {menu && <ContextMenu api={api} at={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

/** The eight resize handles and, for a single element, the rotate handle. */
function Handles({
  handle,
  scale,
  onResize,
  onRotate,
  rotatable,
  sides,
}: {
  handle: number;
  scale: number;
  onResize: (event: ReactPointerEvent, sx: number, sy: number) => void;
  onRotate?: (event: ReactPointerEvent) => void;
  rotatable?: boolean;
  sides?: boolean;
}) {
  const points: [number, number, string][] = [
    [-1, -1, "nwse-resize"],
    [1, -1, "nesw-resize"],
    [-1, 1, "nesw-resize"],
    [1, 1, "nwse-resize"],
    ...(sides
      ? ([
          [0, -1, "ns-resize"],
          [0, 1, "ns-resize"],
          [-1, 0, "ew-resize"],
          [1, 0, "ew-resize"],
        ] as [number, number, string][])
      : []),
  ];
  return (
    <>
      {points.map(([sx, sy, cursor]) => {
        const isSide = sx === 0 || sy === 0;
        const w = isSide && sx === 0 ? handle * 1.8 : handle;
        const h = isSide && sy === 0 ? handle * 1.8 : handle;
        return (
          <div
            key={`${sx}${sy}`}
            onPointerDown={(event) => onResize(event, sx, sy)}
            className="pointer-events-auto absolute bg-white shadow"
            style={{
              width: w,
              height: h,
              left: `calc(${(sx + 1) * 50}% - ${w / 2}px)`,
              top: `calc(${(sy + 1) * 50}% - ${h / 2}px)`,
              border: `${1.5 / scale}px solid #8B5CF6`,
              borderRadius: isSide ? handle : handle / 2,
              cursor,
            }}
          />
        );
      })}
      {rotatable && onRotate && (
        <div
          onPointerDown={onRotate}
          title="Rotate (Shift snaps to 15°)"
          className="pointer-events-auto absolute flex items-center justify-center rounded-full bg-white shadow"
          style={{
            width: handle * 2,
            height: handle * 2,
            left: `calc(50% - ${handle}px)`,
            top: -handle * 4,
            border: `${1.5 / scale}px solid #8B5CF6`,
            cursor: "grab",
          }}
        >
          <svg width="60%" height="60%" viewBox="0 0 24 24" fill="none" stroke="#8B5CF6" strokeWidth="2.5">
            <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
            <path d="M21 3v5h-5" />
          </svg>
        </div>
      )}
    </>
  );
}

/** Text typed where it sits; the box grows to fit what is typed. */
function TextEditor({ element, onDone }: { element: TextElement; onDone: (text: string, height: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.innerText = element.text;
    node.focus();
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    // Only on opening: the text is the editor's own until it closes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") event.currentTarget.blur();
      }}
      onBlur={(event) => onDone(event.currentTarget.innerText.replace(/\n$/, ""), event.currentTarget.offsetHeight)}
      style={{ ...textStyle(element), minHeight: element.h, outline: "none", cursor: "text", caretColor: element.color }}
    />
  );
}

function ContextMenu({ api, at, onClose }: { api: EditorApi; at: { x: number; y: number }; onClose: () => void }) {
  const has = api.selected.length > 0;
  const grouped = api.selectedElements.some((element) => element.groupId);
  const locked = api.selectedElements.some((element) => element.locked);
  const items: ([string, () => void, string?] | null)[] = has
    ? [
        ["Copy", api.copy, "Ctrl+C"],
        ["Paste", api.paste, "Ctrl+V"],
        ["Duplicate", api.duplicateSelected, "Ctrl+D"],
        ["Delete", api.removeSelected, "Del"],
        null,
        ["Bring to front", () => api.reorder("front"), "Ctrl+Shift+]"],
        ["Bring forward", () => api.reorder("forward"), "Ctrl+]"],
        ["Send backward", () => api.reorder("backward"), "Ctrl+["],
        ["Send to back", () => api.reorder("back"), "Ctrl+Shift+["],
        null,
        ...(api.selected.length > 1 && !api.isOneGroup ? ([["Group", api.group, "Ctrl+G"]] as [string, () => void, string][]) : []),
        ...(grouped ? ([["Ungroup", api.ungroup, "Ctrl+Shift+G"]] as [string, () => void, string][]) : []),
        [locked ? "Unlock" : "Lock", () => api.setLocked(!locked)],
      ]
    : [
        ["Paste", api.paste, "Ctrl+V"],
        ["Select all", () => api.setSelected(api.slide.elements.map((element) => element.id)), "Ctrl+A"],
        null,
        ["Add a page after this", () => api.addSlide()],
        ["Duplicate page", () => api.duplicateSlide(api.active)],
      ];

  return (
    <>
      <div className="fixed inset-0 z-40" onPointerDown={onClose} onContextMenu={(event) => { event.preventDefault(); onClose(); }} />
      <div
        className="fixed z-50 min-w-[200px] rounded-lg border border-black/10 bg-white py-1 text-[12px] text-[#2B2620] shadow-xl"
        style={{ left: Math.min(at.x, window.innerWidth - 220), top: Math.min(at.y, window.innerHeight - 340) }}
      >
        {items.map((item, i) =>
          item ? (
            <button
              key={item[0]}
              type="button"
              onClick={() => {
                item[1]();
                onClose();
              }}
              className="flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left hover:bg-black/5"
            >
              {item[0]}
              {item[2] && <span className="text-[10px] text-black/40">{item[2]}</span>}
            </button>
          ) : (
            <div key={`sep${i}`} className="my-1 h-px bg-black/10" />
          )
        )}
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   The document and every operation on it.
   ═══════════════════════════════════════════════════════════════════════ */

/** A deck with no brand of its own picks up the one remembered from the last deck. */
function withRememberedBrand(design: DeckDesign): DeckDesign {
  if (design.brand || typeof window === "undefined") return design;
  try {
    const saved = JSON.parse(window.localStorage.getItem(BRAND_STORAGE_KEY) || "null") as DeckBrand | null;
    return saved && Array.isArray(saved.logos) && Array.isArray(saved.colors) ? { ...design, brand: saved } : design;
  } catch {
    return design;
  }
}

function useEditorApi(initial: DeckDesign) {
  const [design, setDesign] = useState(() => withRememberedBrand(initial));
  const designRef = useRef(design);
  const past = useRef<DeckDesign[]>([]);
  const future = useRef<DeckDesign[]>([]);
  const clipboard = useRef<DesignElement[]>([]);
  const [active, setActiveState] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  /** How far back and forward history reaches — state, so the undo buttons follow it. */
  const [depth, setDepth] = useState({ past: 0, future: 0 });
  const bump = () => setDepth({ past: past.current.length, future: future.current.length });

  const activeIndex = Math.min(active, design.slides.length - 1);
  const slide = design.slides[activeIndex];

  const apply = useCallback((next: DeckDesign) => {
    designRef.current = next;
    setDesign(next);
  }, []);

  /** A change that can be undone. */
  const commit = useCallback(
    (update: (current: DeckDesign) => DeckDesign) => {
      const before = designRef.current;
      const next = update(before);
      if (next === before) return;
      past.current.push(before);
      if (past.current.length > HISTORY_LIMIT) past.current.shift();
      future.current = [];
      apply(next);
      bump();
    },
    [apply]
  );

  /** A frame of a drag — recorded once, by `commitFrom`, when it ends. */
  const setLive = useCallback((update: (current: DeckDesign) => DeckDesign) => apply(update(designRef.current)), [apply]);

  const commitFrom = useCallback((snapshot: DeckDesign) => {
    if (snapshot === designRef.current) return;
    past.current.push(snapshot);
    if (past.current.length > HISTORY_LIMIT) past.current.shift();
    future.current = [];
    bump();
  }, []);

  const mapSlide = useCallback(
    (current: DeckDesign, index: number, fn: (element: DesignElement) => DesignElement): DeckDesign => ({
      ...current,
      slides: current.slides.map((entry, i) => (i === index ? { ...entry, elements: entry.elements.map(fn) } : entry)),
    }),
    []
  );

  const setSlideElements = (current: DeckDesign, index: number, elements: DesignElement[]): DeckDesign => ({
    ...current,
    slides: current.slides.map((entry, i) => (i === index ? { ...entry, elements } : entry)),
  });

  const selectedElements = slide.elements.filter((element) => selected.includes(element.id));
  const groupIds = new Set(selectedElements.map((element) => element.groupId).filter(Boolean));
  const isOneGroup = groupIds.size === 1 && selectedElements.every((element) => element.groupId);

  function setActive(index: number) {
    setActiveState(Math.max(0, Math.min(index, designRef.current.slides.length - 1)));
    setSelected([]);
    setEditingId(null);
  }

  /** An element and the rest of its group — what a click selects. */
  function unitOf(element: DesignElement) {
    if (!element.groupId) return [element.id];
    return slide.elements.filter((entry) => entry.groupId === element.groupId).map((entry) => entry.id);
  }

  function update(ids: string[], patch: Partial<DesignElement> | ((element: DesignElement) => Partial<DesignElement>)) {
    commit((current) =>
      mapSlide(current, activeIndex, (element) =>
        ids.includes(element.id) ? ({ ...element, ...(typeof patch === "function" ? patch(element) : patch) } as DesignElement) : element
      )
    );
  }

  function updateSelected(patch: Partial<DesignElement> | ((element: DesignElement) => Partial<DesignElement>)) {
    update(selected, patch);
  }

  function addElements(elements: DesignElement[], { edit }: { edit?: boolean } = {}) {
    commit((current) => setSlideElements(current, activeIndex, [...current.slides[activeIndex].elements, ...elements]));
    setSelected(elements.map((element) => element.id));
    if (edit && elements[0]?.type === "text") setEditingId(elements[0].id);
  }

  function removeSelected() {
    const removable = selectedElements.filter((element) => !element.locked).map((element) => element.id);
    if (!removable.length) return;
    commit((current) => setSlideElements(current, activeIndex, current.slides[activeIndex].elements.filter((element) => !removable.includes(element.id))));
    setSelected([]);
  }

  function removeElement(id: string) {
    commit((current) => setSlideElements(current, activeIndex, current.slides[activeIndex].elements.filter((element) => element.id !== id)));
    setSelected((current) => current.filter((entry) => entry !== id));
  }

  function copy() {
    clipboard.current = selectedElements;
  }

  function paste() {
    if (!clipboard.current.length) return;
    const pasted = cloneElements(clipboard.current, 20);
    clipboard.current = pasted;
    addElements(pasted);
  }

  function duplicateSelected() {
    if (!selectedElements.length) return;
    addElements(cloneElements(selectedElements, 20));
  }

  function group() {
    if (selected.length < 2) return;
    const id = uid();
    update(selected, { groupId: id });
  }

  function ungroup() {
    const ids = new Set(selectedElements.map((element) => element.groupId).filter(Boolean));
    commit((current) => mapSlide(current, activeIndex, (element) => (element.groupId && ids.has(element.groupId) ? { ...element, groupId: undefined } : element)));
  }

  function setLocked(locked: boolean) {
    update(selected, { locked });
  }

  /** Layer order: the elements array is back-to-front. */
  function reorder(direction: "front" | "back" | "forward" | "backward") {
    const ids = new Set(selected);
    if (!ids.size) return;
    commit((current) => {
      const elements = [...current.slides[activeIndex].elements];
      const picked = elements.filter((element) => ids.has(element.id));
      const rest = elements.filter((element) => !ids.has(element.id));
      let next: DesignElement[];
      if (direction === "front") next = [...rest, ...picked];
      else if (direction === "back") next = [...picked, ...rest];
      else {
        next = [...elements];
        const order = direction === "forward" ? [...next.keys()].reverse() : [...next.keys()];
        for (const i of order) {
          const j = direction === "forward" ? i + 1 : i - 1;
          if (j < 0 || j >= next.length) continue;
          if (ids.has(next[i].id) && !ids.has(next[j].id)) [next[i], next[j]] = [next[j], next[i]];
        }
      }
      return setSlideElements(current, activeIndex, next);
    });
  }

  /** Moves one element to a position in the layer order (the layers list's drag). */
  function moveLayer(id: string, toIndex: number) {
    commit((current) => {
      const elements = [...current.slides[activeIndex].elements];
      const from = elements.findIndex((element) => element.id === id);
      if (from < 0) return current;
      const [moved] = elements.splice(from, 1);
      elements.splice(Math.max(0, Math.min(toIndex, elements.length)), 0, moved);
      return setSlideElements(current, activeIndex, elements);
    });
  }

  function nudge(dx: number, dy: number) {
    update(
      selectedElements.filter((element) => !element.locked).map((element) => element.id),
      (element) => ({ x: element.x + dx, y: element.y + dy })
    );
  }

  /** Lines a selection up — with the page for one thing, with each other for several. */
  function align(edge: "left" | "center" | "right" | "top" | "middle" | "bottom") {
    const units = unitsOf(selectedElements);
    if (!units.length) return;
    const target = units.length > 1 ? unionBox(units.map((unit) => unit.box))! : { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H };
    const shifts = new Map<string, { dx: number; dy: number }>();
    for (const unit of units) {
      const box = unit.box;
      const dx =
        edge === "left" ? target.x - box.x : edge === "center" ? target.x + target.w / 2 - (box.x + box.w / 2) : edge === "right" ? target.x + target.w - (box.x + box.w) : 0;
      const dy =
        edge === "top" ? target.y - box.y : edge === "middle" ? target.y + target.h / 2 - (box.y + box.h / 2) : edge === "bottom" ? target.y + target.h - (box.y + box.h) : 0;
      for (const id of unit.ids) shifts.set(id, { dx, dy });
    }
    applyShifts(shifts);
  }

  function distribute(axis: "x" | "y") {
    const units = unitsOf(selectedElements);
    if (units.length < 3) return;
    const key = axis === "x" ? "x" : "y";
    const size = axis === "x" ? "w" : "h";
    units.sort((a, b) => a.box[key] - b.box[key]);
    const first = units[0].box;
    const last = units[units.length - 1].box;
    const total = units.reduce((sum, unit) => sum + unit.box[size], 0);
    const gap = (last[key] + last[size] - first[key] - total) / (units.length - 1);
    let cursor = first[key];
    const shifts = new Map<string, { dx: number; dy: number }>();
    for (const unit of units) {
      const delta = cursor - unit.box[key];
      for (const id of unit.ids) shifts.set(id, axis === "x" ? { dx: delta, dy: 0 } : { dx: 0, dy: delta });
      cursor += unit.box[size] + gap;
    }
    applyShifts(shifts);
  }

  function applyShifts(shifts: Map<string, { dx: number; dy: number }>) {
    commit((current) =>
      mapSlide(current, activeIndex, (element) => {
        const shift = shifts.get(element.id);
        return shift && !element.locked ? { ...element, x: Math.round(element.x + shift.dx), y: Math.round(element.y + shift.dy) } : element;
      })
    );
  }

  function finishText(id: string, text: string, height: number) {
    setEditingId(null);
    commit((current) =>
      mapSlide(current, activeIndex, (element) =>
        element.id === id && element.type === "text"
          ? element.text === text && height <= element.h
            ? element
            : { ...element, text, h: Math.max(element.h, Math.round(height)) }
          : element
      )
    );
  }

  /* Pages */

  // A new page joins the category of the page it is added after.
  function addSlide(at = activeIndex + 1, slideToAdd: DesignSlide = { ...blankSlide(), chapter: designRef.current.slides[activeIndex]?.chapter }) {
    commit((current) => {
      const slides = [...current.slides];
      slides.splice(at, 0, slideToAdd);
      return { ...current, slides };
    });
    setActiveState(at);
    setSelected([]);
  }

  function duplicateSlide(index: number) {
    addSlide(index + 1, cloneSlide(designRef.current.slides[index]));
  }

  function removeSlide(index: number) {
    if (designRef.current.slides.length <= 1) return;
    commit((current) => ({ ...current, slides: current.slides.filter((_, i) => i !== index) }));
    setActiveState((current) => Math.max(0, current >= index ? current - 1 : current));
    setSelected([]);
  }

  function moveSlide(from: number, to: number) {
    if (from === to || to < 0 || to >= designRef.current.slides.length) return;
    commit((current) => {
      const slides = [...current.slides];
      const [moved] = slides.splice(from, 1);
      slides.splice(to, 0, moved);
      return { ...current, slides };
    });
    setActiveState(to);
  }

  /** The pages a backdrop change reaches: this one, its category, or the whole deck. */
  function pagesIn(current: DeckDesign, scope: PageScope) {
    if (scope === "all") return new Set(current.slides.map((_, i) => i));
    if (scope === "chapter") return new Set(chapterPages(current.slides, activeIndex));
    return new Set([activeIndex]);
  }

  function setBackground(color: string, scope: PageScope = "page") {
    commit((current) => {
      const pages = pagesIn(current, scope);
      return { ...current, slides: current.slides.map((entry, i) => (pages.has(i) ? { ...entry, background: color } : entry)) };
    });
  }

  /** Sets, changes or (with null) removes the background picture on the pages in `scope`. */
  function setBackgroundImage(image: SlideBackgroundImage | null, scope: PageScope = "page") {
    commit((current) => {
      const pages = pagesIn(current, scope);
      return { ...current, slides: current.slides.map((entry, i) => (pages.has(i) ? { ...entry, backgroundImage: image } : entry)) };
    });
  }

  /* Brand */

  function setBrand(brand: DeckBrand) {
    commit((current) => ({ ...current, brand }));
    try {
      window.localStorage.setItem(BRAND_STORAGE_KEY, JSON.stringify(brand));
    } catch {
      // Private window or full storage — the brand still saves with this deck.
    }
  }

  /** The page numbers a change in `scope` reaches. */
  function pagesFor(scope: PageScope) {
    return [...pagesIn(designRef.current, scope)];
  }

  /**
   * Puts a logo in the same corner of every page in `scope`, replacing any
   * brand logo already placed there — so it can be re-run to move or resize it.
   */
  function placeLogo(
    src: string,
    aspect: number,
    corner: LogoCorner,
    width: number,
    opacity: number,
    scope: PageScope,
    {
      live = false,
      onlyExisting = false,
    }: {
      /** A frame of a slider drag: shown at once, recorded for undo by `commitFrom` when the drag ends. */
      live?: boolean;
      /** Adjust the logo where one is already placed, without adding it to the other pages in scope. */
      onlyExisting?: boolean;
    } = {}
  ) {
    const margin = 36;
    const w = Math.round(width);
    const h = Math.round(width / Math.max(aspect, 0.01));
    const x = corner.endsWith("left") ? margin : SLIDE_W - margin - w;
    const y = corner.startsWith("top") ? margin : SLIDE_H - margin - h;
    (live ? setLive : commit)((current) => {
      const pages = pagesIn(current, scope);
      if (onlyExisting) {
        for (const i of [...pages]) if (!current.slides[i].elements.some((element) => element.name === BRAND_LOGO_NAME)) pages.delete(i);
      }
      return {
        ...current,
        slides: current.slides.map((entry, i) =>
          pages.has(i)
            ? {
                ...entry,
                elements: [
                  ...entry.elements.filter((element) => element.name !== BRAND_LOGO_NAME),
                  imageElement({ x, y, w, h, src, fit: "contain", opacity, name: BRAND_LOGO_NAME }),
                ],
              }
            : entry
        ),
      };
    });
  }

  function removeLogos(scope: PageScope) {
    commit((current) => {
      const pages = pagesIn(current, scope);
      return {
        ...current,
        slides: current.slides.map((entry, i) =>
          pages.has(i) ? { ...entry, elements: entry.elements.filter((element) => element.name !== BRAND_LOGO_NAME) } : entry
        ),
      };
    });
  }

  /** Brand fonts on every text in `scope`: large type takes the heading font, the rest the body font. */
  function applyFonts(heading: string, body: string, scope: PageScope) {
    commit((current) => {
      const pages = pagesIn(current, scope);
      return {
        ...current,
        slides: current.slides.map((entry, i) =>
          pages.has(i)
            ? {
                ...entry,
                elements: entry.elements.map((element) =>
                  element.type === "text" ? { ...element, fontFamily: element.fontSize >= 28 ? heading : body } : element
                ),
              }
            : entry
        ),
      };
    });
  }

  function undo() {
    const previous = past.current.pop();
    if (!previous) return;
    future.current.push(designRef.current);
    apply(previous);
    setEditingId(null);
    bump();
  }

  function redo() {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(designRef.current);
    apply(next);
    bump();
  }

  /** Adds a text box in the middle of the page and starts typing in it. */
  function addText(preset: Partial<TextElement>) {
    const w = preset.w ?? 520;
    const h = preset.h ?? Math.round((preset.fontSize ?? 24) * 1.4);
    addElements([textElement({ x: (SLIDE_W - w) / 2, y: (SLIDE_H - h) / 2, w, h, ...preset })], { edit: true });
  }

  return {
    design,
    designRef,
    slide,
    active: activeIndex,
    setActive,
    selected,
    setSelected,
    selectedElements,
    isOneGroup,
    editingId,
    setEditingId,
    canUndo: depth.past > 0,
    canRedo: depth.future > 0,
    commit,
    setLive,
    commitFrom,
    mapSlide,
    unitOf,
    update,
    updateSelected,
    addElements,
    addText,
    removeSelected,
    removeElement,
    copy,
    paste,
    duplicateSelected,
    group,
    ungroup,
    setLocked,
    reorder,
    moveLayer,
    nudge,
    align,
    distribute,
    finishText,
    addSlide,
    duplicateSlide,
    removeSlide,
    moveSlide,
    setBackground,
    setBackgroundImage,
    setBrand,
    pagesFor,
    placeLogo,
    removeLogos,
    applyFonts,
    undo,
    redo,
  };
}

/** Groups move as one when aligning — each group (or loose element) is a unit with one box. */
function unitsOf(elements: DesignElement[]) {
  const byKey = new Map<string, DesignElement[]>();
  for (const element of elements) {
    const key = element.groupId ?? element.id;
    byKey.set(key, [...(byKey.get(key) ?? []), element]);
  }
  return [...byKey.values()].map((members) => ({ ids: members.map((member) => member.id), box: unionBox(members.map(boundsOf))! }));
}
