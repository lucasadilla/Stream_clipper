import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  buildCenterCropFilter,
  buildPictureInPictureFilter,
  buildStackedFacecamFilter,
  buildSubjectAwareCropFilter,
  buildVerticalLayoutFilter,
  ffmpegColor,
  subjectCropXExpression,
  subjectCropYExpression,
  type FilterBuildContext,
} from "@/lib/verticalLayoutFilters";

const ctx: FilterBuildContext = {
  sourceWidth: 1920,
  sourceHeight: 1080,
  outputWidth: 1080,
  outputHeight: 1920,
};

const facecam = { x: 0.72, y: 0.62, width: 0.24, height: 0.34 };

describe("ffmpegColor", () => {
  it("normalizes hex colors", () => {
    expect(ffmpegColor("#ffffff", "#000000")).toBe("0xFFFFFF");
    expect(ffmpegColor("95ff00", "#000000")).toBe("0x95FF00");
    expect(ffmpegColor("#abc", "#000000")).toBe("0xAABBCC");
  });

  it("allows plain color names", () => {
    expect(ffmpegColor("white", "#000000")).toBe("white");
  });

  it("rejects injection attempts and falls back", () => {
    expect(ffmpegColor("red;drawtext=text=x", "#000000")).toBe("0x000000");
    expect(ffmpegColor("'; rm -rf /", "#FFFFFF")).toBe("0xFFFFFF");
  });
});

describe("buildStackedFacecamFilter", () => {
  it("builds a split + crop + vstack graph", () => {
    const filter = buildStackedFacecamFilter(ctx, facecam);
    expect(filter).toContain("split=2");
    expect(filter).toContain("vstack=inputs=2");
    // Facecam crop in source pixels: ~460x366 at ~1382,669 (even-adjusted)
    expect(filter).toMatch(/crop=460:366:1382:670/);
    expect(filter).toContain("format=yuv420p");
  });

  it("respects the facecam height ratio", () => {
    const filter = buildStackedFacecamFilter(ctx, facecam, {
      facecamHeightRatio: 0.5,
    });
    expect(filter).toContain("scale=1080:960");
  });

  it("stacks gameplay first when the facecam is at the bottom", () => {
    const filter = buildStackedFacecamFilter(ctx, facecam, {
      facecamPosition: "bottom",
    });
    expect(filter).toMatch(/\[game\]\[face\]vstack/);
  });

  it("adds a blur chain when hiding the original facecam", () => {
    const filter = buildStackedFacecamFilter(ctx, facecam, {
      hideOriginalFacecam: "blur",
    });
    expect(filter).toContain("boxblur");
    expect(filter).toContain("overlay");
  });

  it("crops gameplay to the side opposite the embedded facecam", () => {
    const rightFacecam = buildStackedFacecamFilter(ctx, facecam, {
      hideOriginalFacecam: "crop_out",
    });
    expect(rightFacecam).toContain("crop=1080:1190:x=0:y=(ih-oh)/2");

    const leftFacecam = buildStackedFacecamFilter(
      ctx,
      { ...facecam, x: 0.04 },
      { hideOriginalFacecam: "crop_out" }
    );
    expect(leftFacecam).toContain("crop=1080:1190:x=iw-ow:y=(ih-oh)/2");
  });

  it("throws for an invalid facecam rect", () => {
    expect(() =>
      buildStackedFacecamFilter(ctx, { x: 2, y: 0, width: 0.5, height: 0.5 })
    ).toThrow();
  });

  it("executes a time-aligned gameplay crop instead of a static center crop", () => {
    const filter = buildStackedFacecamFilter(
      ctx,
      facecam,
      {},
      facecam,
      undefined,
      {
        keyframes: [
          {
            timestampSeconds: 0,
            centerX: 0.25,
            centerY: 0.5,
            cropWidth: 0.5,
            cropHeight: 1,
            interpolation: "hold",
            reason: "initial_composition",
            confidence: 0.9,
          },
          {
            timestampSeconds: 3,
            centerX: 0.75,
            centerY: 0.5,
            cropWidth: 0.5,
            cropHeight: 1,
            interpolation: "ease_in_out",
            reason: "subject_motion",
            confidence: 0.85,
          },
        ],
      }
    );
    expect(filter).toContain("if(lt(t,3.000)");
    expect(filter).toContain("*(3-2*");
  });
});

