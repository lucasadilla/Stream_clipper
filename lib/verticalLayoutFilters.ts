/**
 * FFmpeg filtergraph builders for facecam-aware vertical (9:16) layouts.
 *
 * Every builder returns a filtergraph string that consumes one implicit video
 * input and produces one unlabeled output, so it can be used directly as a
 * `-vf` value (renderShort) or embedded into a `-filter_complex` chain
 * (renderSequence) by prefixing a labeled source and appending an out label.
 *
 * All numeric values are validated/clamped in TypeScript before they reach
 * the graph, and colors are normalized to 0xRRGGBB — no raw user strings are
 * ever interpolated into a filter.
 */

import {
  normalizeRect,
  normalizedRectToPixels,
  type NormalizedRect,
} from "@/lib/normalizedRect";
import type {
  HideOriginalFacecam,
  SubjectCropKeyframe,
} from "@/lib/verticalLayout";

export type ResolvedStackedSettings = {
  facecamPosition: "top" | "bottom";
  facecamHeightRatio: number;
  dividerSize: number;
  dividerColor: string;
  hideOriginalFacecam: HideOriginalFacecam;
};

export type ResolvedPipSettings = {
  position: "top_left" | "top_right" | "bottom_left" | "bottom_right";
  widthRatio: number;
  margin: number;
  borderSize: number;
  borderColor: string;
  hideOriginalFacecam: HideOriginalFacecam;
};

export type ResolvedSubjectCropSettings = {
  keyframes: SubjectCropKeyframe[];
};

export type ResolvedCenterCropSettings = {
  focalPointX: number;
  zoom: number;
  useBlurredBackground: boolean;
};

export type ResolvedVerticalLayout = {
  layout:
    | "facecam_top_gameplay_bottom"
    | "facecam_bottom_gameplay_top"
    | "facecam_pip"
    | "subject_aware_crop"
    | "center_crop";
  /** Resolved facecam crop (auto candidate or manual override). */
  facecamRect?: NormalizedRect;
  /** Where the facecam sits in the original frame (for blur/cover/crop-out). */
  originalFacecamRect?: NormalizedRect;
  stacked?: ResolvedStackedSettings;
  pip?: ResolvedPipSettings;
  subjectCrop?: ResolvedSubjectCropSettings;
  centerCrop?: ResolvedCenterCropSettings;
};

export const DEFAULT_STACKED_SETTINGS: ResolvedStackedSettings = {
  facecamPosition: "top",
  facecamHeightRatio: 0.38,
  dividerSize: 0,
  dividerColor: "#000000",
  hideOriginalFacecam: "none",
};

export const DEFAULT_PIP_SETTINGS: ResolvedPipSettings = {
  position: "top_right",
  widthRatio: 0.34,
  margin: 0.04,
  borderSize: 3,
  borderColor: "#FFFFFF",
  hideOriginalFacecam: "none",
};

export const DEFAULT_CENTER_CROP_SETTINGS: ResolvedCenterCropSettings = {
  focalPointX: 0.5,
  zoom: 1,
  useBlurredBackground: false,
};

const SCALE_FLAGS = "flags=fast_bilinear";

