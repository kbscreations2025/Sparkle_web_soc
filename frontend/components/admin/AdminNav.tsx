"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, Coins, KeyRound, ScrollText, type LucideIcon } from "lucide-react";
import { NavBar, NavLogo, NavDivider } from "@/components/nav/NavBar";
import { AccountMenu } from "@/components/nav/AccountMenu";
import { cn } from "@/lib/utils";

const CONSOLE_NAV = [
  { href: "/admin", label: "Organizations", icon: Building2 },
  { href: "/admin/api-keys", label: "API Keys", icon: KeyRound },
  { href: "/admin/pricing", label: "Pricing", icon: Coins },
  { href: "/admin/audit-log", label: "Audit Log", icon: ScrollText },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <NavBar>
      <NavLogo href="/admin" title="Console" />

      <NavDivider />

      {/* Labelled from sm up, where there is room to say what each one is.
          On a phone the four labels overflowed the bar and pushed the account
          menu off the edge, so there they reduce to their icons. */}
      <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto no-scrollbar">
        {CONSOLE_NAV.map(({ href, label, icon: Icon }) => (
          <ConsoleLink key={href} href={href} label={label} icon={Icon} active={pathname === href} />
        ))}
      </nav>

      <div className="flex items-center gap-1.5 md:gap-2.5 shrink-0 ml-auto">
        <AccountMenu />
      </div>
    </NavBar>
  );
}

function ConsoleLink({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      // The label is the accessible name from sm up; below it the icon is
      // alone, so the link needs one of its own.
      aria-label={label}
      title={label}
      className={cn(
        "flex shrink-0 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-colors",
        // Square while icon-only, so the four sit as an even row rather than
        // as wide buttons with a lot of air around a 14px glyph.
        "h-8 w-8 sm:h-auto sm:w-auto sm:px-2.5",
        active
          ? "bg-gold/[0.10] text-gold shadow-[inset_0_-2px_0_var(--color-gold)]"
          : "text-muted hover:bg-white/[0.07] hover:text-cream"
      )}
    >
      <Icon size={14} className="shrink-0" />
      <span className="hidden sm:inline">{label}</span>
    </Link>
  );
}
