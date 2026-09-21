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
}: {
  text?: string | null;
  images?: { url: string; thumbnailUrl?: string | null }[];
  className?: string;
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
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-gold/20 bg-gradient-to-br from-gold/[0.04] via-transparent to-transparent",
        className
      )}
    >
      {/* The thin gold seam along the top — the one flourish that marks this
          out as the finished piece rather than a working panel. */}
      <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />

      {/* One column on a phone, two from `md` — at 375px the image and the
          narrative side by side leave neither enough room to read. */}
      <div className={cn("grid", hasImage && "md:grid-cols-[2fr_3fr]")}>
        {hasImage && (
          <div className="relative flex min-h-56 items-center justify-center border-white/[0.06] bg-white/[0.02] md:min-h-[420px] md:border-r">
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
        )}

        <div className="flex flex-col justify-center px-5 py-6 md:px-9 md:py-8">
          <div className="mb-4 flex items-center justify-between gap-2">
            <p className="text-[9px] font-semibold uppercase tracking-[0.32em] text-gold/55">
              Brand Story · Design Narrative
            </p>

            {story.plainText && (
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

          {story.title ? (
            <h2 className="mb-6 text-2xl font-light leading-snug tracking-wide text-cream md:text-3xl">{story.title}</h2>
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
        </div>
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
