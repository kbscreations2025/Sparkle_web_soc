"use client";

import { MotionConfig } from "framer-motion";
import { LookbookRenderer } from "@/components/lookbook/LookbookRenderer";
import { safeColor } from "@/lib/lookbook/media";
import type { LookbookDesign } from "@/lib/lookbook/types";

/**
 * The page as a client sees it. The body takes the page's colour too, so a
 * phone's overscroll bounce shows the page rather than the app's own
 * background. Motion follows the phone's setting: with reduced motion on,
 * nothing animates.
 */
export function PublicLookbook({ design }: { design: LookbookDesign }) {
  const background = safeColor(design.theme.bgColor, "#FFFFFF");
  return (
    <MotionConfig reducedMotion="user">
      <style href="sparkle-lookbook-body" precedence="default">{`body{background:${background} !important;}`}</style>
      <LookbookRenderer design={design} mode="public" className="min-h-svh w-full flex-1" />
    </MotionConfig>
  );
}
