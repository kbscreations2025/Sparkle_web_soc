"use client";

import { useMemo } from "react";
import { Wand2, Film, Type, PenTool, PenLine, Image as ImageIcon, ScanText, Newspaper, MessageSquare, Leaf, History, Gem, Package, type LucideIcon } from "lucide-react";
import { useAuth } from "./auth-context";
import { can } from "./permissions";

export type NavItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  /** An item without an `href` has no page yet — give it one to make it navigable. */
  href?: string;
  /** Hidden unless the user's grants match. Omitted means visible to everyone. */
  permission?: string;
};

/** A tool as the dashboard grid shows it: the nav item plus its card artwork. */
export type Tool = NavItem & {
  description: string;
  image?: string;
};

/**
 * The tools both surfaces show — the dashboard grid and the nav rail — defined
 * once so a card and its nav pill can never disagree about a tool's name, icon
 * or permission. They drifted while these were two separate lists.
 *
 * `permission` uses the same grammar as a member's `permissions` array in
 * Mongo, so `tool.*.run` reveals every tool while `tool.cleaning.run` reveals
 * only that one. The ids are the tool keys the backend validates against in
 * `backend/src/grants.js` — keep the two spellings in step.
 */
export const TOOLS: Tool[] = [
  {
    id: "cleaning",
    label: "Image Cleaning",
    icon: Wand2,
    description: "Remove distractions, studio-grade results",
    image: "/dashboard/cleaning.png",
    href: "/cleaning",
    permission: "tool.cleaning.run",
  },
  {
    id: "life_style",
    label: "Lifestyle",
    icon: Leaf,
    description: "Consistent character across all renders",
    image: "/dashboard/lyfestyle.png",
    permission: "tool.life_style.run",
  },
  {
    id: "image_to_video",
    label: "Image to Video",
    icon: Film,
    description: "Animate stills into cinematic loops",
    image: "/dashboard/video.png",
    permission: "tool.image_to_video.run",
  },
  {
    id: "text_to_image",
    label: "Text to Image",
    icon: Type,
    description: "Describe it, AI renders it",
    image: "/dashboard/image.png",
    permission: "tool.text_to_image.run",
  },
  {
    id: "text_to_sketch",
    label: "Text to Sketch",
    icon: PenTool,
    description: "Describe it, AI sketches it",
    image: "/dashboard/sketch2.png",
    permission: "tool.text_to_sketch.run",
  },
  {
    id: "sketch_to_image",
    label: "Sketch to Image",
    icon: ImageIcon,
    description: "Upload a sketch, AI renders it",
    image: "/dashboard/image2.png",
    permission: "tool.sketch_to_image.run",
  },
  {
    id: "image_to_text",
    label: "Image to Text",
    icon: ScanText,
    description: "Upload an image, AI describes it",
    image: "/dashboard/image3.jpg",
    permission: "tool.image_to_text.run",
  },
  {
    id: "image_to_sketch",
    label: "Image to Sketch",
    icon: PenLine,
    description: "Upload an image, AI sketches it",
    image: "/dashboard/sketch.png",
    permission: "tool.image_to_sketch.run",
  },
  {
    id: "marketing_kit",
    label: "Marketing Kit",
    icon: Newspaper,
    description: "PDF + images, descriptions, specs & captions",
    image: "/dashboard/marketkit.png",
    permission: "tool.marketing_kit.run",
  },
  {
    id: "chat_to_edit",
    label: "Chat to Edit",
    icon: MessageSquare,
    description: "Iteratively refine a jewellery image, one message at a time",
    image: "/dashboard/chatToEdit.png",
    href: "/chat-to-edit",
    permission: "tool.chat_to_edit.run",
  },
];

/** The nav rail: every tool, plus History — which is a page, not a tool, so it has no card. */
export const NAV: NavItem[] = [
  ...TOOLS,
  { id: "history", label: "History", icon: History, href: "/history", permission: "result.read.own" },
];

/**
 * The nav entries this person is allowed to see.
 *
 * Shared by the sidebar and the phone drawer so the two can never disagree
 * about what is on offer — they render differently, but "which items" is one
 * rule, and it lives here beside the list it filters.
 *
 * Memoised: it only changes when the user does, and both callers re-render
 * for unrelated reasons (a hover, a route change) that must not re-filter.
 */
export function useNavItems() {
  const { user } = useAuth();
  return useMemo(() => NAV.filter((item) => can(user, item.permission)), [user]);
}

/** Tool key → display name, for anywhere that has an id and needs to name it. */
export const TOOL_LABELS: Record<string, string> = Object.fromEntries(TOOLS.map((tool) => [tool.id, tool.label]));

/**
 * Where a tool's *workspace* lives — distinct from `href`, which for Image
 * Cleaning points at its mode picker rather than a page that can open a
 * conversation. A tool missing here has no resumable workspace yet.
 */
export const TOOL_WORKSPACE_PATHS: Record<string, string> = {
  cleaning: "/cleaning/default",
  chat_to_edit: "/chat-to-edit",
};

/**
 * Both cleaning workspaces record their generations under the same `tool:
 * "cleaning"` bucket, so the tool id alone can't tell a GPT-run conversation
 * from a Gemini one — only the recorded model label can.
 */
const CLEANING_GPT_MODEL_LABEL = "Sparkle GPT Image";
const CLEANING_GPT_WORKSPACE = "/cleaning/dust-scratches";

/**
 * Which workspace reopens this run, or undefined if that tool has none yet.
 *
 * `modelLabel` is optional and only matters for cleaning; passing it is what
 * sends a GPT run back to the workspace that produced it instead of the
 * Gemini one.
 */
export function workspacePathFor(tool: string, modelLabel?: string | null) {
  if (tool === "cleaning" && modelLabel === CLEANING_GPT_MODEL_LABEL) return CLEANING_GPT_WORKSPACE;
  return TOOL_WORKSPACE_PATHS[tool];
}

/** The link that reopens one conversation, or null if that tool can't. */
export function conversationHref(tool: string, conversationId?: string | null, modelLabel?: string | null) {
  const path = workspacePathFor(tool, modelLabel);
  return path && conversationId ? `${path}?conversationId=${conversationId}` : null;
}

/**
 * Announced on the dashboard but not built. No permission and no nav pill:
 * granting one would reveal a pill that leads nowhere.
 */
export const UPCOMING_TOOLS: Tool[] = [
  { id: "virtual_try_on", label: "Virtual Try On", icon: Gem, description: "See jewellery on a model instantly" },
  {
    id: "product_background",
    label: "Product Background",
    icon: Package,
    description: "Swap backgrounds to any scene",
  },
];