describe("buildPictureInPictureFilter", () => {
  it("builds a base + overlay graph with even PiP dimensions", () => {
    const filter = buildPictureInPictureFilter(ctx, facecam, {
      widthRatio: 0.34,
      position: "top_right",
    });
    expect(filter).toContain("split=2");
    expect(filter).toContain("overlay=");
    const scaleMatch = /scale=(\d+):(\d+)(?::force_original_aspect_ratio=increase)?:flags/.exec(
      filter
    );
    expect(scaleMatch).not.toBeNull();
    expect(Number(scaleMatch![1]) % 2).toBe(0);
    expect(Number(scaleMatch![2]) % 2).toBe(0);
  });

  it("keeps bottom placements above platform controls", () => {
    const filter = buildPictureInPictureFilter(ctx, facecam, {
      position: "bottom_right",
      widthRatio: 0.3,
      margin: 0,
    });
    const overlayMatch = /overlay=(\d+):(\d+)/.exec(filter);
    expect(overlayMatch).not.toBeNull();
    const y = Number(overlayMatch![2]);
    // Total PiP height = scaled facecam height + border padding (if any).
    const padMatch = /pad=(\d+):(\d+):/.exec(filter);
    const scaleMatch = /scale=(\d+):(\d+)(?::force_original_aspect_ratio=increase)?:flags/.exec(
      filter
    );
    const totalHeight = Number(padMatch?.[2] ?? scaleMatch![2]);
    // The PiP bottom edge must sit above the bottom 14% platform-controls zone.
    expect(y + totalHeight).toBeLessThanOrEqual(1920 - Math.round(1920 * 0.14));
  });

  it("pads a border with the configured color", () => {
    const filter = buildPictureInPictureFilter(ctx, facecam, {
      borderSize: 4,
      borderColor: "#95ff00",
    });
    expect(filter).toContain("color=0x95FF00");
  });
});

describe("buildCenterCropFilter", () => {
  it("produces an exact 1080x1920 crop", () => {
    const filter = buildCenterCropFilter(ctx);
    expect(filter).toContain("crop=1080:1920");
  });

  it("applies zoom and focal position", () => {
    const filter = buildCenterCropFilter(ctx, { zoom: 1.5, focalPointX: 0.25 });
    expect(filter).toContain("scale=1620:2880");
    expect(filter).toContain("(iw-ow)*0.2500");
  });

  it("builds a blurred background variant", () => {
    const filter = buildCenterCropFilter(ctx, { useBlurredBackground: true });
    expect(filter).toContain("boxblur");
    expect(filter).toContain("force_original_aspect_ratio=decrease");
  });
});

describe("subject-aware crop", () => {
  it("interpolates between keyframes", () => {
    const expr = subjectCropXExpression(
      [
        { timestampSeconds: 0, centerX: 0.3 },
        { timestampSeconds: 2, centerX: 0.7 },
      ],
      3413,
      1080
    );
    expect(expr).toContain("if(lt(t,");
    expect(expr).toContain("min(max(");
  });

  it("returns a static position for one keyframe", () => {
    const expr = subjectCropXExpression(
      [{ timestampSeconds: 0, centerX: 0.5 }],
      3413,
      1080
    );
    expect(expr).not.toContain("if(");
  });

  it("uses cubic easing for planned camera moves", () => {
    const expr = subjectCropXExpression(
      [
        { timestampSeconds: 0, centerX: 0.3 },
        {
          timestampSeconds: 2,
          centerX: 0.7,
          interpolation: "ease_in_out",
        },
      ],
      3413,
      1080
    );
    expect(expr).toContain("*(3-2*");
  });

  it("holds until a cut instead of interpolating across it", () => {
    const expr = subjectCropXExpression(
      [
        { timestampSeconds: 0, centerX: 0.2 },
        { timestampSeconds: 2, centerX: 0.8, interpolation: "cut" },
      ],
      3413,
      1080
    );
    expect(expr).toContain("if(lt(t,2.000),142.6,2190.4)");
  });

  it("builds vertical headroom movement from the same keyframes", () => {
    const expr = subjectCropYExpression(
      [
        { timestampSeconds: 0, centerX: 0.5, centerY: 0.45 },
        {
          timestampSeconds: 2,
          centerX: 0.5,
          centerY: 0.55,
          interpolation: "ease_in_out",
        },
      ],
      2200,
      1920
    );
    expect(expr).toContain("ih-oh");
    expect(expr).toContain("*(3-2*");
  });

  it("falls back to center crop when the source is already narrow", () => {
    const narrowCtx: FilterBuildContext = {
      sourceWidth: 608,
      sourceHeight: 1080,
      outputWidth: 1080,
      outputHeight: 1920,
    };
    const filter = buildSubjectAwareCropFilter(narrowCtx, {
      keyframes: [{ timestampSeconds: 0, centerX: 0.5 }],
    });
    expect(filter).toContain("crop=1080:1920");
    expect(filter).not.toContain("if(lt(t");
  });
});

