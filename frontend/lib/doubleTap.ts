import type { MouseEvent, TouchEvent } from "react";

/**
 * Double-click — or double-tap — to preview an image. The one gesture for
 * "look at this closely" everywhere a picture is small or a single click
 * already does something else (picks a model, puts a result on the stage).
 *
 * `onDoubleClick` alone is not enough: Safari on iPhone and iPad does not
 * fire it for taps. So a touch is timed by hand as well. Where a browser
 * does fire both, `onDouble` runs twice; it only ever opens a preview, so
 * the second call changes nothing.
 *
 * Spread onto the element: `<button onClick={pick} {...doubleTap(src, () => open(src))}>`.
 * `key` tells two different pictures apart, so a tap on one and then
 * another is not a double tap.
 */
const WINDOW_MS = 320;
let lastTap: { key: string; at: number } = { key: "", at: 0 };

/**
 * True when the gesture landed on a control of its own inside the picture —
 * double-clicking the download button on a result should not also open it.
 */
function onInnerControl(event: MouseEvent | TouchEvent) {
  const control = (event.target as Element | null)?.closest("button, a, input, textarea, select");
  return Boolean(control && control !== event.currentTarget && event.currentTarget.contains(control));
}

export function doubleTap(key: string, onDouble: () => void) {
  return {
    onDoubleClick: (event: MouseEvent) => {
      if (onInnerControl(event)) return;
      event.preventDefault();
      onDouble();
    },
    onTouchEnd: (event: TouchEvent) => {
      // A finger lifted after a pinch or with others still down is not a tap.
      if (event.touches.length > 0 || event.changedTouches.length !== 1) return;
      if (onInnerControl(event)) return;
      const now = Date.now();
      if (lastTap.key === key && now - lastTap.at < WINDOW_MS) {
        lastTap = { key: "", at: 0 };
        onDouble();
        return;
      }
      lastTap = { key, at: now };
    },
  };
}
