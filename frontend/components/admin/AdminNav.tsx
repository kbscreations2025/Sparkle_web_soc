"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, KeyRound, type LucideIcon } from "lucide-react";
import { NavBar, NavLogo, NavDivider } from "@/components/nav/NavBar";
import { AccountMenu } from "@/components/nav/AccountMenu";
import { cn } from "@/lib/utils";

const CONSOLE_NAV = [
  { href: "/admin", label: "Organizations", icon: Building2 },
  { href: "/admin/api-keys", label: "API Keys", icon: KeyRound },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <NavBar>
      <NavLogo href="/admin" title="Console" />

      <NavDivider />

      {/* Labelled rather than icon-only: there are two destinations, not a
          dozen tools, so there's room to say what they are. */}
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
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
        active
          ? "bg-gold/[0.10] text-gold shadow-[inset_0_-2px_0_var(--color-gold)]"
          : "text-muted hover:bg-white/[0.07] hover:text-cream"
      )}
    >
      <Icon size={14} />
      <span>{label}</span>
    </Link>
  );
}
