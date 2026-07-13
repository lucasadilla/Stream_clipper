"use client";

import * as React from "react";
import { Dithering } from "@paper-design/shaders-react";

import { cn } from "@/lib/cn";

const MemoizedDithering = React.memo(Dithering);

/**
 * Full-bleed dithering shader background (from the 21st.dev Hero Dithering
 * Card) meant to sit behind a section's content. Parent needs `relative`.
 */
export function DitheringBackground({
  className,
  colorBack = "#edf5e8",
  colorFront = "#95ff00",
  speed = 0.5,
  washOpacity = 0.45,
}: {
  className?: string;
  colorBack?: string;
  colorFront?: string;
  speed?: number;
  /** 0–1 wash of the back color layered on top to keep text readable. */
  washOpacity?: number;
}) {
  return (
    <div
      className={cn("pointer-events-none absolute inset-0", className)}
      aria-hidden="true"
    >
      <MemoizedDithering
        colorBack={colorBack}
        colorFront={colorFront}
        shape="swirl"
        type="4x4"
        size={2}
        speed={speed}
        scale={0.6}
        style={{ height: "100%", width: "100%" }}
      />
      <div
        className="absolute inset-0"
        style={{ backgroundColor: colorBack, opacity: washOpacity }}
      />
    </div>
  );
}

export default DitheringBackground;
