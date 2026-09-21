"use client";

import Link from "next/link";
import { ArrowRight, Gem, LayoutGrid, Newspaper } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/permissions";
import { ToolAccessNotice } from "@/components/studio/ToolAccessNotice";

const PERMISSION = "tool.marketing_kit.run";

/**
 * Marketing Kit's three surfaces. Kits already made are reached through
 * History rather than a rail here.
 */
const SURFACES = [
  {
    id: "brand-story",
    label: "Brand Story",
    tagline: "Photos of one piece · a design narrative written for a catalogue",
    href: "/marketing-kit/brand-story",
    Icon: Gem,
  },
  {
    id: "affinity",
    label: "Affinity",
    tagline: "Several pieces, each with its own sheet · catalog copy for the set",
    href: "/marketing-kit/affinity",
    Icon: LayoutGrid,
  },
  {
    id: "campaign",
    label: "Campaign Kit",
    tagline: "A model and your jewellery · two lifestyle shots and two studio shots",
    href: "/marketing-kit/campaign",
    Icon: Newspaper,
  },
];

export default function MarketingKitPage() {
  const { user } = useAuth();

  if (!can(user, PERMISSION)) {
    return <ToolAccessNotice tool="Marketing Kit" />;
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto max-w-4xl space-y-8">
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SURFACES.map(({ id, label, tagline, href, Icon }) => (
            <li key={id}>
              <Link
                href={href}
                className="group flex h-full flex-col gap-3 rounded-xl border border-gold/[0.15] bg-surface-raised p-5 transition-colors hover:border-gold/[0.30]"
              >
                <Icon size={18} className="text-gold/70" />
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-cream">{label}</p>
                  <p className="text-[11px] leading-relaxed text-faint">{tagline}</p>
                </div>
                <ArrowRight
                  size={14}
                  className="mt-auto text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-gold/70"
                />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
