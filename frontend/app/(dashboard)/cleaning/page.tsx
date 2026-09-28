"use client";

import { motion } from "framer-motion";
import { Eraser, Sparkles, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/permissions";
import { ToolAccessNotice } from "@/components/studio/ToolAccessNotice";
import { cn } from "@/lib/utils";

const CLEANING_PERMISSION = "tool.cleaning.run";

type CleaningMode = {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  /** A mode without one has no workspace yet, so its card isn't clickable. */
  href?: string;
  /** Announced but not built — same "Soon" badge as the dashboard's own cards. */
  comingSoon?: boolean;
};

/**
 * What this tool can do. A built mode earns its card by having a workspace
 * behind it; a `comingSoon` one is shown but not linked, the same rule the
 * dashboard's own cards (`UPCOMING_TOOLS`) already follow — announced without
 * promising a page that isn't there yet.
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
    id: "new-cleaning",
    label: "New Cleaning",
    description: "The next cleaning mode — details to come",
    icon: Eraser,
    comingSoon: true,
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
    return <ToolAccessNotice tool="Image Cleaning" />;
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* The breadcrumb already names this page — no need to repeat the title here. */}
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
 * would look clickable and do nothing. `comingSoon` follows the same rule and
 * adds the "Soon" badge and lock-dim treatment the dashboard's own cards use.
 */
function ModeCard({ mode: { label, description, icon: Icon, href, comingSoon } }: { mode: CleaningMode }) {
  const card = (
    <div
      className={cn(
        "group flex h-32 flex-col justify-between rounded-xl border p-4 transition-all duration-300",
        comingSoon
          ? "border-black/[0.05] bg-surface-raised cursor-default"
          : "border-black/[0.06] bg-surface-raised hover:border-gold/[0.35] hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)]"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <Icon size={22} strokeWidth={1.5} className={comingSoon ? "text-faint" : "text-cream"} />
        {comingSoon && (
          <span className="shrink-0 rounded-full border border-black/[0.06] bg-black/[0.05] px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-faint">
            Soon
          </span>
        )}
      </div>
      <div className="min-w-0">
        <p className={cn("truncate text-sm font-semibold", comingSoon ? "text-muted" : "text-cream")}>{label}</p>
        <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-faint">{description}</p>
      </div>
    </div>
  );

  return href ? <Link href={href}>{card}</Link> : card;
}
