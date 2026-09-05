"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  Sparkles,
  Wand2,
  Film,
  Type,
  PenTool,
  Scissors,
  ScanText,
  Newspaper,
  Leaf,
  History,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useSidebar } from "@/lib/sidebar-context";
import { cn } from "@/lib/utils";

/** An item without an `href` has no page yet — give it one to make it navigable. */
const NAV = [
  { id: "dashboard", label: "Dashboard", icon: Sparkles, href: "/" },
  { id: "cleaning", label: "Cleaning", icon: Wand2 },
  { id: "life-style", label: "Life Style", icon: Leaf },
  { id: "image-to-video", label: "Image to Video", icon: Film },
  { id: "text-to-image", label: "Text to Image", icon: Type },
  { id: "text-to-sketch", label: "Text to Sketch", icon: PenTool },
  { id: "sketch-to-image", label: "Sketch to Image", icon: Wand2 },
  { id: "image-to-text", label: "Image to Text", icon: ScanText },
  { id: "image-to-sketch", label: "Image to Sketch", icon: Scissors },
  { id: "marketing-kit", label: "Marketing Kit", icon: Newspaper },
  { id: "history", label: "History", icon: History },
] satisfies { id: string; label: string; icon: LucideIcon; href?: string }[];

const ROW_BASE = "group relative flex items-center rounded-lg text-sm transition-all duration-150 shrink-0";

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout, loggingOut } = useAuth();
  const { open, toggle } = useSidebar();

  return (
    <motion.aside
      animate={{ width: open ? 232 : 64 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className="fixed left-0 top-0 bottom-0 flex flex-col z-40 border-r border-white/5"
    >
      <div className="absolute inset-0 glass-raised" />

      <button
        onClick={toggle}
        title={open ? "Collapse sidebar" : "Expand sidebar"}
        className="absolute -right-3.5 top-6 z-50 w-3.5 h-7 rounded-r-md border border-l-0 border-white/10 bg-surface-raised text-faint hover:text-cream hover:border-gold/30 shadow-sm flex items-center justify-center transition-all"
      >
        {open ? <ChevronLeft size={10} /> : <ChevronRight size={10} />}
      </button>

      <div className="relative flex flex-col h-full overflow-hidden">
        <div className={cn("border-b border-white/5 py-3", !open && "flex justify-center")}>
          <Link href="/" className={open ? "block w-full px-3" : "block w-9 h-9"} title="Dashboard">
            <Image
              src={open ? "/logo/sparkle5.png" : "/logo/sparklelogo2.png"}
              alt="Sparkle"
              width={open ? 200 : 36}
              height={open ? 56 : 36}
              priority
              className={cn("object-contain", open ? "w-full max-h-14" : "w-full h-full")}
            />
          </Link>
        </div>

        {open && (
          <div className="px-5 pt-2 pb-2">
            <span className="text-faint text-[9px] font-medium uppercase tracking-[0.12em]">
              Brilliance... Made effortless
            </span>
          </div>
        )}

        <nav className={cn("flex-1 min-h-0 overflow-y-auto px-3 space-y-0.5", !open && "pt-2 flex flex-col items-center")}>
          {NAV.map(({ id, label, icon: Icon, href }) => {
            const isActive = href !== undefined && pathname === href;
            const layout = open ? "gap-3 px-3 py-2 w-full" : "justify-center w-10 h-10 p-0";

            const content = (
              <>
                {isActive && (
                  <motion.div
                    layoutId="sidebar-active"
                    className="absolute inset-0 rounded-lg bg-gold/[0.10] shadow-[inset_3px_0_0_var(--color-gold)]"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  />
                )}
                <Icon
                  size={15}
                  className={cn(
                    "relative z-10 transition-colors flex-shrink-0",
                    isActive ? "text-gold" : "text-faint group-hover:text-muted"
                  )}
                />
                {open && <span className="relative z-10 flex-1 whitespace-nowrap text-left">{label}</span>}
              </>
            );

            if (!href) {
              return (
                <button
                  key={id}
                  type="button"
                  disabled
                  title={`${label} — coming soon`}
                  className={cn(ROW_BASE, layout, "text-faint/70 cursor-not-allowed")}
                >
                  {content}
                </button>
              );
            }

            return (
              <Link
                key={id}
                href={href}
                title={!open ? label : undefined}
                className={cn(
                  ROW_BASE,
                  layout,
                  isActive ? "text-gold font-medium" : "text-muted bg-white/[0.04] hover:text-cream hover:bg-white/[0.07]"
                )}
              >
                {content}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-white/5 p-3">
          <div className={cn("flex items-center rounded-lg group", open ? "gap-3 px-2 py-2" : "justify-center py-2")}>
            <div className="w-7 h-7 rounded-full bg-gold/10 border border-gold/15 flex items-center justify-center flex-shrink-0">
              <span className="text-gold text-[11px] font-semibold">{user?.name?.[0]?.toUpperCase() ?? "?"}</span>
            </div>
            {open && (
              <>
                <div className="flex-1 min-w-0">
                  <p className="text-cream text-xs font-medium truncate">{user?.name ?? "User"}</p>
                  <p className="text-faint text-[10px] truncate">{user?.email ?? ""}</p>
                </div>
                <button
                  onClick={logout}
                  disabled={loggingOut}
                  title="Sign out"
                  aria-label="Sign out"
                  className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-faint hover:text-cream transition-all p-1 rounded disabled:opacity-100"
                >
                  {loggingOut ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </motion.aside>
  );
}
