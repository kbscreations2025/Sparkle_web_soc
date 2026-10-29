"use client";

import type { CSSProperties, ReactNode } from "react";
import { ImageIcon } from "lucide-react";
import type { AffinityPiece } from "@/lib/affinity";
import {
  SLIDE_H,
  SLIDE_W,
  backgroundBox,
  backgroundSource,
  fontStack,
  imageSource,
  type DesignElement,
  type DesignSlide,
  type ShapeElement,
  type SlideBackgroundImage,
  type TextElement,
} from "@/lib/deckDesign";

/**
 * One slide, drawn at its native 1280×720 and scaled as a whole — so every
 * position in the design is a plain slide coordinate whatever size the slide
 * is shown at, and the thumbnails, the canvas and the print are one drawing.
 */
export function SlideView({
  slide,
  pieces,
  scale,
  renderElement,
  children,
  className,
}: {
  slide: DesignSlide;
  pieces: AffinityPiece[];
  scale: number;
  /** The editor wraps each element to make it interactive; elsewhere it is drawn as is. */
  renderElement?: (element: DesignElement, drawn: ReactNode) => ReactNode;
  /** Overlays in slide coordinates — selection, guides, marquee. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={className} style={{ width: SLIDE_W * scale, height: SLIDE_H * scale, position: "relative", overflow: "hidden" }}>
      <div
        style={{
          width: SLIDE_W,
          height: SLIDE_H,
          background: slide.background,
          transform: `scale(${scale})`,
          transformOrigin: "0 0",
          position: "absolute",
          left: 0,
          top: 0,
        }}
      >
        {slide.backgroundImage && <BackgroundPicture image={slide.backgroundImage} pieces={pieces} />}
        {slide.elements.map((element) => {
          const drawn = <ElementBody element={element} pieces={pieces} />;
          return renderElement ? (
            renderElement(element, drawn)
          ) : (
            <div key={element.id} style={elementFrame(element)}>
              {drawn}
            </div>
          );
        })}
        {children}
      </div>
    </div>
  );
}

/** A page's background picture, under every element and never hit by the pointer. */
function BackgroundPicture({ image, pieces }: { image: SlideBackgroundImage; pieces: AffinityPiece[] }) {
  const src = backgroundSource(image, pieces);
  if (!src) return null;
  const box = backgroundBox(image);
  return (
    /* eslint-disable-next-line @next/next/no-img-element -- fixed slide geometry, as for elements */
    <img
      src={src}
      alt=""
      draggable={false}
      style={{
        position: "absolute",
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h,
        objectFit: image.mode === "fill" ? "cover" : "contain",
        opacity: image.opacity,
        pointerEvents: "none",
      }}
    />
  );
}

/** Where an element sits, in slide coordinates. */
export function elementFrame(element: DesignElement): CSSProperties {
  return {
    position: "absolute",
    left: element.x,
    top: element.y,
    width: element.w,
    height: element.h,
    transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
    opacity: element.opacity,
  };
}

export function textStyle(element: TextElement): CSSProperties {
  return {
    fontFamily: fontStack(element.fontFamily),
    fontSize: element.fontSize,
    fontWeight: element.bold ? 700 : 400,
    fontStyle: element.italic ? "italic" : "normal",
    textDecoration: element.underline ? "underline" : "none",
    color: element.color,
    textAlign: element.align,
    letterSpacing: element.letterSpacing,
    lineHeight: element.lineHeight,
    textTransform: element.uppercase ? "uppercase" : "none",
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    width: "100%",
  };
}

export function ElementBody({ element, pieces, showPlaceholder }: { element: DesignElement; pieces: AffinityPiece[]; showPlaceholder?: boolean }) {
  if (element.type === "text") {
    if (!element.text && showPlaceholder) {
      return <div style={{ ...textStyle(element), opacity: 0.35 }}>{element.placeholder || "Type something"}</div>;
    }
    return <div style={textStyle(element)}>{element.text}</div>;
  }

  if (element.type === "image") {
    const src = imageSource(element, pieces);
    if (!src) {
      return (
        <div className="flex h-full w-full items-center justify-center" style={{ background: "#F2EEE8", borderRadius: element.radius }}>
          <ImageIcon size={28} color="#B4A794" />
        </div>
      );
    }
    return (
      /* eslint-disable-next-line @next/next/no-img-element -- fixed slide geometry; next/image's sizing fights it */
      <img
        src={src}
        alt=""
        draggable={false}
        style={{ width: "100%", height: "100%", objectFit: element.fit, borderRadius: element.radius, display: "block" }}
      />
    );
  }

  return <ShapeBody element={element} />;
}

/** The four-point mark from the customer's own cover artwork, in a 24×24 box. */
const SPARKLE_PATH =
  "M12 0 C12 6 14 10 12 12 C10 10 12 6 12 0 Z M12 24 C12 18 10 14 12 12 C14 14 12 18 12 24 Z M0 12 C6 12 10 14 12 12 C10 10 6 12 0 12 Z M24 12 C18 12 14 10 12 12 C14 14 18 12 24 12 Z";

/** Polygon corners for the straight-sided shapes, in the element's own w×h box. */
function polygonPoints(shape: ShapeElement["shape"], w: number, h: number): [number, number][] | null {
  switch (shape) {
    case "diamond":
      return [[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]];
    case "triangle":
      return [[w / 2, 0], [w, h], [0, h]];
    case "hexagon":
      return [[w * 0.25, 0], [w * 0.75, 0], [w, h / 2], [w * 0.75, h], [w * 0.25, h], [0, h / 2]];
    case "octagon": {
      const cx = w * 0.29;
      const cy = h * 0.29;
      return [[cx, 0], [w - cx, 0], [w, cy], [w, h - cy], [w - cx, h], [cx, h], [0, h - cy], [0, cy]];
    }
    case "arrow":
      return [[0, h * 0.3], [w * 0.6, h * 0.3], [w * 0.6, 0], [w, h / 2], [w * 0.6, h], [w * 0.6, h * 0.7], [0, h * 0.7]];
    case "chevron":
      return [[0, 0], [w * 0.7, 0], [w, h / 2], [w * 0.7, h], [0, h], [w * 0.3, h / 2]];
    case "plus": {
      const a = w / 3;
      const b = h / 3;
      return [[a, 0], [2 * a, 0], [2 * a, b], [w, b], [w, 2 * b], [2 * a, 2 * b], [2 * a, h], [a, h], [a, 2 * b], [0, 2 * b], [0, b], [a, b]];
    }
    case "parallelogram":
      return [[w * 0.25, 0], [w, 0], [w * 0.75, h], [0, h]];
    case "star":
      return Array.from({ length: 10 }, (_, i) => {
        const angle = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 === 0 ? 0.5 : 0.2;
        return [w / 2 + Math.cos(angle) * r * w, h / 2 + Math.sin(angle) * r * h * 1.05 + h * 0.03] as [number, number];
      });
    default:
      return null;
  }
}

const HEART_PATH = "M12 21 C12 21 2 14.5 2 8.5 C2 5 4.5 3 7.2 3 C9.2 3 11 4.2 12 6 C13 4.2 14.8 3 16.8 3 C19.5 3 22 5 22 8.5 C22 14.5 12 21 12 21 Z";

function ShapeBody({ element }: { element: ShapeElement }) {
  const { w, h, fill, stroke, strokeWidth: sw } = element;
  const dashArray = element.dash === "dash" ? `${sw * 4} ${sw * 2.5}` : element.dash === "dot" ? `0 ${sw * 2.2}` : undefined;
  const strokeProps =
    sw > 0 && stroke !== "transparent"
      ? { stroke, strokeWidth: sw, strokeDasharray: dashArray, strokeLinecap: element.dash === "dot" ? ("round" as const) : undefined }
      : { stroke: "none" };
  // Only what is painted can be clicked: an outline-only frame must not swallow clicks on the page inside it.
  const hit = { pointerEvents: "visiblePainted" } as const;

  if (element.shape === "heart") {
    return (
      <svg width="100%" height="100%" viewBox="2 3 20 18" preserveAspectRatio="none" style={{ display: "block", overflow: "visible", pointerEvents: "none" }}>
        <path d={HEART_PATH} fill={fill} {...strokeProps} strokeWidth={sw > 0 ? (sw * 20) / Math.max(w, 1) : 0} style={hit} />
      </svg>
    );
  }

  const points = polygonPoints(element.shape, w, h);
  if (points) {
    return (
      <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: "block", overflow: "visible", pointerEvents: "none" }}>
        <polygon points={points.map(([x, y]) => `${x},${y}`).join(" ")} fill={fill} {...strokeProps} strokeLinejoin="round" style={hit} />
      </svg>
    );
  }

  if (element.shape === "sparkle") {
    return (
      <svg width="100%" height="100%" viewBox="0 0 24 24" preserveAspectRatio="none" style={{ display: "block", overflow: "visible", pointerEvents: "none" }}>
        <path d={SPARKLE_PATH} fill={fill} style={hit} />
      </svg>
    );
  }

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: "block", overflow: "visible", pointerEvents: "none" }}>
      {element.shape === "rect" && (
        <rect
          x={sw / 2}
          y={sw / 2}
          width={Math.max(0, w - sw)}
          height={Math.max(0, h - sw)}
          rx={element.radius}
          fill={fill}
          {...strokeProps}
          style={hit}
        />
      )}
      {element.shape === "ellipse" && (
        <ellipse cx={w / 2} cy={h / 2} rx={Math.max(0, w / 2 - sw / 2)} ry={Math.max(0, h / 2 - sw / 2)} fill={fill} {...strokeProps} style={hit} />
      )}
      {element.shape === "line" && (
        <>
          <line
            x1={0}
            y1={h / 2}
            x2={w}
            y2={h / 2}
            stroke={stroke !== "transparent" ? stroke : fill}
            strokeWidth={Math.max(1, sw)}
            strokeDasharray={dashArray}
            strokeLinecap={element.dash === "dot" ? "round" : undefined}
          />
          {/* A wider invisible band, so a hairline can still be picked up. */}
          <line x1={0} y1={h / 2} x2={w} y2={h / 2} stroke="transparent" strokeWidth={14} style={{ pointerEvents: "stroke" }} />
        </>
      )}
    </svg>
  );
}
