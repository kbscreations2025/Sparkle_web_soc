/**
 * What a client sees for a link that leads nowhere: a page that was never
 * published, was taken down, or never existed. All three look the same, so
 * the screen gives nothing away about which. Plain and calm, with no app
 * chrome and no way into Sparkle: whoever opened it is someone's client, not
 * a Sparkle user.
 */
export function PageUnavailable({ busy = false }: { busy?: boolean }) {
  return (
    <main
      className="flex min-h-svh w-full flex-1 flex-col items-center justify-center px-6 text-center"
      style={{ background: "#F7F4EF", color: "#2A2620", fontFamily: "var(--font-inter), system-ui, sans-serif" }}
    >
      <div className="flex max-w-sm flex-col items-center gap-5">
        <svg width="44" height="44" viewBox="0 0 48 48" fill="none" aria-hidden>
          <path d="M14 8h20l8 10-18 22L6 18l8-10Z" stroke="#B59A63" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M6 18h36M18 8l-4 10 10 22 10-22-4-10" stroke="#B59A63" strokeWidth="1.2" strokeLinejoin="round" opacity="0.7" />
        </svg>
        <div className="space-y-2">
          <h1 className="text-[19px] font-semibold tracking-tight">{busy ? "This page is taking a moment" : "This page isn't available"}</h1>
          <p className="text-[14px] leading-relaxed" style={{ color: "#6B6358" }}>
            {busy
              ? "We couldn't load it just now. Please try again in a minute."
              : "The link may have changed, or the page has been taken down. Ask whoever shared it with you for a new link."}
          </p>
        </div>
      </div>
    </main>
  );
}
