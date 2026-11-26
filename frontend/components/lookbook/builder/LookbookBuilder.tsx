"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CloudOff,
  Eye,
  ExternalLink,
  Copy,
  ChevronDown,
  Maximize2,
  Minimize2,
  FilePlus2,
  Globe,
  Layers,
  Loader2,
  Monitor,
  MousePointerClick,
  Palette,
  PanelRightClose,
  Play,
  Redo2,
  Share2,
  SlidersHorizontal,
  Smartphone,
  Tablet,
  Undo2,
} from "lucide-react";
import type { Lookbook } from "@/lib/api";
import { cloneCard, newCard, uid } from "@/lib/lookbook/defaults";
import { move } from "@/lib/lookbook/edit";
import { resolveTheme } from "@/lib/lookbook/theme";
import { thumbOf } from "@/lib/lookbook/media";
import type { CardType, LookbookCard, LookbookMeta, LookbookTheme, Media } from "@/lib/lookbook/types";
import { useLookbookEditor, type SaveState } from "@/lib/lookbook/useLookbookEditor";
import { cn } from "@/lib/utils";
import type { EditorBridge, MediaRequest } from "../context";
import { BLANK_START, CreateLookbookDialog } from "../CreateLookbookDialog";
import { usePageActions } from "@/lib/page-toolbar-context";
import { publicUrl } from "@/lib/lookbook/slug";
import { useDismissable } from "@/lib/useEscapeKey";
import { LookbookRenderer } from "../LookbookRenderer";
import { AddCardPrompt } from "./AddCardPrompt";
import { CARD_DRAG_TYPE } from "./cardMeta";
import { CardList } from "./CardList";
import { CardRail } from "./CardRail";
import { Inspector } from "./Inspector";
import { useMediaPicker, type PickTarget } from "./MediaPickers";
import { PageSettings } from "./PageSettings";
import { SharePanel } from "./SharePanel";

const SETTINGS_TABS = [
  { id: "card", label: "Card", icon: SlidersHorizontal },
  { id: "page", label: "Page", icon: Palette },
  { id: "share", label: "Share", icon: Share2 },
] as const;

type Device = "desktop" | "tablet" | "phone";
type PanelTab = "card" | "page" | "share";
/** On a narrow screen one panel shows at a time. */
type MobilePanel = "cards" | "preview" | "settings";

const PHONE = { width: 390, height: 844 };
const TABLET = { width: 768, height: 1024 };
/** The phone with its 10px bezel. */
const SCREENS = { phone: PHONE, tablet: TABLET };

/**
 * The Live Lookbook builder: the page's cards on the left, the page itself in
 * the middle (live, edited in place), and settings on the right.
 */
