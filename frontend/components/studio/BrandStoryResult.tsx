"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Share2 } from "lucide-react";
import { parseBrandStory } from "@/lib/brandStory";
import { cn } from "@/lib/utils";

/**
 * A Brand Story as it is meant to be read: the piece on the left, the
 * narrative set out as an editorial page on the right.
 *
 * Used in two places — the tool once a run lands, and History when an old
 * one is reopened — so the result looks the same whether it is a minute or
 * a month old. That is the whole reason it is a component rather than
 * markup inside the page.
 *
 * `images` may be empty (History carries the narrative without the photos),
 * in which case the layout collapses to the text alone rather than leaving
 * an empty panel.
 */
export function BrandStoryResult({
  text,
  images = [],
  className,
  pending = null,
}: {
  text?: string | null;
  images?: { url: string; thumbnailUrl?: string | null }[];
  className?: string;
  /**
   * Set while the narrative is still being written: the card is shown at
   * once with the photo in place, and the text side holds placeholder lines
   * and the run's progress until the words arrive.
   */
  pending?: { percent?: number | null } | null;
}) {
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);

  const story = parseBrandStory(text);
  const hasImage = images.length > 0;

  useEffect(() => {
    if (!copied && !shared) return;
    const timer = setTimeout(() => {
      setCopied(false);
      setShared(false);
    }, 2000);
    return () => clearTimeout(timer);
  }, [copied, shared]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(story.plainText);
      setCopied(true);
    } catch {
      // A clipboard the browser refuses is not worth an error banner — the
      // text is on screen and selectable either way.
    }
  }

  async function share() {
    // The share sheet where there is one; otherwise this is a second Copy,
    // which is what every desktop browser can actually do.
    if (navigator.share) {
      try {
        await navigator.share({ title: story.title || "Brand Story", text: story.plainText });
      } catch {
        // Dismissed. Not a failure.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(story.plainText);
      setShared(true);
    } catch {
      /* as above */
    }
  }

  return (
    // `overflow-clip`, not `overflow-hidden`: both round off the corners, but
    // `hidden` also makes this a scroll container, which pins the sticky
    // photo inside to a box that never scrolls — so it would not stick.
    <div
      className={cn(
        "relative overflow-clip rounded-2xl border border-gold/20 bg-gradient-to-br from-gold/[0.04] via-transparent to-transparent",
        className
      )}
    >
      {/* The thin gold seam along the top — the one flourish that marks this
          out as the finished piece rather than a working panel. */}
      <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />

      {/* One column on a phone, two from `md` — at 375px the image and the
          narrative side by side leave neither enough room to read. The photo
          takes a third, so the narrative — what is actually being read — has
          the room. */}
      <div className={cn("grid", hasImage && "md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]")}>
        {hasImage && (
          // Pinned to the top and held there while the text scrolls past —
          // stretched to the narrative's height, the photo sat halfway down
          // a tall empty column and scrolled away before the reading did.
          // The divider moves to the text column, which is the full height.
          //
          // The tint sits on this outer column, which does run the card's full
          // height, so the photo side is one colour top to bottom — on the
          // pinned box alone it stopped at 420px and the card showed below.
          <div className="bg-white/[0.02]">
            <div className="relative flex min-h-56 items-center justify-center md:sticky md:top-0 md:min-h-[420px]">
              {/* eslint-disable-next-line @next/next/no-img-element -- intrinsic aspect, contained; next/image's fill sizing fights it */}
              <img src={images[0].url} alt="" className="max-h-[420px] w-full object-contain md:max-h-[600px]" />

              {/* The other angles, small, so the set is visible without
                  crowding out the one being shown. */}
              {images.length > 1 && (
                <div className="absolute inset-x-3 bottom-3 flex gap-2">
                  {images.slice(1, 4).map((image) => (
                    <span
                      key={image.url}
                      className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg border border-white/20 bg-black/40 md:h-14 md:w-14"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- fixed 56px tile */}
                      <img src={image.thumbnailUrl || image.url} alt="" className="h-full w-full object-cover" />
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <div
          className={cn(
            "flex flex-col justify-center px-5 py-6 md:px-9 md:py-8",
            hasImage && "border-white/[0.06] md:border-l"
          )}
        >
          <div className="mb-4 flex items-center justify-between gap-2">
            <p className="text-[9px] font-semibold uppercase tracking-[0.32em] text-gold/55">
              Brand Story · Design Narrative
            </p>

            {story.plainText && !pending && (
              <div className="flex shrink-0 items-center gap-1.5">
                <StoryAction onClick={copy} title="Copy brand story" done={copied} doneLabel="Copied" icon={Copy}>
                  Copy
                </StoryAction>
                <StoryAction onClick={share} title="Share brand story" done={shared} doneLabel="Copied" icon={Share2}>
                  Share
                </StoryAction>
              </div>
            )}
          </div>

          {pending ? (
            <StoryPlaceholder percent={pending.percent} />
          ) : (
            <>
              {story.title ? (
                <h2 className="mb-6 text-2xl font-light leading-snug tracking-wide text-cream md:text-3xl">
                  {story.title}
                </h2>
              ) : (
                <p className="mb-6 text-sm italic text-cream/30">No narrative yet.</p>
              )}

              <span aria-hidden className="mb-6 block h-px w-12 bg-gold/50" />

              <div className="flex-1 space-y-5">
                {story.structured
                  ? story.sections.map((section) => (
                      <div key={section.label}>
                        <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.22em] text-gold/45">
                          {section.label}
                        </p>
                        <p className="text-sm leading-relaxed text-muted">{section.text}</p>
                      </div>
                    ))
                  : story.body && <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted">{story.body}</p>}
              </div>

              {story.closing && (
                <div className="mt-6 border-t border-white/[0.06] pt-5">
                  <p className="text-sm italic leading-relaxed text-cream/60">{story.closing}</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** The body sections the narrative comes back with — shown while it is written. */
const PLACEHOLDER_SECTIONS = [
  "Design Inspiration",
  "Design Philosophy",
  "Design Story",
  "Craftsmanship Narrative",
];

/**
 * The text side while the narrative is being written: the shape of what is
 * coming — a title, then its sections — in pulsing lines, with the run's
 * progress, so the page reads as "on its way" rather than empty.
 */
function StoryPlaceholder({ percent }: { percent?: number | null }) {
  const shown = typeof percent === "number" ? Math.max(4, Math.min(100, Math.round(percent))) : null;

  return (
    <div aria-busy="true" aria-live="polite">
      <div className="mb-6 h-8 w-2/3 animate-pulse rounded-md bg-white/[0.07]" />
      <span aria-hidden className="mb-6 block h-px w-12 bg-gold/50" />

      <div className="mb-6 space-y-2">
        <p className="flex items-center gap-2 text-xs text-muted">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold/60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-gold" />
          </span>
          Writing your brand story{shown !== null ? ` · ${shown}%` : "…"}
        </p>
        <div className="h-1 w-full max-w-xs overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className="h-full rounded-full bg-gold/70 transition-[width] duration-500"
            style={{ width: `${shown ?? 8}%` }}
          />
        </div>
      </div>

      <div className="space-y-6">
        {PLACEHOLDER_SECTIONS.map((label, index) => (
          <div key={label}>
            <p className="mb-2 text-[9px] font-semibold uppercase tracking-[0.22em] text-gold/35">{label}</p>
            <div className="space-y-2">
              <div className="h-3 w-full animate-pulse rounded bg-white/[0.06]" />
              <div className="h-3 w-[94%] animate-pulse rounded bg-white/[0.06]" />
              <div className={cn("h-3 animate-pulse rounded bg-white/[0.06]", index % 2 ? "w-3/5" : "w-4/5")} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Copy and Share are the same button with a different icon and verb. */
function StoryAction({
  onClick,
  title,
  done,
  doneLabel,
  icon: Icon,
  children,
}: {
  onClick: () => void;
  title: string;
  done: boolean;
  doneLabel: string;
  icon: typeof Copy;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="flex min-h-7 items-center gap-1 rounded-md border border-white/[0.08] px-2 py-1 text-[10px] font-medium text-faint transition-colors hover:bg-white/[0.05] hover:text-cream"
    >
      {done ? <Check size={11} className="text-success" /> : <Icon size={11} />}
      {done ? doneLabel : children}
    </button>
  );
}
