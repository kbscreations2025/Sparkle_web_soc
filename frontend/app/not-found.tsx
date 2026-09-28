import Image from "next/image";
import Link from "next/link";
import { Home } from "lucide-react";

/**
 * Shown for any address this app has no page for — most often an old
 * bookmark or a startup page left over from the previous Sparkle, such as
 * `/dashboard`, which Chrome reopens after a restart.
 *
 * Replaces Next's built-in 404, which had no way out and switched to white
 * text under a dark OS theme while this app's cream background stayed —
 * leaving an all-but-blank screen. This one uses the app's own theme tokens,
 * so it reads in light and dark alike, and always offers the way home.
 *
 * The link goes to `/`: the proxy sends a super admin on to the console from
 * there, and a signed-out visitor to the login page.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
      <Image src="/logo/sparklelogo2.png" alt="Sparkle" width={56} height={56} priority className="h-14 w-14 object-contain" />

      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold/80">404</p>
        <h1 className="text-lg font-semibold text-cream">This page doesn&rsquo;t exist</h1>
        <p className="mx-auto max-w-sm text-[13px] leading-relaxed text-muted">
          The link may be out of date, or from the previous version of Sparkle. Everything is still here — head back
          to the main page.
        </p>
      </div>

      <Link
        href="/"
        className="flex items-center gap-2 rounded-lg border border-gold/30 bg-gold/10 px-4 py-2 text-[13px] font-medium text-gold transition-colors hover:bg-gold/15"
      >
        <Home size={14} />
        Go to main page
      </Link>
    </main>
  );
}
