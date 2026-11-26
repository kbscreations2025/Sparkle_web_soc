"use client";

import { createContext, useContext, type RefObject } from "react";
import type { ResolvedTheme } from "@/lib/lookbook/theme";
import type { LookbookCard, Media, MediaKind } from "@/lib/lookbook/types";

/**
 * Where a lookbook is being drawn:
 *   · "public": the shared page, for a client. Read-only, tap to zoom.
 *   · "edit": the builder's preview. Click to select, type in place.
 *   · "preview": the builder's preview, behaving as the client will see it.
 *   · "thumbnail": a template card. Static, nothing moves or responds.
 */
export type RenderMode = "public" | "edit" | "preview" | "thumbnail";

/** Which picture slot a pick fills. A gallery slot names its item, or "add" for new ones. */
export type MediaSlot = "media" | "before" | "after" | "gallery:add" | `gallery:${string}`;

export type MediaRequest = { cardId: string; slot: MediaSlot; kind: MediaKind };

/** What the builder lends the renderer in edit mode. */
export type EditorBridge = {
  selectedId: string | null;
  select: (id: string | null) => void;
  /**
   * Changes one card. `coalesce` names a run of edits that should undo as
   * one step: the keystrokes of one field, the frames of one slider drag.
   */
  updateCard: (id: string, update: (card: LookbookCard) => LookbookCard, coalesce?: string) => void;
  pickMedia: (request: MediaRequest) => void;
  moveCard: (id: string, by: -1 | 1) => void;
  duplicateCard: (id: string) => void;
  toggleHidden: (id: string) => void;
  removeCard: (id: string) => void;
};

export type RenderContextValue = {
  mode: RenderMode;
  theme: ResolvedTheme;
  editor: EditorBridge | null;
  /** The element that scrolls the page, when it isn't the window (the builder's preview). */
  scrollRoot: RefObject<HTMLElement | null> | null;
  reduceMotion: boolean;
  /** The first card: its pictures load first, and it's on screen before anything animates. */
  firstCardId: string | null;
  openZoom: (items: { media: Media; caption?: string }[], index: number) => void;
  /** Scrolls to a card, for the hero's button. */
  scrollToCard: (id: string) => void;
  cards: LookbookCard[];
};

export const RenderContext = createContext<RenderContextValue | null>(null);

export function useRender() {
  const value = useContext(RenderContext);
  if (!value) throw new Error("useRender outside a LookbookRenderer");
  return value;
}

/** The card being drawn, for the editable pieces inside it. */
export const CardContext = createContext<LookbookCard | null>(null);

export function useCard() {
  const card = useContext(CardContext);
  if (!card) throw new Error("useCard outside a card");
  return card;
}

/** Whether words and pictures respond to editing right now. */
export function useEditable() {
  const { mode, editor } = useRender();
  return mode === "edit" && editor !== null;
}
