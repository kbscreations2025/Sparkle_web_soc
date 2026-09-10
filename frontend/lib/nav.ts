import { Wand2, Film, Type, PenTool, PenLine, Image as ImageIcon, ScanText, Newspaper, MessageSquare, Leaf, History, Gem, Package, type LucideIcon } from "lucide-react";

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
