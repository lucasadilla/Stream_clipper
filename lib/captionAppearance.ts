import type { RenderFormat } from "@/lib/renderFormat";
import type { CSSProperties } from "react";

export type CaptionVerticalPosition = "top" | "center" | "bottom";
export type CaptionHorizontalPosition = "left" | "center" | "right";
export type CaptionFontWeight = "normal" | "bold";
export type CaptionCapitalization =
  | "none"
  | "uppercase"
  | "lowercase"
  | "title";
export type CaptionAnimation = "none" | "fade" | "pop" | "slideUp";

export interface CaptionAppearance {
  fontFamily: string;
  /** Reference size at 1080p; scaled for preview and export. */
  fontSize: number;
  color: string;
  vertical: CaptionVerticalPosition;
  horizontal: CaptionHorizontalPosition;
  /** Distance from the chosen vertical edge, as % of frame height. */
  verticalOffsetPercent: number;
  backgroundColor: string;
  /** 0–1; 0 disables the caption box fill. */
  backgroundOpacity: number;
  /** Text stroke width (0–8). With a box fill, also pads the box. */
  outlineWidth: number;
  outlineColor: string;
  /** Drop shadow depth (0–8). */
  shadow: number;
  fontWeight: CaptionFontWeight;
  italic: boolean;
  capitalization: CaptionCapitalization;
  karaokeEnabled: boolean;
  /** Active karaoke word color. */
  highlightColor: string;
  animation: CaptionAnimation;
}

export const CAPTION_APPEARANCE_STORAGE_KEY = "stream-clipper-caption-appearance";

export const CAPTION_FONT_PRESETS = [
  "Arial",
  "Helvetica",
  "Georgia",
  "Times New Roman",
  "Verdana",
  "Tahoma",
  "Trebuchet MS",
  "Impact",
  "Comic Sans MS",
  "Courier New",
  "Palatino Linotype",
  "Segoe UI",
  "Roboto",
  "Open Sans",
  "Montserrat",
] as const;

export const DEFAULT_CAPTION_APPEARANCE: CaptionAppearance = {
  fontFamily: "Arial",
  fontSize: 56,
  color: "#FFFFFF",
  vertical: "bottom",
  horizontal: "center",
  verticalOffsetPercent: 13,
  backgroundColor: "#000000",
  backgroundOpacity: 0,
  outlineWidth: 0,
  outlineColor: "#000000",
  shadow: 6,
  fontWeight: "normal",
  italic: false,
  capitalization: "none",
  karaokeEnabled: true,
  highlightColor: "#FFFF00",
  animation: "pop",
};

export function readCaptionAppearancePreference(): CaptionAppearance {
  if (typeof window === "undefined") return DEFAULT_CAPTION_APPEARANCE;
  try {
    const raw = localStorage.getItem(CAPTION_APPEARANCE_STORAGE_KEY);
    if (!raw) return DEFAULT_CAPTION_APPEARANCE;
    return normalizeCaptionAppearance(JSON.parse(raw));
  } catch {
    return DEFAULT_CAPTION_APPEARANCE;
  }
}

export function writeCaptionAppearancePreference(appearance: CaptionAppearance): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    CAPTION_APPEARANCE_STORAGE_KEY,
    JSON.stringify(normalizeCaptionAppearance(appearance))
  );
}

