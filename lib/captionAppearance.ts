import type { RenderFormat } from "@/lib/renderFormat";
import type { CSSProperties } from "react";

export type CaptionVerticalPosition = "top" | "center" | "bottom";
export type CaptionHorizontalPosition = "left" | "center" | "right";

export interface CaptionAppearance {
  fontFamily: string;
  /** Reference size at 1080p; scaled for preview and export. */
  fontSize: number;
  color: string;
  vertical: CaptionVerticalPosition;
  horizontal: CaptionHorizontalPosition;
  /** Distance from the chosen vertical edge, as % of frame height. */
  verticalOffsetPercent: number;
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
  fontSize: 28,
  color: "#FFFFFF",
  vertical: "bottom",
  horizontal: "center",
  verticalOffsetPercent: 10,
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
  };
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

/** CSS for live preview overlay. */
export function captionPreviewStyle(
  appearance: CaptionAppearance,
  containerHeightPx = 400
): { container: CSSProperties; text: CSSProperties } {
  const scale = containerHeightPx / 1080;
  const fontPx = Math.round(appearance.fontSize * scale);

  const justifyContent =
    appearance.vertical === "top"
      ? "flex-start"
      : appearance.vertical === "center"
        ? "center"
        : "flex-end";

  const alignItems =
    appearance.horizontal === "left"
      ? "flex-start"
      : appearance.horizontal === "center"
        ? "center"
        : "flex-end";

  const pad = `${appearance.verticalOffsetPercent}%`;

  return {
    container: {
      display: "flex",
      height: "100%",
      width: "100%",
      flexDirection: "column",
      justifyContent,
      alignItems,
      paddingTop: appearance.vertical === "bottom" ? 0 : pad,
      paddingBottom: appearance.vertical === "top" ? 0 : pad,
      paddingLeft: "5%",
      paddingRight: "5%",
    },
    text: {
      fontFamily: `"${appearance.fontFamily}", sans-serif`,
      fontSize: `${fontPx}px`,
      fontWeight: 700,
      color: appearance.color,
      textAlign:
        appearance.horizontal === "left"
          ? "left"
          : appearance.horizontal === "right"
            ? "right"
            : "center",
      lineHeight: 1.35,
      maxWidth: "92%",
      textShadow: "0 2px 8px rgba(0,0,0,0.95), 0 0 2px rgba(0,0,0,1)",
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

/** #RRGGBB → ASS PrimaryColour (&HBBGGRR). */
export function hexToAssColor(hex: string): string {
  const h = hex.replace("#", "");
  const r = h.slice(0, 2);
  const g = h.slice(2, 4);
  const b = h.slice(4, 6);
  return `&H${b}${g}${r}`.toUpperCase();
}

/** FFmpeg `force_style` from user appearance + output format. */
export function getFfmpegCaptionForceStyle(
  format: RenderFormat,
  outputHeight: number,
  appearance: CaptionAppearance = DEFAULT_CAPTION_APPEARANCE
): string {
  const app = normalizeCaptionAppearance(appearance);
  const baseH = format === "vertical" ? 1920 : 1080;
  const scale = outputHeight / baseH;
  const fontSize = Math.max(12, Math.round(app.fontSize * scale));
  const marginV = Math.round((app.verticalOffsetPercent / 100) * outputHeight);
  const marginH = Math.round(48 * scale);

  return [
    `FontName=${app.fontFamily}`,
    `FontSize=${fontSize}`,
    "Bold=1",
    `PrimaryColour=${hexToAssColor(app.color)}`,
    "OutlineColour=&H000000",
    "Outline=2",
    "BorderStyle=1",
    `Alignment=${assAlignment(app.vertical, app.horizontal)}`,
    `MarginV=${marginV}`,
    `MarginL=${marginH}`,
    `MarginR=${marginH}`,
    "WrapStyle=0",
  ].join(",");
}
