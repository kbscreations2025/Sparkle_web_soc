"use client";

import { useEffect, useState } from "react";

const QUERY = "(hover: hover) and (pointer: fine)";

/**
 * True on devices with a real mouse (desktops, laptops), false on touch-first
 * ones (phones, tablets). Lets hover-driven UI fall back to tap-to-toggle where
 * hover doesn't exist and the browser's synthetic mouseenter makes it flaky.
 *
 * Starts `true` so server and first client render agree; corrected on mount.
 */
export function useCanHover() {
  const [canHover, setCanHover] = useState(true);

  useEffect(() => {
    const media = window.matchMedia(QUERY);
    const update = () => setCanHover(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return canHover;
}
