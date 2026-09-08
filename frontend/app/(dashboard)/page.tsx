"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { ToolCard } from "@/components/ToolCard";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/permissions";
import { TOOLS, UPCOMING_TOOLS } from "@/lib/nav";

// Kept brisk on purpose: with a dozen cards, a slower stagger means the last one
// is still arriving most of a second after the page is otherwise ready.
const containerVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.035, delayChildren: 0.05 } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] as const } },
};

/** Cards in the first row are above the fold — load them eagerly for a faster paint. */
const EAGER_CARD_COUNT = 3;

export default function DashboardPage() {
  const { user } = useAuth();
  const granted = useMemo(() => TOOLS.filter((tool) => can(user, tool.permission)), [user]);

  return (
    <div className="flex-1 overflow-y-auto px-8 py-8">
      <div className="max-w-6xl mx-auto space-y-8">
        {granted.length === 0 && (
          <p className="text-muted text-sm">
            No tools have been enabled for your account yet. Ask an admin to grant you access.
          </p>
        )}
        <motion.div variants={containerVariants} initial="hidden" animate="show" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* ToolCard reads only the props it declares, so the extra
              `permission` field rides along harmlessly. */}
          {granted.map((tool, index) => (
            <motion.div key={tool.id} variants={cardVariants}>
              <ToolCard {...tool} priority={index < EAGER_CARD_COUNT} />
            </motion.div>
          ))}

          {/* Always shown, to anyone: they advertise what's coming rather than
              grant anything, so there is no permission to check. */}
          {UPCOMING_TOOLS.map((tool) => (
            <motion.div key={tool.id} variants={cardVariants}>
              <ToolCard {...tool} comingSoon />
            </motion.div>
          ))}
        </motion.div>
      </div>
    </div>
  );
}