export function LookbookBuilder({ initial }: { initial: Lookbook }) {
  const editor = useLookbookEditor(initial);
  const { design, commit } = editor;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [device, setDevice] = useState<Device>("desktop");
  const [previewing, setPreviewing] = useState(false);
  const [tab, setTab] = useState<PanelTab>("page");
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("preview");
  const [replay, setReplay] = useState(0);
  const [busy, setBusy] = useState<"publish" | "unpublish" | null>(null);
  /** A card type being dragged over the preview: where it would land. */
  const [drop, setDrop] = useState<{ index: number; top: number } | null>(null);
  /** The "New" dialog: a blank lookbook, made without leaving the builder. */
  const [creatingNew, setCreatingNew] = useState(false);
  /** The full card list on a large screen. Folded to a rail until someone opens it. */
  const [outlineOpen, setOutlineOpen] = useState(false);
  /** The settings panel on a large screen. Folded to icons until opened. */
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Focus mode: the builder covers the whole window, like a design tool, with the app's own menus out of the way. */
  const [fullscreen, setFullscreen] = useState(false);
  /** The "Live" button's menu: unpublish, copy the link, open the page. */
  const [liveMenu, setLiveMenu] = useState(false);
  const liveMenuRef = useRef<HTMLDivElement>(null);
  const closeLiveMenu = useCallback(() => setLiveMenu(false), []);
  useDismissable(liveMenuRef, liveMenu, closeLiveMenu);

  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [screenHeight, setScreenHeight] = useState<number>(PHONE.height);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });

  // The column the preview sits in, to fit the phone frame into it.
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  /** Never larger than life, never so small it can't be edited (it scrolls instead). */
  const screen = device === "desktop" ? null : SCREENS[device];
  const frame = screen ? { width: screen.width + 20, height: screen.height + 20 } : null;
  const phoneScale = frame && stageSize.width ? Math.max(0.4, Math.min(1, stageSize.width / frame.width, stageSize.height / frame.height)) : 1;

  const resolved = useMemo(() => resolveTheme(design.theme), [design.theme]);
  const selected = design.cards.find((card) => card.id === selectedId) ?? null;

  // "One screen" in the preview is the preview's own height, so a full-screen hero fills it.
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setScreenHeight(Math.round(element.clientHeight)));
    observer.observe(element);
    return () => observer.disconnect();
  }, [device]);

  /* ── Card operations ─────────────────────────────────────────────── */

  const updateCard = useCallback(
    (id: string, update: (card: LookbookCard) => LookbookCard, coalesce?: string) =>
      commit((current) => ({ ...current, cards: current.cards.map((card) => (card.id === id ? update(card) : card)) }), coalesce),
    [commit]
  );

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) setTab("card");
  }, []);

  const revealCard = useCallback((id: string) => {
    // After the card renders, bring it into view in the preview.
    window.requestAnimationFrame(() => {
      const target = document.getElementById(`lb-${id}`);
      const root = scroller.current;
      if (!target || !root) return;
      // Layout offsets, not screen rectangles: the phone preview may be scaled.
      root.scrollTo({ top: offsetWithin(target, root) - 24, behavior: "smooth" });
    });
  }, []);

  const addCard = useCallback(
    (type: CardType, index?: number) => {
      const card = newCard(type);
      commit((current) => {
        const selectedIndex = current.cards.findIndex((entry) => entry.id === selectedId);
        const at = index ?? (selectedIndex >= 0 ? selectedIndex + 1 : current.cards.length);
        const cards = [...current.cards];
        cards.splice(Math.min(Math.max(0, at), cards.length), 0, card);
        return { ...current, cards };
      });
      select(card.id);
      revealCard(card.id);
    },
    [commit, revealCard, select, selectedId]
  );

  const moveCard = useCallback(
    (id: string, by: -1 | 1) =>
      commit((current) => {
        const from = current.cards.findIndex((card) => card.id === id);
        return { ...current, cards: move(current.cards, from, from + by) };
      }),
    [commit]
  );

  const duplicateCard = useCallback(
    (id: string) => {
      const source = design.cards.find((card) => card.id === id);
      if (!source) return;
      const copy = cloneCard(source);
      commit((current) => {
        const at = current.cards.findIndex((card) => card.id === id);
        const cards = [...current.cards];
        cards.splice(at + 1, 0, copy);
        return { ...current, cards };
      });
      select(copy.id);
    },
    [commit, design.cards, select]
  );

  const removeCard = useCallback(
    (id: string) => {
      const index = design.cards.findIndex((card) => card.id === id);
      commit((current) => ({ ...current, cards: current.cards.filter((card) => card.id !== id) }));
      if (selectedId === id) {
        const neighbour = design.cards[index + 1] ?? design.cards[index - 1] ?? null;
        setSelectedId(neighbour && neighbour.id !== id ? neighbour.id : null);
      }
    },
    [commit, design.cards, selectedId]
  );

  const toggleHidden = useCallback((id: string) => updateCard(id, (card) => ({ ...card, hidden: !card.hidden })), [updateCard]);

  const setTheme = useCallback(
    (patch: Partial<LookbookTheme>, coalesce?: string) =>
      commit((current) => ({ ...current, theme: { ...current.theme, ...patch } }), coalesce && `theme:${coalesce}`),
    [commit]
  );

  const setMeta = useCallback((patch: Partial<LookbookMeta>) => commit((current) => ({ ...current, meta: { ...current.meta, ...patch } }), "meta"), [commit]);

  /* ── Pictures ─────────────────────────────────────────────────────── */

  const onPicked = useCallback(
    (target: PickTarget, media: Media[]) => {
      if (media.length === 0) return;
      if (target.key === "logo") {
        setTheme({ logo: media[0] });
        return;
      }
      const [, cardId, ...rest] = target.key.split(":");
      const slot = rest.join(":");
      updateCard(cardId, (card) => placeMedia(card, slot, media));
    },
    [setTheme, updateCard]
  );

  const picker = useMediaPicker({ lookbookId: editor.id, onPicked });

  const pickMedia = useCallback(
    (request: MediaRequest) =>
      picker.open({
        kind: request.kind,
        multiple: request.slot.startsWith("gallery:"),
        key: `card:${request.cardId}:${request.slot}`,
      }),
    [picker]
  );

  /* ── The renderer's bridge into the editor ───────────────────────── */

  const bridge = useMemo<EditorBridge>(
    () => ({ selectedId, select, updateCard, pickMedia, moveCard, duplicateCard, toggleHidden, removeCard }),
    [selectedId, select, updateCard, pickMedia, moveCard, duplicateCard, toggleHidden, removeCard]
  );

  /* ── Keys ─────────────────────────────────────────────────────────── */

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      // A dialog on top (the photo picker, "New") has the keyboard, not the page behind it.
      if (target?.closest("[role=dialog]")) return;
      const inField = target?.closest("input, textarea, select");
      const mod = event.metaKey || event.ctrlKey;
      // Undo inside the page's own text is ours, so it walks the same history as everything else.
      if (mod && !inField && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) editor.redo();
        else editor.undo();
        return;
      }
      if (mod && !inField && event.key.toLowerCase() === "y") {
        event.preventDefault();
        editor.redo();
        return;
      }
      if (inField || target?.isContentEditable) return;
      if (event.key === "Escape") {
        // Out of the preview first, then out of full screen, then off the selection.
        if (previewing) setPreviewing(false);
        else if (fullscreen) setFullscreen(false);
        else setSelectedId(null);
      }
      if (event.key === "Delete" && selectedId) removeCard(selectedId);
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [editor, removeCard, selectedId, previewing, fullscreen]);

  /* ── Dropping a palette card onto the preview ─────────────────────── */

  function previewDragOver(event: DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes(CARD_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    const sections = [...(content.current?.querySelectorAll<HTMLElement>("section[data-card]") ?? [])];
    const found = sections.findIndex((section) => {
      const rect = section.getBoundingClientRect();
      return event.clientY < rect.top + rect.height / 2;
    });
    const index = found === -1 ? sections.length : found;
    // Where the drop line sits, in the preview's own coordinates.
    const last = sections[sections.length - 1];
    const top = sections[index] ? sections[index].offsetTop : last ? last.offsetTop + last.offsetHeight : 0;
    setDrop((current) => (current?.index === index && current.top === top ? current : { index, top }));
  }

  function previewDrop(event: DragEvent<HTMLDivElement>) {
    const type = event.dataTransfer.getData(CARD_DRAG_TYPE) as CardType;
    const index = drop?.index ?? design.cards.length;
    setDrop(null);
    if (!type) return;
    event.preventDefault();
    addCard(type, index);
  }

  /* ── Publishing ───────────────────────────────────────────────────── */

  const publish = async () => {
    setBusy("publish");
    const result = await editor.publish();
    setBusy(null);
    return result;
  };
  const unpublish = async () => {
    setBusy("unpublish");
    const result = await editor.unpublish();
    setBusy(null);
    return result;
  };

  const shareImage = leadPicture(design.cards);

  const live = editor.summary.status === "published";

  /* ── Layout ───────────────────────────────────────────────────────── */

  // "New" lives in the app's main header, beside the credits, so the builder's own bar stays slim.
  usePageActions(
    <button
      type="button"
      onClick={() => setCreatingNew(true)}
      title="Start a new blank lookbook. This one stays saved as it is."
      className="flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-surface-raised px-3 text-[11px] font-medium text-cream transition-colors hover:border-gold/40 md:h-8"
    >
      <FilePlus2 size={13} className="text-faint" /> New
    </button>
  );

  const outline = (
    <CardList
      cards={design.cards}
      selectedId={selectedId}
      onSelect={(id) => {
        select(id);
        revealCard(id);
        setMobilePanel("settings");
      }}
      onReorder={(cards) => commit((current) => ({ ...current, cards }), "reorder")}
      onAdd={(type, index) => {
        addCard(type, index);
        setMobilePanel("preview");
      }}
      onDuplicate={duplicateCard}
      onRemove={removeCard}
      onCollapse={() => setOutlineOpen(false)}
    />
  );

  const rail = (
    <CardRail
      cards={design.cards}
      selectedId={selectedId}
      onSelect={(id) => {
        select(id);
        revealCard(id);
      }}
      onExpand={() => setOutlineOpen(true)}
      onReorder={(cards) => commit((current) => ({ ...current, cards }), "reorder")}
      onAdd={(type, index) => addCard(type, index)}
    />
  );

  const settingsRail = (
    <div className="flex w-full flex-col items-center gap-1 py-2">
      {SETTINGS_TABS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => {
            setTab(id);
            setSettingsOpen(true);
          }}
          title={id === "share" ? "Link & share" : label}
          aria-label={label}
          className={cn(
            "flex w-10 flex-col items-center gap-0.5 rounded-lg py-1.5 text-[8.5px] font-medium transition-colors",
            tab === id ? "text-gold" : "text-muted hover:bg-white/[0.05] hover:text-cream"
          )}
        >
          <Icon size={15} strokeWidth={1.6} />
          {label}
        </button>
      ))}
    </div>
  );

  const panel = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-0.5 border-b border-white/[0.06] p-1">
        {SETTINGS_TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            title={id === "share" ? "Link & share" : label}
            className={cn(
              "flex flex-1 items-center justify-center gap-1 rounded-md px-1 py-1 text-[11px] font-medium transition-colors",
              tab === id ? "bg-gold/12 text-gold" : "text-muted hover:text-cream"
            )}
          >
            <Icon size={12} /> {label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setSettingsOpen(false)}
          title="Collapse the settings"
          aria-label="Collapse the settings"
          className="hidden h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted hover:bg-white/[0.05] hover:text-cream lg:flex"
        >
          <PanelRightClose size={14} />
        </button>
      </div>
      <div className="slim-scrollbar min-h-0 flex-1 overflow-y-auto">
        {tab === "card" &&
          (selected ? (
            <Inspector
              key={selected.id}
              card={selected}
              theme={resolved}
              update={(update, coalesce) => updateCard(selected.id, update, coalesce)}
              pickMedia={(slot, kind) => pickMedia({ cardId: selected.id, slot, kind })}
              onReplay={() => setReplay((n) => n + 1)}
            />
          ) : (
            <div className="flex flex-col items-center gap-1.5 px-4 py-8 text-center">
              <MousePointerClick size={18} className="text-faint" />
              <p className="text-[12px] font-medium text-cream">Select a card</p>
              <p className="text-[10.5px] leading-snug text-faint">Click a card on the page to edit it. Click any words to type over them.</p>
            </div>
          ))}
        {tab === "page" && (
          <PageSettings
            theme={design.theme}
            resolved={resolved}
            setTheme={setTheme}
            pickLogo={() => picker.open({ kind: "image", multiple: false, key: "logo" })}
          />
        )}
        {tab === "share" && (
          <SharePanel
            lookbookId={editor.id}
            summary={editor.summary}
            title={editor.title}
            meta={design.meta}
            setMeta={setMeta}
            shareImage={shareImage}
            renameSlug={editor.renameSlug}
            publish={publish}
            unpublish={unpublish}
            busy={busy}
          />
        )}
      </div>
    </div>
  );

  const preview = (
    <div className="relative flex min-h-0 flex-1 flex-col bg-surface-deep">
      {editor.saveState === "conflict" && (
        <div className="flex flex-wrap items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-[12px] text-cream">
          <AlertTriangle size={14} className="text-amber-500" />
          <span className="min-w-0 flex-1">This lookbook was changed in another tab or on another device.</span>
          <button type="button" onClick={() => editor.resolveConflict("theirs")} className="rounded-md border border-white/15 px-2.5 py-1 font-medium hover:border-gold/40">
            Load that version
          </button>
          <button type="button" onClick={() => editor.resolveConflict("mine")} className="rounded-md bg-gold px-2.5 py-1 font-semibold text-black">
            Keep mine
          </button>
        </div>
      )}
      <div ref={stage} className={cn("flex min-h-0 flex-1 justify-center", frame ? "items-center overflow-auto p-4" : "")}>
        {/* A real phone's screen, 390 × 844, scaled down whole when the column is smaller, so
            what's laid out is exactly a phone's page and only its size on screen changes. */}
        <div style={frame ? { width: frame.width * phoneScale, height: frame.height * phoneScale, flexShrink: 0 } : { display: "contents" }}>
        <div
          className={cn(
            "relative flex min-h-0 flex-col overflow-hidden",
            frame ? (device === "tablet" ? "rounded-[28px] border-[10px]" : "rounded-[44px] border-[10px] border-[#121212] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.6)]") : "w-full flex-1"
          )}
          style={frame ? { width: frame.width, height: frame.height, transform: `scale(${phoneScale})`, transformOrigin: "top left" } : undefined}
        >
          <div
            ref={scroller}
            className="slim-scrollbar relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
            onDragOver={previewDragOver}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop(null);
            }}
            onDrop={previewDrop}
            onClick={(event) => {
              // A click on the page's background, not on a card, clears the selection.
              if (!(event.target as Element).closest("section[data-card], .lb-ui")) setSelectedId(null);
            }}
          >
            <div ref={content} className="relative min-h-full">
              <LookbookRenderer
                key={replay}
                design={design}
                mode={previewing ? "preview" : "edit"}
                editor={previewing ? null : bridge}
                scrollRoot={scroller}
                screenHeight={screenHeight}
                footer={previewing ? undefined : <AddCardPrompt count={design.cards.length} onAdd={(type) => addCard(type, design.cards.length)} />}
                className="min-h-full"
              />
              {drop && (
                <div className="pointer-events-none absolute inset-x-4 z-40 h-1 -translate-y-1/2 rounded-full bg-gold shadow-[0_0_0_3px_rgba(196,168,106,0.25)]" style={{ top: drop.top }} />
              )}
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", fullscreen && "fixed inset-0 z-[50] bg-void")}>
      {/* Top bar */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-white/[0.06] bg-surface px-2 py-0.5 md:px-3">
        <Link href="/live-lookbook" title="All lookbooks" className="flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-white/[0.05] hover:text-cream">
          <ArrowLeft size={16} />
        </Link>
        <SaveBadge state={editor.saveState} />
        <input
          value={editor.title}
          onChange={(event) => editor.setTitle(event.target.value)}
          aria-label="Lookbook name"
          title="Click to rename"
          className="h-6 w-40 min-w-0 cursor-text border-0 border-b border-transparent bg-transparent px-1 text-[12px] font-semibold text-cream outline-none focus:border-gold/50 sm:w-56"
        />
        <div className="ml-auto flex items-center gap-1">
          <IconButton title="Undo (Ctrl+Z)" disabled={!editor.canUndo} onClick={editor.undo}>
            <Undo2 size={15} />
          </IconButton>
          <IconButton title="Redo (Ctrl+Shift+Z)" disabled={!editor.canRedo} onClick={editor.redo}>
            <Redo2 size={15} />
          </IconButton>
          <span className="mx-1 hidden h-5 w-px bg-white/[0.08] sm:block" />
          <div className="hidden items-center rounded-lg border border-white/[0.08] p-0.5 sm:flex">
            <IconButton title="Computer view" active={device === "desktop"} onClick={() => setDevice("desktop")}>
              <Monitor size={15} />
            </IconButton>
            <IconButton title="Tablet view" active={device === "tablet"} onClick={() => setDevice("tablet")}>
              <Tablet size={15} />
            </IconButton>
            <IconButton title="Phone view" active={device === "phone"} onClick={() => setDevice("phone")}>
              <Smartphone size={15} />
            </IconButton>
          </div>
          <button
            type="button"
            onClick={() => setPreviewing((value) => !value)}
            title={previewing ? "Back to editing" : "Try the page as a client would"}
            className={cn(
              "flex h-6 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium transition-colors",
              previewing ? "border-gold/50 bg-gold/10 text-gold" : "border-white/[0.08] text-muted hover:text-cream"
            )}
          >
            <Eye size={14} /> <span className="hidden sm:inline">{previewing ? "Previewing" : "Preview"}</span>
          </button>
          <IconButton title={fullscreen ? "Exit full screen (Esc)" : "Full screen: hide the app's menus"} active={fullscreen} onClick={() => setFullscreen((value) => !value)}>
            {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </IconButton>
          <IconButton title="Play the animations again" onClick={() => setReplay((n) => n + 1)}>
            <Play size={14} />
          </IconButton>
          <div ref={liveMenuRef} className="relative ml-1 flex items-center">
            <button
              type="button"
              disabled={busy !== null || (live && !editor.summary.hasUnpublishedChanges)}
              onClick={async () => {
                setTab("share");
                setSettingsOpen(true);
                setMobilePanel("settings");
                await publish();
              }}
              className={cn(
                "flex h-6 items-center gap-1.5 bg-gold px-2.5 text-[11px] font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50",
                live ? "rounded-l-lg" : "rounded-lg"
              )}
            >
              {busy === "publish" ? <Loader2 size={14} className="animate-spin" /> : live && !editor.summary.hasUnpublishedChanges ? <Check size={14} /> : <Globe size={14} />}
              {live ? (editor.summary.hasUnpublishedChanges ? "Update" : "Live") : "Publish"}
            </button>
            {live && (
              <>
                {/* While it's live: unpublish, copy the link or open the page, right from the header. */}
                <button
                  type="button"
                  aria-label="Live page options"
                  aria-expanded={liveMenu}
                  title="Unpublish, copy the link or open the page"
                  onClick={() => setLiveMenu((open) => !open)}
                  className="flex h-6 w-5 items-center justify-center rounded-r-lg border-l border-black/20 bg-gold text-black transition-opacity hover:opacity-90"
                >
                  <ChevronDown size={13} />
                </button>
                {liveMenu && (
                  <div className="absolute right-0 top-full z-[60] mt-1 w-44 overflow-hidden rounded-lg border border-white/[0.1] bg-surface-raised py-1 shadow-xl">
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={async () => {
                        setLiveMenu(false);
                        await unpublish();
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-red-500 hover:bg-white/[0.05] disabled:opacity-50"
                    >
                      {busy === "unpublish" ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} />} Unpublish
                    </button>
                    {editor.summary.slug && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setLiveMenu(false);
                            void navigator.clipboard?.writeText(publicUrl(editor.summary.slug!)).catch(() => {});
                          }}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-cream hover:bg-white/[0.05]"
                        >
                          <Copy size={13} /> Copy link
                        </button>
                        <a
                          href={publicUrl(editor.summary.slug)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => setLiveMenu(false)}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-cream hover:bg-white/[0.05]"
                        >
                          <ExternalLink size={13} /> Open page
                        </a>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {(picker.uploads.length > 0 || picker.error) && (
        <div className="flex shrink-0 items-center gap-3 border-b border-white/[0.06] bg-surface px-4 py-1.5 text-[12px]">
          {picker.uploads.length > 0 && (
            <span className="flex items-center gap-2 text-muted">
              <Loader2 size={13} className="animate-spin" />
              Uploading {picker.uploads.length === 1 ? picker.uploads[0].name : `${picker.uploads.length} files`} · {Math.round((picker.uploads.reduce((sum, upload) => sum + upload.fraction, 0) / picker.uploads.length) * 100)}%
            </span>
          )}
          {picker.error && (
            <span className="flex items-center gap-2 text-red-400">
              <CloudOff size={13} /> {picker.error}
              <button type="button" onClick={picker.clearError} className="text-faint underline">
                Dismiss
              </button>
            </span>
          )}
        </div>
      )}

      {/* Three columns on a large screen; one at a time below that. */}
      <div className="flex min-h-0 flex-1">
        {/* On a large screen the card list starts folded to a slim rail and opens on demand, so
            the page gets the width. Below that it's the "Cards" tab, always in full. */}
        {!previewing && (
        <aside
          className={cn(
            "w-full shrink-0 flex-col border-r border-white/[0.06] bg-surface lg:flex",
            outlineOpen ? "lg:w-52 xl:w-60" : "lg:w-12",
            mobilePanel === "cards" ? "flex" : "hidden"
          )}
        >
          <div className={cn("min-h-0 flex-1 flex-col", outlineOpen ? "flex" : "flex lg:hidden")}>{outline}</div>
          {!outlineOpen && <div className="hidden min-h-0 flex-1 lg:flex">{rail}</div>}
        </aside>
        )}
        <div className={cn("min-w-0 flex-1 flex-col lg:flex", mobilePanel === "preview" ? "flex" : "hidden")}>{preview}</div>
        {!previewing && (
        <aside
          className={cn(
            "w-full shrink-0 flex-col border-l border-white/[0.06] bg-surface lg:flex",
            settingsOpen ? "lg:w-[230px] xl:w-[250px]" : "lg:w-12",
            mobilePanel === "settings" ? "flex" : "hidden"
          )}
        >
          <div className={cn("min-h-0 flex-1 flex-col", settingsOpen ? "flex" : "flex lg:hidden")}>{panel}</div>
          {!settingsOpen && <div className="hidden lg:flex">{settingsRail}</div>}
        </aside>
        )}
      </div>

      <nav className="flex shrink-0 border-t border-white/[0.06] bg-surface lg:hidden">
        {(
          [
            { id: "cards", label: "Cards", icon: Layers },
            { id: "preview", label: "Page", icon: Eye },
            { id: "settings", label: "Settings", icon: SlidersHorizontal },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setMobilePanel(id)}
            className={cn("flex flex-1 flex-col items-center gap-0.5 py-2 text-[10.5px] font-medium", mobilePanel === id ? "text-gold" : "text-muted")}
          >
            <Icon size={16} /> {label}
          </button>
        ))}
      </nav>

      {picker.element}

      {creatingNew && (
        <CreateLookbookDialog
          start={BLANK_START}
          heading="Start a new blank lookbook"
          // Saved first, so leaving for the new one never drops an edit.
          beforeCreate={editor.flush}
          note={
            <>
              <span className="text-cream">{editor.title.trim() || "This lookbook"}</span> stays saved exactly as it is. You can reopen it from the list of
              lookbooks.
            </>
          }
          onClose={() => setCreatingNew(false)}
        />
      )}
    </div>
  );
}

/** The page's first photo, as link previews will show it (the server picks the same one). */
function leadPicture(cards: LookbookCard[]): string | null {
  for (const card of cards) {
    if (card.hidden) continue;
    let media: Media | null | undefined = null;
    if (card.type === "hero" || card.type === "spotlight") media = card.media;
    else if (card.type === "gallery") media = card.items.find((item) => item.media)?.media;
    else if (card.type === "before_after") media = card.after ?? card.before;
    if (media && media.kind === "image") return thumbOf(media);
  }
  return null;
}

/** How far down `root`'s content `element` sits, in layout pixels (unaffected by a scaled preview). */
function offsetWithin(element: HTMLElement, root: HTMLElement) {
  let top = 0;
  let node: HTMLElement | null = element;
  while (node && node !== root) {
    top += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return top;
}

/** A picked picture into the slot it was picked for. Gallery picks fill empty slots first. */
function placeMedia(card: LookbookCard, slot: string, media: Media[]): LookbookCard {
  const [first] = media;
  if (slot === "media" && (card.type === "hero" || card.type === "spotlight" || card.type === "video")) return { ...card, media: first };
  if (slot === "before" && card.type === "before_after") return { ...card, before: first };
  if (slot === "after" && card.type === "before_after") return { ...card, after: first };
  if (card.type === "gallery" && slot.startsWith("gallery:")) {
    const target = slot.slice("gallery:".length);
    const queue = [...media];
    let items = card.items;
    if (target !== "add") {
      items = items.map((item) => (item.id === target && queue.length ? { ...item, media: queue.shift()! } : item));
    }
    // Empty slots take the rest first; anything left joins the end.
    items = items.map((item) => (!item.media && queue.length ? { ...item, media: queue.shift()! } : item));
    return { ...card, items: [...items, ...queue.map((entry) => ({ id: uid(), media: entry, caption: "" }))] };
  }
  return card;
}

function SaveBadge({ state }: { state: SaveState }) {
  const content: Record<SaveState, { icon: React.ReactNode; text: string; tone: string }> = {
    saved: { icon: <Check size={12} />, text: "Saved", tone: "text-faint" },
    pending: { icon: <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />, text: "Unsaved", tone: "text-faint" },
    saving: { icon: <Loader2 size={12} className="animate-spin" />, text: "Saving…", tone: "text-faint" },
    error: { icon: <CloudOff size={12} />, text: "Not saved, retrying", tone: "text-red-400" },
    conflict: { icon: <AlertTriangle size={12} />, text: "Changed elsewhere", tone: "text-amber-500" },
  };
  const { icon, text, tone } = content[state];
  return (
    <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center", tone)} title={text} role="status" aria-label={text}>
      {icon}
    </span>
  );
}

function IconButton({ title, onClick, disabled, active, children }: { title: string; onClick: () => void; disabled?: boolean; active?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-6 w-6 items-center justify-center rounded-md transition-colors disabled:opacity-30",
        active ? "bg-gold/15 text-gold" : "text-muted hover:bg-white/[0.05] hover:text-cream"
      )}
    >
      {children}
    </button>
  );
}
