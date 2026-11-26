"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Film, Loader2, Upload, X } from "lucide-react";
import { LibraryPicker } from "@/components/studio/LibraryPicker";
import { fetchLookbookVideos, uploadLookbookMedia, type LookbookVideo } from "@/lib/api";
import { mediaFromLibraryItem } from "@/lib/lookbook/media";
import type { Media, MediaKind } from "@/lib/lookbook/types";
import { useEscapeKey } from "@/lib/useEscapeKey";
import { cn } from "@/lib/utils";

/** What a pick is for: a card's slot, or the page's logo. */
export type PickTarget = { kind: MediaKind; multiple: boolean; key: string };

/** The largest file the API takes in one part (backend/src/middleware/inlineImages.js). */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export type UploadProgress = { id: number; name: string; fraction: number };

let uploadCounter = 0;

/**
 * Picking pictures and clips for a lookbook.
 *
 * Photos come from the library (earlier uploads and every result) by
 * reference, since they're already stored and public, or from the device,
 * uploaded once exactly as they are. Clips come from the person's Image to
 * Video results, or from the device.
 */
export function useMediaPicker({ lookbookId, onPicked }: { lookbookId: string; onPicked: (target: PickTarget, media: Media[]) => void }) {
  const [target, setTarget] = useState<PickTarget | null>(null);
  const [uploads, setUploads] = useState<UploadProgress[]>([]);
  const [error, setError] = useState("");
  const picked = useRef(onPicked);
  useEffect(() => {
    picked.current = onPicked;
  });

  const open = useCallback((next: PickTarget) => {
    setError("");
    setTarget(next);
  }, []);
  const close = useCallback(() => setTarget(null), []);

  /** Uploads files two at a time; each lands on the page as soon as it's stored. */
  const upload = useCallback(
    async (files: File[], forTarget: PickTarget) => {
      const accepted = files.filter((file) => {
        if (file.size > MAX_UPLOAD_BYTES) {
          setError(`${file.name} is larger than 25 MB.`);
          return false;
        }
        return true;
      });
      let next = 0;
      const worker = async () => {
        while (next < accepted.length) {
          const file = accepted[next++];
          const name = file.name || "photo";
          const id = ++uploadCounter;
          setUploads((list) => [...list, { id, name, fraction: 0 }]);
          const result = await uploadLookbookMedia(lookbookId, file, (fraction) =>
            setUploads((list) => list.map((entry) => (entry.id === id ? { ...entry, fraction } : entry)))
          );
          setUploads((list) => list.filter((entry) => entry.id !== id));
          if (result.status === "success" && result.media) {
            const { media } = result;
            picked.current(forTarget, [
              {
                kind: media.kind,
                url: media.url,
                thumbnailUrl: media.thumbnailUrl ?? null,
                posterUrl: media.posterUrl ?? null,
                width: media.width,
                height: media.height,
                ...(media.alpha ? { alpha: true } : {}),
              },
            ]);
          } else {
            setError(result.message || `Couldn't upload ${name}.`);
          }
        }
      };
      await Promise.all([worker(), worker()]);
    },
    [lookbookId]
  );

  const element = (
    <>
      <LibraryPicker
        open={target?.kind === "image"}
        onClose={close}
        room={target?.multiple ? 20 : 1}
        onItems={(items) => target && picked.current(target, items.map(mediaFromLibraryItem))}
        onFiles={(files) => target && void upload(files, target)}
      />
      {target?.kind === "video" && (
        <VideoPicker
          onClose={close}
          onPick={(video) => {
            picked.current(target, [{ kind: "video", url: video.url, posterUrl: video.posterUrl, width: video.width, height: video.height }]);
            close();
          }}
          onUpload={(file) => {
            const forTarget = target;
            close();
            void upload([file], forTarget);
          }}
        />
      )}
    </>
  );

  return { open, element, uploads, error, clearError: () => setError("") };
}

/** The person's Image to Video results, newest first, plus "upload a clip". */
function VideoPicker({ onClose, onPick, onUpload }: { onClose: () => void; onPick: (video: LookbookVideo) => void; onUpload: (file: File) => void }) {
  const [videos, setVideos] = useState<LookbookVideo[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEscapeKey(onClose);

  const load = useCallback(async (before: string | null) => {
    const result = await fetchLookbookVideos(before);
    if (result.status !== "success" || !result.items) {
      setFailed(true);
      return;
    }
    setVideos((current) => [...(before ? current ?? [] : []), ...result.items!]);
    setCursor(result.nextCursor ?? null);
  }, []);

  useEffect(() => {
    let live = true;
    fetchLookbookVideos(null).then((result) => {
      if (!live) return;
      if (result.status !== "success" || !result.items) setFailed(true);
      else {
        setVideos(result.items);
        setCursor(result.nextCursor ?? null);
      }
    });
    return () => {
      live = false;
    };
  }, []);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[55] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add a clip"
        onClick={(event) => event.stopPropagation()}
        className="animate-drawer-up flex h-[80dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-white/[0.08] bg-surface-deep shadow-2xl sm:h-[min(40rem,calc(100dvh-3rem))] sm:max-w-3xl sm:rounded-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-3.5">
          <div>
            <p className="text-sm font-semibold text-cream">Add a clip</p>
            <p className="text-[11.5px] text-faint">Your Image to Video results, or a clip from your device (MP4 or WebM, up to 25 MB).</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-white/[0.06] hover:text-cream">
            <X size={16} />
          </button>
        </div>
        <div className="slim-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
          <input
            ref={input}
            type="file"
            accept="video/mp4,video/webm,video/quicktime"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) onUpload(file);
            }}
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            <button
              type="button"
              onClick={() => input.current?.click()}
              className="flex aspect-square flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-gold/40 bg-gold/[0.05] text-[12px] font-semibold text-gold hover:bg-gold/[0.1]"
            >
              <Upload size={18} /> Upload a clip
            </button>
            {videos?.map((video) => (
              <button
                key={video.id}
                type="button"
                onClick={() => onPick(video)}
                className="group relative aspect-square overflow-hidden rounded-xl border border-white/[0.08] bg-black"
                onMouseEnter={(event) => void event.currentTarget.querySelector("video")?.play().catch(() => {})}
                onMouseLeave={(event) => event.currentTarget.querySelector("video")?.pause()}
              >
                <video src={video.url} poster={video.posterUrl ?? undefined} muted loop playsInline preload="none" className="h-full w-full object-cover" />
                <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-white">
                  {video.durationMs ? `${Math.round(video.durationMs / 1000)}s` : "Clip"}
                </span>
              </button>
            ))}
          </div>
          {videos === null && !failed && (
            <p className="flex items-center justify-center gap-2 py-10 text-[12px] text-faint">
              <Loader2 size={14} className="animate-spin" /> Loading your clips…
            </p>
          )}
          {videos?.length === 0 && (
            <p className="flex flex-col items-center gap-2 py-10 text-center text-[12px] text-faint">
              <Film size={20} />
              No Image to Video results yet. Make a turntable there, or upload a clip.
            </p>
          )}
          {failed && <p className="py-6 text-center text-[12px] text-red-400">Couldn&apos;t load your clips.</p>}
          {cursor && (
            <div className="flex justify-center pt-4">
              <button type="button" onClick={() => void load(cursor)} className={cn("rounded-full border border-white/[0.1] px-4 py-1.5 text-[12px] text-cream hover:border-gold/40")}>
                Load more
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
