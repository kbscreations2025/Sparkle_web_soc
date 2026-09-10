"use client";

import { motion } from "framer-motion";
import { Eraser, Hand, Sparkles, Sun, SwatchBook, Wand2, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";

const CLEANING_PERMISSION = "tool.cleaning.run";

type CleaningMode = {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  /** A mode without one has no workspace yet, so its card isn't clickable. */
  href?: string;
};

/**
 * The six things this tool can do. Only the ones with an `href` have a
 * workspace built; the rest render as plain cards until they do.
 */
const MODES: CleaningMode[] = [
  {
    id: "default",
    label: "Default",
    description: "The standard retouch — upload, clean, then ask for changes",
    icon: Sparkles,
    href: "/cleaning/default",
  },
  {
    id: "dust",
    label: "Dust & Scratches",
    description: "Clear specks, fibres and hairline marks from the surface",
    icon: Eraser,
  },
  {
    id: "reflections",
    label: "Reflections & Glare",
    description: "Tame hotspots and studio reflections on metal and stones",
    icon: Sun,
  },
  {
    id: "hands",
    label: "Hands & Props",
    description: "Remove fingers, stands and holders from the shot",
    icon: Hand,
  },
  {
    id: "colour",
    label: "Colour Correct",
    description: "True up metal tone and stone colour to match the real piece",
    icon: SwatchBook,
  },
  {
    id: "enhance",
    label: "Sharpen & Enhance",
    description: "Lift detail in the setting, prongs and engraving",
    icon: Wand2,
  },
];

const containerVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.035, delayChildren: 0.05 } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] as const } },
};

export default function CleaningPage() {
  const { user } = useAuth();

  // The nav already hides this tool without the grant, but a URL typed straight
  // in would skip that. Not a security boundary — whatever these cards
  // eventually call must check the grant server-side too.
  if (!can(user, CLEANING_PERMISSION)) {
    return (
      <div className="flex-1 overflow-y-auto px-8 py-8">
        <p className="text-sm text-muted">
          Image Cleaning isn&apos;t enabled for your account. Ask an admin to grant you access.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="space-y-1">
          <h1 className="font-serif text-2xl text-cream md:text-3xl">Image Cleaning</h1>
          <p className="max-w-2xl text-sm text-muted">
            Pick what you want cleaned up. Each one takes your photo and returns a studio-grade version.
          </p>
        </header>

        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="show"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {MODES.map((mode) => (
            <motion.div key={mode.id} variants={cardVariants}>
              <ModeCard mode={mode} />
            </motion.div>
          ))}
        </motion.div>
      </div>
    </div>
  );
}

/**
 * Rendered as a plain div until a mode has somewhere to go — a Link to nowhere
 * would look clickable and do nothing.
 */
function ModeCard({ mode: { label, description, icon: Icon, href } }: { mode: CleaningMode }) {
  const card = (
    <div
      className={cn(
        "group flex h-32 flex-col justify-between rounded-xl border border-black/[0.06] bg-surface-raised p-4 transition-all duration-300",
        href && "hover:border-gold/[0.35] hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)]"
      )}
    >
      <Icon size={22} strokeWidth={1.5} className="text-cream" />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-cream">{label}</p>
        <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-faint">{description}</p>
      </div>
    </div>
  );

  return href ? <Link href={href}>{card}</Link> : card;
}