export function normalizeCaptionAppearance(
  input: Partial<CaptionAppearance> | null | undefined
): CaptionAppearance {
  const vertical = input?.vertical;
  const horizontal = input?.horizontal;
  const fontWeight = input?.fontWeight;
  const capitalization = input?.capitalization;
  const animation = input?.animation;

  return {
    fontFamily:
      typeof input?.fontFamily === "string" && input.fontFamily.trim()
        ? input.fontFamily.trim().slice(0, 80)
        : DEFAULT_CAPTION_APPEARANCE.fontFamily,
    fontSize: clamp(
      typeof input?.fontSize === "number" ? input.fontSize : DEFAULT_CAPTION_APPEARANCE.fontSize,
      12,
      96
    ),
    color: normalizeHexColor(input?.color) ?? DEFAULT_CAPTION_APPEARANCE.color,
    vertical:
      vertical === "top" || vertical === "center" || vertical === "bottom"
        ? vertical
        : DEFAULT_CAPTION_APPEARANCE.vertical,
    horizontal:
      horizontal === "left" || horizontal === "center" || horizontal === "right"
        ? horizontal
        : DEFAULT_CAPTION_APPEARANCE.horizontal,
    verticalOffsetPercent: clamp(
      typeof input?.verticalOffsetPercent === "number"
        ? input.verticalOffsetPercent
        : DEFAULT_CAPTION_APPEARANCE.verticalOffsetPercent,
      2,
      40
    ),
    backgroundColor:
      normalizeHexColor(input?.backgroundColor) ??
      DEFAULT_CAPTION_APPEARANCE.backgroundColor,
    backgroundOpacity: clamp(
      typeof input?.backgroundOpacity === "number"
        ? input.backgroundOpacity
        : DEFAULT_CAPTION_APPEARANCE.backgroundOpacity,
      0,
      1
    ),
    outlineWidth: clamp(
      typeof input?.outlineWidth === "number"
        ? input.outlineWidth
        : DEFAULT_CAPTION_APPEARANCE.outlineWidth,
      0,
      8
    ),
    outlineColor:
      normalizeHexColor(input?.outlineColor) ??
      DEFAULT_CAPTION_APPEARANCE.outlineColor,
    shadow: clamp(
      typeof input?.shadow === "number"
        ? input.shadow
        : DEFAULT_CAPTION_APPEARANCE.shadow,
      0,
      8
    ),
    fontWeight:
      fontWeight === "normal" || fontWeight === "bold"
        ? fontWeight
        : DEFAULT_CAPTION_APPEARANCE.fontWeight,
    italic:
      typeof input?.italic === "boolean"
        ? input.italic
        : DEFAULT_CAPTION_APPEARANCE.italic,
    capitalization:
      capitalization === "none" ||
      capitalization === "uppercase" ||
      capitalization === "lowercase" ||
      capitalization === "title"
        ? capitalization
        : DEFAULT_CAPTION_APPEARANCE.capitalization,
    karaokeEnabled:
      typeof input?.karaokeEnabled === "boolean"
        ? input.karaokeEnabled
        : DEFAULT_CAPTION_APPEARANCE.karaokeEnabled,
    highlightColor:
      normalizeHexColor(input?.highlightColor) ??
      DEFAULT_CAPTION_APPEARANCE.highlightColor,
    animation:
      animation === "none" ||
      animation === "fade" ||
      animation === "pop" ||
      animation === "slideUp"
        ? animation
        : DEFAULT_CAPTION_APPEARANCE.animation,
  };
}