function toEven(value: number): number {
  const rounded = Math.round(value);
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Validate a color into FFmpeg-safe form. Accepts #RGB/#RRGGBB or names. */
export function ffmpegColor(value: string | undefined, fallback: string): string {
  const candidate = (value ?? "").trim();
  const hex6 = /^#?([0-9a-fA-F]{6})$/.exec(candidate);
  if (hex6) return `0x${hex6[1]!.toUpperCase()}`;
  const hex3 = /^#?([0-9a-fA-F]{3})$/.exec(candidate);
  if (hex3) {
    const [r, g, b] = hex3[1]!.split("");
    return `0x${(r! + r! + g! + g! + b! + b!).toUpperCase()}`;
  }
  if (/^[a-zA-Z]{3,20}$/.test(candidate)) return candidate.toLowerCase();
  return ffmpegColor(fallback, "0x000000");
}

export interface FilterBuildContext {
  sourceWidth: number;
  sourceHeight: number;
  outputWidth: number;
  outputHeight: number;
  /** Unique suffix for internal pad labels (needed inside -filter_complex). */
  labelSuffix?: string;
}

function assertContext(ctx: FilterBuildContext): void {
  if (
    !Number.isFinite(ctx.sourceWidth) ||
    !Number.isFinite(ctx.sourceHeight) ||
    ctx.sourceWidth < 2 ||
    ctx.sourceHeight < 2
  ) {
    throw new Error("Invalid source dimensions for vertical layout filter");
  }
  if (
    !Number.isFinite(ctx.outputWidth) ||
    !Number.isFinite(ctx.outputHeight) ||
    ctx.outputWidth < 2 ||
    ctx.outputHeight < 2
  ) {
    throw new Error("Invalid output dimensions for vertical layout filter");
  }
}

/**
 * Filters applied to the gameplay/base branch (in source pixels, before any
 * scaling) that blur or cover the original embedded facecam.
 */
function hideOriginalFacecamSteps(
  mode: HideOriginalFacecam,
  originalRect: NormalizedRect | undefined,
  ctx: FilterBuildContext,
  branchLabel: string
): { filters: string[]; inLabel: string; outLabel: string } | null {
  if (mode !== "blur" && mode !== "cover") return null;
  const rect = originalRect ? normalizeRect(originalRect) : null;
  if (!rect) return null;

  const px = normalizedRectToPixels(rect, ctx.sourceWidth, ctx.sourceHeight);
  if (px.width < 8 || px.height < 8) return null;

  const suffix = ctx.labelSuffix ?? "";
  const inLabel = `${branchLabel}_hide_in${suffix}`;
  const outLabel = `${branchLabel}_hide_out${suffix}`;

  if (mode === "cover") {
    return {
      filters: [
        `[${inLabel}]drawbox=x=${px.x}:y=${px.y}:w=${px.width}:h=${px.height}:color=black:t=fill[${outLabel}]`,
      ],
      inLabel,
      outLabel,
    };
  }

  // Blur: crop the original facecam region, blur it, overlay it back.
  const radius = clamp(Math.floor(Math.min(px.width, px.height) / 4), 2, 32);
  const mainLabel = `${branchLabel}_hide_main${suffix}`;
  const regionLabel = `${branchLabel}_hide_region${suffix}`;
  const blurredLabel = `${branchLabel}_hide_blur${suffix}`;
  return {
    filters: [
      `[${inLabel}]split=2[${mainLabel}][${regionLabel}]`,
      `[${regionLabel}]crop=${px.width}:${px.height}:${px.x}:${px.y},boxblur=${radius}:2[${blurredLabel}]`,
      `[${mainLabel}][${blurredLabel}]overlay=${px.x}:${px.y}[${outLabel}]`,
    ],
    inLabel,
    outLabel,
  };
}

/**
 * Horizontal crop offset expression for a cover-scaled gameplay branch. When
 * hideOriginalFacecam is "crop_out", shift the gameplay window away from the
 * original facecam so it falls outside the crop.
 */
function gameplayCropX(
  hideMode: HideOriginalFacecam,
  originalRect: NormalizedRect | undefined
): string {
  if (hideMode !== "crop_out" || !originalRect) return "(iw-ow)/2";
  const facecamCenter = originalRect.x + originalRect.width / 2;
  // Facecam on the right half -> crop from the left edge, and vice versa.
  return facecamCenter >= 0.5 ? "0" : "iw-ow";
}

// ---------------------------------------------------------------------------
// Facecam + Gameplay (stacked)
// ---------------------------------------------------------------------------

export function buildStackedFacecamFilter(
  ctx: FilterBuildContext,
  facecamRect: NormalizedRect,
  settings: Partial<ResolvedStackedSettings> = {},
  originalFacecamRect?: NormalizedRect
): string {
  assertContext(ctx);
  const cfg = { ...DEFAULT_STACKED_SETTINGS, ...settings };
  const rect = normalizeRect(facecamRect);
  if (!rect) throw new Error("Invalid facecam rectangle for stacked layout");

  const suffix = ctx.labelSuffix ?? "";
  const outW = toEven(ctx.outputWidth);
  const outH = toEven(ctx.outputHeight);
  const divider = toEven(clamp(cfg.dividerSize, 0, 24));
  const ratio = clamp(cfg.facecamHeightRatio, 0.2, 0.55);
  const facePanelH = toEven((outH - divider) * ratio);
  const gamePanelH = outH - divider - facePanelH;
  const dividerColor = ffmpegColor(cfg.dividerColor, "#000000");

  const facePx = normalizedRectToPixels(rect, ctx.sourceWidth, ctx.sourceHeight);

  const filters: string[] = [];
  filters.push(`split=2[face_src${suffix}][game_src${suffix}]`);

  // Facecam panel: crop the region, cover-scale into the panel.
  filters.push(
    `[face_src${suffix}]crop=${facePx.width}:${facePx.height}:${facePx.x}:${facePx.y},` +
      `scale=${outW}:${facePanelH}:force_original_aspect_ratio=increase:${SCALE_FLAGS},` +
      `crop=${outW}:${facePanelH},setsar=1` +
      (divider > 0
        ? `,pad=${outW}:${facePanelH + divider}:0:${cfg.facecamPosition === "top" ? 0 : divider}:color=${dividerColor}`
        : "") +
      `[face${suffix}]`
  );

  // Gameplay panel: optionally hide the original facecam (in source pixels),
  // then cover-scale into its panel.
  let gameIn = `game_src${suffix}`;
  const hide = hideOriginalFacecamSteps(
    cfg.hideOriginalFacecam,
    originalFacecamRect ?? rect,
    ctx,
    "game"
  );
  if (hide) {
    filters.push(`[${gameIn}]null[${hide.inLabel}]`);
    filters.push(...hide.filters);
    gameIn = hide.outLabel;
  }
  const cropX = gameplayCropX(
    cfg.hideOriginalFacecam,
    originalFacecamRect ?? rect
  );
  filters.push(
    `[${gameIn}]scale=${outW}:${gamePanelH}:force_original_aspect_ratio=increase:${SCALE_FLAGS},` +
      `crop=${outW}:${gamePanelH}:x=${cropX},setsar=1[game${suffix}]`
  );

  const stackOrder =
    cfg.facecamPosition === "top"
      ? `[face${suffix}][game${suffix}]`
      : `[game${suffix}][face${suffix}]`;
  filters.push(`${stackOrder}vstack=inputs=2,format=yuv420p`);
  return filters.join(";");
}

// ---------------------------------------------------------------------------
// Picture in Picture
// ---------------------------------------------------------------------------

export function buildPictureInPictureFilter(
  ctx: FilterBuildContext,
  facecamRect: NormalizedRect,
  settings: Partial<ResolvedPipSettings> = {},
  originalFacecamRect?: NormalizedRect
): string {
  assertContext(ctx);
  const cfg = { ...DEFAULT_PIP_SETTINGS, ...settings };
  const rect = normalizeRect(facecamRect);
  if (!rect) throw new Error("Invalid facecam rectangle for PiP layout");

  const suffix = ctx.labelSuffix ?? "";
  const outW = toEven(ctx.outputWidth);
  const outH = toEven(ctx.outputHeight);
  const facePx = normalizedRectToPixels(rect, ctx.sourceWidth, ctx.sourceHeight);

  const widthRatio = clamp(cfg.widthRatio, 0.2, 0.5);
  const border = toEven(clamp(cfg.borderSize, 0, 16));
  const pipW = toEven(outW * widthRatio);
  const pipH = toEven(pipW * (facePx.height / facePx.width));
  const borderColor = ffmpegColor(cfg.borderColor, "#FFFFFF");

  const marginPx = Math.round(clamp(cfg.margin, 0, 0.12) * outW);
  const totalW = pipW + border * 2;
  const totalH = pipH + border * 2;
  // Keep bottom placements above platform UI (TikTok/Reels/Shorts controls).
  const bottomSafePx = Math.round(outH * 0.14);
  const topSafePx = Math.round(outH * 0.05);

  let x: number;
  let y: number;
  switch (cfg.position) {
    case "top_left":
      x = marginPx;
      y = topSafePx + marginPx;
      break;
    case "bottom_left":
      x = marginPx;
      y = outH - totalH - bottomSafePx - marginPx;
      break;
    case "bottom_right":
      x = outW - totalW - marginPx;
      y = outH - totalH - bottomSafePx - marginPx;
      break;
    case "top_right":
    default:
      x = outW - totalW - marginPx;
      y = topSafePx + marginPx;
  }
  x = clamp(Math.round(x), 0, Math.max(0, outW - totalW));
  y = clamp(Math.round(y), 0, Math.max(0, outH - totalH));

  const filters: string[] = [];
  filters.push(`split=2[base_src${suffix}][pip_src${suffix}]`);

  let baseIn = `base_src${suffix}`;
  const hide = hideOriginalFacecamSteps(
    cfg.hideOriginalFacecam,
    originalFacecamRect ?? rect,
    ctx,
    "base"
  );
  if (hide) {
    filters.push(`[${baseIn}]null[${hide.inLabel}]`);
    filters.push(...hide.filters);
    baseIn = hide.outLabel;
  }
  const cropX = gameplayCropX(
    cfg.hideOriginalFacecam,
    originalFacecamRect ?? rect
  );
  filters.push(
    `[${baseIn}]scale=${outW}:${outH}:force_original_aspect_ratio=increase:${SCALE_FLAGS},` +
      `crop=${outW}:${outH}:x=${cropX},setsar=1[base${suffix}]`
  );

  filters.push(
    `[pip_src${suffix}]crop=${facePx.width}:${facePx.height}:${facePx.x}:${facePx.y},` +
      `scale=${pipW}:${pipH}:${SCALE_FLAGS},setsar=1` +
      (border > 0
        ? `,pad=${totalW}:${totalH}:${border}:${border}:color=${borderColor}`
        : "") +
      `[pip${suffix}]`
  );

  filters.push(`[base${suffix}][pip${suffix}]overlay=${x}:${y},format=yuv420p`);
  return filters.join(";");
}

// ---------------------------------------------------------------------------
// Center crop
// ---------------------------------------------------------------------------

export function buildCenterCropFilter(
  ctx: FilterBuildContext,
  settings: Partial<ResolvedCenterCropSettings> = {}
): string {
  assertContext(ctx);
  const cfg = { ...DEFAULT_CENTER_CROP_SETTINGS, ...settings };
  const suffix = ctx.labelSuffix ?? "";
  const outW = toEven(ctx.outputWidth);
  const outH = toEven(ctx.outputHeight);
  const zoom = clamp(cfg.zoom, 1, 2);
  const focal = clamp(cfg.focalPointX, 0, 1);

  const scaleW = toEven(outW * zoom);
  const scaleH = toEven(outH * zoom);
  const focalExpr = `(iw-ow)*${focal.toFixed(4)}`;

  if (cfg.useBlurredBackground) {
    // Blurred cover background + fitted foreground.
    return [
      `split=2[bg_src${suffix}][fg_src${suffix}]`,
      `[bg_src${suffix}]scale=${outW}:${outH}:force_original_aspect_ratio=increase:${SCALE_FLAGS},` +
        `crop=${outW}:${outH},boxblur=20:2[bg${suffix}]`,
      `[fg_src${suffix}]scale=${outW}:${outH}:force_original_aspect_ratio=decrease:${SCALE_FLAGS}[fg${suffix}]`,
      `[bg${suffix}][fg${suffix}]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p`,
    ].join(";");
  }

  return (
    `scale=${scaleW}:${scaleH}:force_original_aspect_ratio=increase:${SCALE_FLAGS},` +
    `crop=${outW}:${outH}:x='${focalExpr}':y=(ih-oh)/2,setsar=1,format=yuv420p`
  );
}

// ---------------------------------------------------------------------------
// Subject-aware crop
// ---------------------------------------------------------------------------

/**
 * Piecewise-linear FFmpeg expression interpolating crop x positions between
 * keyframes. t is relative to the (already cut) segment start.
 */
export function subjectCropXExpression(
  keyframes: SubjectCropKeyframe[],
  scaledWidth: number,
  cropWidth: number
): string {
  const usable = keyframes
    .filter(
      (kf) =>
        Number.isFinite(kf.timestampSeconds) && Number.isFinite(kf.centerX)
    )
    .sort((a, b) => a.timestampSeconds - b.timestampSeconds);

  const toX = (centerX: number): string => {
    const px = clamp(
      centerX * scaledWidth - cropWidth / 2,
      0,
      Math.max(0, scaledWidth - cropWidth)
    );
    return px.toFixed(1);
  };

  if (usable.length === 0) return `(iw-ow)/2`;
  if (usable.length === 1) return toX(usable[0]!.centerX);

  let expr = toX(usable[usable.length - 1]!.centerX);
  for (let i = usable.length - 2; i >= 0; i--) {
    const a = usable[i]!;
    const b = usable[i + 1]!;
    const t0 = Math.max(0, a.timestampSeconds).toFixed(3);
    const t1 = Math.max(0, b.timestampSeconds).toFixed(3);
    const x0 = toX(a.centerX);
    const x1 = toX(b.centerX);
    const span = Math.max(0.001, b.timestampSeconds - a.timestampSeconds);
    const segment = `${x0}+(${x1}-${x0})*(t-${t0})/${span.toFixed(3)}`;
    expr = `if(lt(t,${t1}),${segment},${expr})`;
  }
  // Before the first keyframe hold the first position.
  const first = usable[0]!;
  expr = `if(lt(t,${Math.max(0, first.timestampSeconds).toFixed(3)}),${toX(first.centerX)},${expr})`;
  return `min(max(${expr},0),iw-ow)`;
}

export function buildSubjectAwareCropFilter(
  ctx: FilterBuildContext,
  settings: ResolvedSubjectCropSettings
): string {
  assertContext(ctx);
  const outW = toEven(ctx.outputWidth);
  const outH = toEven(ctx.outputHeight);

  // Scale so the height matches the output exactly; the crop then pans
  // horizontally across the scaled width.
  const scaledWidth = toEven((ctx.sourceWidth * outH) / ctx.sourceHeight);
  if (scaledWidth <= outW) {
    // Source is already 9:16 or taller — nothing to pan across.
    return buildCenterCropFilter(ctx);
  }

  const xExpr = subjectCropXExpression(
    settings.keyframes,
    scaledWidth,
    outW
  );
  return (
    `scale=${scaledWidth}:${outH}:${SCALE_FLAGS},` +
    `crop=${outW}:${outH}:x='${xExpr}':y=0,setsar=1,format=yuv420p`
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Build the full vertical-layout filtergraph for a resolved configuration.
 * Falls back to a plain center crop whenever the requested layout is missing
 * required data (e.g. no facecam rect) so a render never hard-fails on
 * detection issues.
 */
export function buildVerticalLayoutFilter(
  layout: ResolvedVerticalLayout,
  ctx: FilterBuildContext
): string {
  assertContext(ctx);
  switch (layout.layout) {
    case "facecam_top_gameplay_bottom":
    case "facecam_bottom_gameplay_top": {
      if (!layout.facecamRect) return buildCenterCropFilter(ctx, layout.centerCrop);
      const stacked: Partial<ResolvedStackedSettings> = {
        ...layout.stacked,
        facecamPosition:
          layout.layout === "facecam_bottom_gameplay_top" ? "bottom" : "top",
      };
      return buildStackedFacecamFilter(
        ctx,
        layout.facecamRect,
        stacked,
        layout.originalFacecamRect
      );
    }
    case "facecam_pip": {
      if (!layout.facecamRect) return buildCenterCropFilter(ctx, layout.centerCrop);
      return buildPictureInPictureFilter(
        ctx,
        layout.facecamRect,
        layout.pip,
        layout.originalFacecamRect
      );
    }
    case "subject_aware_crop": {
      if (!layout.subjectCrop || layout.subjectCrop.keyframes.length === 0) {
        return buildCenterCropFilter(ctx, layout.centerCrop);
      }
      return buildSubjectAwareCropFilter(ctx, layout.subjectCrop);
    }
    case "center_crop":
    default:
      return buildCenterCropFilter(ctx, layout.centerCrop);
  }
}
