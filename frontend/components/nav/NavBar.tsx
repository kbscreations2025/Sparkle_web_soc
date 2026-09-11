"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { NAV_HEIGHT } from "@/components/AppShell";

/**
 * The chrome both top bars share: the fixed glass header, the logo, and the
 * divider before the links. The dashboard and the console differ only in what
 * they put between the divider and the account menu, so everything else lives
 * here rather than being kept in step by hand across two files.
 */
export function NavBar({ children, floating = true }: { children: ReactNode; floating?: boolean }) {
  return (
    <header
      className={cn(
        "z-40 flex items-center gap-2 md:gap-4 px-3 md:px-4 border-b border-white/5 glass-raised",
        // Pinned across the viewport by default — which only works when the
        // header is the topmost thing. A shell with a full-height sidebar
        // puts this inside the content column instead, where spanning the
        // whole width would lay it over the sidebar; there it stays in flow
        // and needs no offset underneath it.
        floating ? "fixed top-0 inset-x-0" : "relative shrink-0",
        NAV_HEIGHT
      )}
    >
      {children}
    </header>
  );
}

/** The star mark where width is tight; the full wordmark from laptop widths up. */
export function NavLogo({ href = "/", title = "Dashboard" }: { href?: string; title?: string }) {
  return (
    <Link href={href} title={title} className="shrink-0">
      <Image
        src="/logo/sparklelogo2.png"
        alt="Sparkle"
        width={64}
        height={64}
        priority
        className="lg:hidden w-7 h-7 md:w-8 md:h-8 object-contain"
      />
      {/* Eager but not `priority`: preloading it would pull the wordmark down
          on phones too, where it is never shown. */}
      {/* Sized to what it actually renders (h-8 at 200:56), so the srcset
          asks for a ~128px variant instead of a 640px one. */}
      <Image
        src="/logo/sparkle5.png"
        alt="Sparkle"
        width={114}
        height={32}
        loading="eager"
        className="hidden lg:block h-8 w-auto object-contain"
      />
    </Link>
  );
}

export function NavDivider() {
  return <span aria-hidden className="hidden md:block w-px h-6 bg-white/10 shrink-0" />;
}