export function applyCaptionCapitalization(
  text: string,
  mode: CaptionCapitalization
): string {
  switch (mode) {
    case "uppercase":
      return text.toUpperCase();
    case "lowercase":
      return text.toLowerCase();
    case "title":
      return text.replace(
        /\S+/g,
        (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      );
    default:
      return text;
  }
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(v)) return v.toUpperCase();
  if (/^#[0-9A-Fa-f]{3}$/.test(v)) {
    const r = v[1]!;
    const g = v[2]!;
    const b = v[3]!;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return null;
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = Number.parseInt(h.slice(0, 2), 16);
  const g = Number.parseInt(h.slice(2, 4), 16);
  const b = Number.parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${clamp(alpha, 0, 1)})`;
}

/** CSS for live preview overlay. */
export function captionPreviewStyle(
  appearance: CaptionAppearance,
  containerHeightPx = 400
): { container: CSSProperties; text: CSSProperties } {
  const app = normalizeCaptionAppearance(appearance);
  const scale = containerHeightPx / 1080;
  const fontPx = Math.round(app.fontSize * scale);
  const outlinePx = Math.max(0, app.outlineWidth * scale);
  const shadowPx = Math.max(0, app.shadow * scale);

  const justifyContent =
    app.vertical === "top"
      ? "flex-start"
      : app.vertical === "center"
        ? "center"
        : "flex-end";

  const alignItems =
    app.horizontal === "left"
      ? "flex-start"
      : app.horizontal === "center"
        ? "center"
        : "flex-end";

  // CSS percentage padding is based on container width, even vertically.
  // Convert to pixels from frame height so preview and libass use the same
  // coordinate system and selected position survives export exactly.
  const pad = `${Math.round((app.verticalOffsetPercent / 100) * containerHeightPx)}px`;

  const shadows: string[] = [];
  if (outlinePx > 0) {
    const oc = hexToRgba(app.outlineColor, 1);
    const o = Math.max(1, Math.round(outlinePx));
    for (const [x, y] of [
      [-o, 0],
      [o, 0],
      [0, -o],
      [0, o],
      [-o, -o],
      [o, -o],
      [-o, o],
      [o, o],
    ] as const) {
      shadows.push(`${x}px ${y}px 0 ${oc}`);
    }
  }
  if (shadowPx > 0) {
    shadows.push(
      `0 ${Math.max(1, Math.round(shadowPx))}px ${Math.max(2, Math.round(shadowPx * 2))}px rgba(0,0,0,0.85)`
    );
  }

  return {
    container: {
      display: "flex",
      height: "100%",
      width: "100%",
      flexDirection: "column",
      justifyContent,
      alignItems,
      paddingTop: app.vertical === "bottom" ? 0 : pad,
      paddingBottom: app.vertical === "top" ? 0 : pad,
      paddingLeft: "5%",
      paddingRight: "5%",
    },
    text: {
      fontFamily: `"${app.fontFamily}", sans-serif`,
      fontSize: `${fontPx}px`,
      fontWeight: app.fontWeight === "bold" ? 700 : 400,
      fontStyle: app.italic ? "italic" : "normal",
      color: app.color,
      textAlign:
        app.horizontal === "left"
          ? "left"
          : app.horizontal === "right"
            ? "right"
            : "center",
      lineHeight: 1.35,
      maxWidth: "92%",
      textShadow: shadows.length > 0 ? shadows.join(", ") : "none",
      backgroundColor:
        app.backgroundOpacity > 0
          ? hexToRgba(app.backgroundColor, app.backgroundOpacity)
          : "transparent",
      borderRadius: app.backgroundOpacity > 0 ? "0.375rem" : 0,
      padding:
        app.backgroundOpacity > 0
          ? `${Math.max(2, Math.round(fontPx * 0.12))}px ${Math.max(4, Math.round(fontPx * 0.28))}px`
          : 0,
    },
  };
}

/** ASS/libass alignment (numpad): 7 8 9 / 4 5 6 / 1 2 3 */
export function assAlignment(
  vertical: CaptionVerticalPosition,
  horizontal: CaptionHorizontalPosition
): number {
  const table: Record<CaptionVerticalPosition, Record<CaptionHorizontalPosition, number>> = {
    bottom: { left: 1, center: 2, right: 3 },
    center: { left: 4, center: 5, right: 6 },
    top: { left: 7, center: 8, right: 9 },
  };
  return table[vertical][horizontal];
}

/** #RRGGBB → ASS colour (&HBBGGRR) without alpha. */
export function hexToAssColor(hex: string): string {
  const h = hex.replace("#", "");
  const r = h.slice(0, 2);
  const g = h.slice(2, 4);
  const b = h.slice(4, 6);
  return `&H${b}${g}${r}`.toUpperCase();
}

/**
 * #RRGGBB + opacity 0–1 → ASS &HAABBGGRR
 * ASS alpha is inverted: 00 = opaque, FF = transparent.
 */
export function hexToAssColorWithAlpha(hex: string, opacity: number): string {
  const h = hex.replace("#", "");
  const r = h.slice(0, 2);
  const g = h.slice(2, 4);
  const b = h.slice(4, 6);
  const alpha = Math.round((1 - clamp(opacity, 0, 1)) * 255)
    .toString(16)
    .padStart(2, "0")
    .toUpperCase();
  return `&H${alpha}${b}${g}${r}`.toUpperCase();
}

/** FFmpeg `force_style` fallback when ASS generation is unavailable. */
export function getFfmpegCaptionForceStyle(
  _format: RenderFormat,
  _outputHeight: number,
  appearance: CaptionAppearance = DEFAULT_CAPTION_APPEARANCE
): string {
  const app = normalizeCaptionAppearance(appearance);

  // libass converts SRT into a default 384x288 ASS script and then scales that
  // coordinate space to the output frame. Appearance sizes are defined at a
  // 1080p reference. Convert them into ASS units first; passing pixel values
  // directly makes a 38px editor font render around 140px at 1080p.
  const ASS_PLAY_RES_X = 384;
  const ASS_PLAY_RES_Y = 288;
  const REFERENCE_HEIGHT = 1080;
  const fontSize = Math.max(
    1,
    Math.round((app.fontSize * ASS_PLAY_RES_Y * 10) / REFERENCE_HEIGHT) / 10
  );
  const marginV = Math.round((app.verticalOffsetPercent / 100) * ASS_PLAY_RES_Y);
  const marginH = Math.round(ASS_PLAY_RES_X * 0.05);
  const useBox = app.backgroundOpacity > 0;
  const outline = useBox
    ? Math.max(0.5, Math.round(fontSize * 1.4) / 10 + app.outlineWidth * 0.35)
    : app.outlineWidth;

  return [
    `FontName=${app.fontFamily}`,
    `FontSize=${fontSize}`,
    `Bold=${app.fontWeight === "bold" ? 1 : 0}`,
    `Italic=${app.italic ? 1 : 0}`,
    `PrimaryColour=${hexToAssColor(app.color)}`,
    `OutlineColour=${hexToAssColor(app.outlineColor)}`,
    `BackColour=${hexToAssColorWithAlpha(app.backgroundColor, app.backgroundOpacity)}`,
    `Outline=${outline}`,
    `Shadow=${app.shadow}`,
    `BorderStyle=${useBox ? 3 : 1}`,
    `Alignment=${assAlignment(app.vertical, app.horizontal)}`,
    `MarginV=${marginV}`,
    `MarginL=${marginH}`,
    `MarginR=${marginH}`,
    "WrapStyle=0",
  ].join(",");
}
