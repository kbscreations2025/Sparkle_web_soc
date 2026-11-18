import { SkeletonGrid } from "./HistoryTiles";

/**
 * What History shows the instant it's clicked, while the page itself is on its
 * way.
 *
 * Every route here is dynamic (the root layout reads the session), and
 * Next.js only prefetches a dynamic route that has a loading boundary. So
 * without this file, a click on History left the previous page frozen on
 * screen until the server had checked the session and answered. On a slow
 * connection that took seconds with no sign anything was happening. This
 * skeleton is prefetched with the route, so it appears at once. When the
 * page lands, it opens on last visit's grid, if there was one.
 *
 * Laid out like the page's scroll area, so nothing jumps when it's replaced.
 */
export default function HistoryLoading() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-hidden p-3 pb-14 lg:p-4 lg:pb-14">
        <SkeletonGrid rows={4} />
      </div>
    </div>
  );
}