describe("buildVerticalLayoutFilter", () => {
  it("uses Lanczos scaling for final-quality layout renders", () => {
    const filter = buildVerticalLayoutFilter(
      { layout: "facecam_top_gameplay_bottom", facecamRect: facecam },
      { ...ctx, scaleFlags: "lanczos" }
    );
    expect(filter).toContain("flags=lanczos");
    expect(filter).not.toContain("flags=fast_bilinear");
  });

  it("falls back to center crop when the facecam rect is missing", () => {
    const filter = buildVerticalLayoutFilter(
      { layout: "facecam_top_gameplay_bottom" },
      ctx
    );
    expect(filter).toContain("crop=1080:1920");
    expect(filter).not.toContain("vstack");
  });

  it("routes each layout to its builder", () => {
    expect(
      buildVerticalLayoutFilter(
        { layout: "facecam_top_gameplay_bottom", facecamRect: facecam },
        ctx
      )
    ).toContain("vstack");
    expect(
      buildVerticalLayoutFilter(
        { layout: "facecam_pip", facecamRect: facecam },
        ctx
      )
    ).toContain("overlay");
    expect(
      buildVerticalLayoutFilter({ layout: "center_crop" }, ctx)
    ).toContain("crop=1080:1920");
    expect(
      buildVerticalLayoutFilter(
        {
          layout: "subject_aware_crop",
          subjectCrop: {
            keyframes: [
              { timestampSeconds: 0, centerX: 0.2 },
              { timestampSeconds: 3, centerX: 0.8 },
            ],
          },
        },
        ctx
      )
    ).toContain("crop=1080:1920:x=");
  });

  it("switches from PiP to stacked only during sustained reaction windows", () => {
    const filter = buildVerticalLayoutFilter(
      {
        layout: "facecam_top_gameplay_bottom",
        facecamRect: facecam,
        dynamicSegments: [
          { startTimeSeconds: 0, endTimeSeconds: 4, family: "pip" },
          { startTimeSeconds: 4, endTimeSeconds: 6.5, family: "stacked" },
          { startTimeSeconds: 6.5, endTimeSeconds: 10, family: "pip" },
        ],
      },
      ctx
    );
    expect(filter).toContain("dynamic_pip_input");
    expect(filter).toContain("dynamic_stacked_input");
    expect(filter).toContain("enable='between(t\\,4.000\\,6.500)'");
  });

  it.runIf(process.env.RUN_FFMPEG_LAYOUT_VERIFY === "1")(
    "executes the dynamic gameplay graph in FFmpeg",
    () => {
      const graph = buildVerticalLayoutFilter(
        {
          layout: "facecam_top_gameplay_bottom",
          facecamRect: { x: 0.76, y: 0.04, width: 0.2, height: 0.25 },
          originalFacecamRect: {
            x: 0.76,
            y: 0.04,
            width: 0.2,
            height: 0.25,
          },
          stacked: {
            facecamPosition: "top",
            facecamHeightRatio: 0.34,
            dividerSize: 0,
            dividerColor: "#000000",
            hideOriginalFacecam: "crop_out",
          },
          pip: {
            position: "top_left",
            widthRatio: 0.3,
            margin: 0.04,
            borderSize: 2,
            borderColor: "#ffffff",
            hideOriginalFacecam: "crop_out",
          },
          gameplayCrop: {
            keyframes: [
              { timestampSeconds: 0, centerX: 0.3, centerY: 0.5 },
              {
                timestampSeconds: 1,
                centerX: 0.7,
                centerY: 0.5,
                interpolation: "ease_in_out",
              },
            ],
          },
          dynamicSegments: [
            { startTimeSeconds: 0, endTimeSeconds: 0.75, family: "pip" },
            { startTimeSeconds: 0.75, endTimeSeconds: 1.5, family: "stacked" },
          ],
        },
        {
          sourceWidth: 320,
          sourceHeight: 180,
          outputWidth: 180,
          outputHeight: 320,
          scaleFlags: "lanczos",
        }
      );
      expect(() =>
        execFileSync(process.env.FFMPEG_VERIFY_PATH ?? "ffmpeg", [
          "-hide_banner",
          "-loglevel",
          "error",
          "-f",
          "lavfi",
          "-i",
          "testsrc2=size=320x180:rate=12:duration=1.5",
          "-vf",
          graph,
          "-frames:v",
          "18",
          "-f",
          "null",
          "-",
        ])
      ).not.toThrow();
    }
  );
});
