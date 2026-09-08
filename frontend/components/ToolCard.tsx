import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Box, Lock, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Matches `Tool` in lib/nav.ts, so a tool spreads straight into this card. */
export type ToolCardData = {
  icon: LucideIcon;
  label: string;
  description: string;
  href?: string;
  image?: string;
  comingSoon?: boolean;
};

export function ToolCard({
  icon: Icon,
  label,
  description,
  href,
  image,
  comingSoon,
  priority,
}: ToolCardData & { priority?: boolean }) {
  const card = (
    <div
      className={cn(
        "group relative flex h-40 overflow-hidden rounded-xl border transition-all duration-300",
        comingSoon
          ? "border-black/[0.05] bg-surface-raised cursor-default"
          : "border-black/[0.06] bg-surface-raised hover:border-gold/[0.35] hover:shadow-[0_8px_30px_rgba(0,0,0,0.06)]"
      )}
    >
      <div className="flex flex-col justify-between flex-1 min-w-0 p-4">
        <div className="flex items-start justify-between gap-2">
          <Icon size={22} className={cn("flex-shrink-0", comingSoon ? "text-faint" : "text-cream")} strokeWidth={1.5} />
          {comingSoon && (
            <span className="flex-shrink-0 text-[8px] font-semibold px-1.5 py-0.5 rounded-full bg-black/[0.05] text-faint border border-black/[0.06] uppercase tracking-wider">
              Soon
            </span>
          )}
        </div>

        <div className="min-w-0">
          <p className={cn("text-sm font-semibold truncate", comingSoon ? "text-muted" : "text-cream")}>{label}</p>
          <p className="text-[11px] text-faint leading-relaxed mt-0.5 line-clamp-2">{description}</p>
        </div>

        <div className={cn("flex items-center transition-colors", comingSoon ? "text-faint/50" : "text-cream")}>
          {comingSoon ? <Lock size={16} strokeWidth={1.5} /> : <ArrowRight size={20} strokeWidth={1.5} />}
        </div>
      </div>

      <div className="relative w-[42%] flex-shrink-0 overflow-hidden bg-gradient-to-br from-black/[0.03] to-black/[0.06]">
        {image ? (
          <Image
            src={image}
            alt=""
            fill
            priority={priority}
            sizes="(max-width: 640px) 42vw, (max-width: 1024px) 21vw, 14vw"
            className="object-cover transition-transform duration-500 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <Box size={26} className="text-faint/40" />
          </div>
        )}
      </div>
    </div>
  );

  if (comingSoon || !href) return card;
  return <Link href={href}>{card}</Link>;
}
