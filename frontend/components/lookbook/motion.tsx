"use client";

import { useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { motion, useAnimationControls, useInView, useScroll, useTransform, type TargetAndTransition } from "framer-motion";
import type { CardAnimation } from "@/lib/lookbook/types";
import { useRender } from "./context";

/** useLayoutEffect in the browser, nothing on the server, where it only warns. */
const useBrowserLayoutEffect = typeof window === "undefined" ? () => {} : useLayoutEffect;

/** A slow, soft settle: fast out of the gate, a long gentle landing. */
const EASE = [0.22, 1, 0.36, 1] as const;

function hiddenState(animation: CardAnimation): TargetAndTransition {
  switch (animation.type) {
    case "slide": {
      const distance = 48;
      const offsets = { up: { y: distance }, down: { y: -distance }, left: { x: distance }, right: { x: -distance } };
      return { opacity: 0, ...offsets[animation.direction] };
    }
    case "zoom":
      return { opacity: 0, scale: 0.92 };
    default:
      return { opacity: 0 };
  }
}

const SHOWN = { opacity: 1, x: 0, y: 0, scale: 1 };

/** Whether this kind of animation is an entrance (as opposed to parallax or none). */
export const isEntrance = (animation: CardAnimation) => ["fade", "slide", "zoom"].includes(animation.type);

/**
 * Plays a card's entrance when it scrolls into view.
 *
 * The page is rendered on the server, so its first paint arrives before any
 * script. Anything that started hidden would be a blank screen on a slow
 * phone until the JavaScript landed. So on the public page nothing starts
 * hidden. Once the page is live, cards still below the fold are hidden,
 * before the browser paints that frame, and play as they arrive. What was
 * already on screen at first paint simply stays put.
 */
export function Reveal({
  animation,
  delay = 0,
  className,
  style,
  children,
}: {
  animation: CardAnimation;
  /** Added to the animation's own delay, for staggering a gallery. */
  delay?: number;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const { mode, scrollRoot, reduceMotion } = useRender();
  const enabled = mode !== "thumbnail" && !reduceMotion && isEntrance(animation);
  const ref = useRef<HTMLDivElement>(null);
  const controls = useAnimationControls();
  const armed = useRef(false);
  const inView = useInView(ref, { once: true, amount: 0.15, root: scrollRoot ?? undefined });

  useBrowserLayoutEffect(() => {
    if (!enabled || !ref.current) return;
    if (mode === "public") {
      const top = ref.current.getBoundingClientRect().top;
      if (top < window.innerHeight * 0.92) return;
    }
    armed.current = true;
    controls.set(hiddenState(animation));
    // Keyed by the caller on the animation's settings, so this runs once per mount.
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !armed.current || !inView) return;
    void controls.start({
      ...SHOWN,
      transition: {
        duration: Math.min(4, Math.max(0.1, animation.duration)),
        delay: Math.min(4, Math.max(0, animation.delay + delay)),
        ease: EASE,
      },
    });
  }, [enabled, inView, controls, animation.duration, animation.delay, delay]);

  return (
    <motion.div ref={ref} animate={controls} className={className} style={style}>
      {children}
    </motion.div>
  );
}

/**
 * A picture that drifts against the scroll, a little slower than the page.
 * It moves rather than zooms, so a picture shown whole stays whole.
 */
export function Parallax({ strength, className, style, children }: { strength: number; className?: string; style?: CSSProperties; children: ReactNode }) {
  const { mode, scrollRoot, reduceMotion } = useRender();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    container: scrollRoot ?? undefined,
    offset: ["start end", "end start"],
  });
  const distance = 16 + Math.min(1, Math.max(0, strength)) * 84;
  const y = useTransform(scrollYProgress, [0, 1], [distance, -distance]);
  const still = mode === "thumbnail" || reduceMotion;
  return (
    <div ref={ref} className={className} style={style}>
      <motion.div style={still ? undefined : { y }} className="h-full w-full">
        {children}
      </motion.div>
    </div>
  );
}
