import { describe, expect, it } from "vitest";
import {
  detectVisualChanges,
  parsePortableGraymap,
  sanitizeStructuredVisualContext,
  selectVisualEvidenceTimestamps,
  VISUAL_ANALYSIS_VERSION,
  type GrayFrame,
} from "@/lib/visualAnalysis";
import {
  DEFAULT_VISUAL_ANALYSIS_BUDGET,
  VisualAnalysisBudgetService,
} from "@/services/visualAnalysisBudgetService";

function frame(
  timestampSeconds: number,
  fill: (x: number, y: number) => number
): GrayFrame {
  const width = 18;
  const height = 10;
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      pixels[y * width + x] = fill(x, y);
    }
  }
  return { timestampSeconds, width, height, pixels };
}

describe("local visual discovery", () => {
  it("parses FFmpeg binary grayscale frames", () => {
    const header = Buffer.from("P5\n3 2\n255\n", "ascii");
    const raster = Buffer.from([0, 10, 20, 30, 40, 255]);
    const parsed = parsePortableGraymap(
      Buffer.concat([header, raster]),
      12.5
    );
    expect(parsed.width).toBe(3);
    expect(parsed.height).toBe(2);
    expect([...parsed.pixels]).toEqual([...raster]);
    expect(parsed.timestampSeconds).toBe(12.5);
  });

  it("detects true scene changes instead of fixed timestamp placeholders", () => {
    const result = detectVisualChanges(
      [
        frame(0, () => 0),
        frame(2, () => 4),
        frame(4, () => 255),
      ],
      2
    );
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.type).toBe("scene_change");
    expect(result.events[0]?.startTimeSeconds).toBe(2);
    expect(result.events[0]?.rawData.difference).toBeGreaterThan(0.9);
  });

  it("detects localized interface changes separately from motion", () => {
    const result = detectVisualChanges(
      [
        frame(0, () => 30),
        frame(2, (_x, y) => (y >= 8 ? 150 : 30)),
      ],
      2
    );
    expect(result.events[0]?.type).toBe("interface_change");
    expect(result.events[0]?.rawData.bottomBandDifference).toBeGreaterThan(
      result.events[0]?.rawData.middleBandDifference ?? 1
    );
  });

  it("selects detected-event frames instead of only even spacing", () => {
    const selected = selectVisualEvidenceTimestamps({
      startTimeSeconds: 100,
      endTimeSeconds: 140,
      focusTimeSeconds: 122,
      maximumFrames: 8,
      events: [
        { startTimeSeconds: 111, endTimeSeconds: 113, score: 9 },
        { startTimeSeconds: 132, endTimeSeconds: 134, score: 6 },
      ],
    });
    expect(selected).toContain(112);
    expect(selected).toContain(122);
    expect(selected.length).toBeLessThanOrEqual(8);
  });

  it("covers a short clip at roughly one frame per second", () => {
    const selected = selectVisualEvidenceTimestamps({
      startTimeSeconds: 20,
      endTimeSeconds: 30,
      focusTimeSeconds: 25,
      maximumFrames: 12,
      events: [],
    });
    const gaps = selected
      .slice(1)
      .map((timestamp, index) => timestamp - selected[index]!);

    expect(selected[0]).toBe(20);
    expect(selected.at(-1)).toBe(30);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(1.05);
  });

  it("keeps dense time-aligned observations for framing", () => {
    const context = sanitizeStructuredVisualContext({
      version: VISUAL_ANALYSIS_VERSION,
      sourceId: "source-1",
      startTimeSeconds: 0,
      endTimeSeconds: 24,
      eventType: "demonstration",
      summary: "The visible focus changes throughout the clip.",
      events: Array.from({ length: 24 }, (_, index) => ({
        timeSeconds: index,
        type: "context" as const,
        description: `Visible state ${index}`,
        confidence: 0.8,
      })),
      confidence: 0.8,
      uncertainties: [],
      sufficient: true,
      analysisLevel: "screenshots",
      modelVersion: "test",
      evidence: [],
    });

    expect(context.events).toHaveLength(24);
  });

  it("preserves bounded cursor targets and simple Shorts layout hints", () => {
    const context = sanitizeStructuredVisualContext({
      version: VISUAL_ANALYSIS_VERSION,
      sourceId: "source-screen",
      startTimeSeconds: 0,
      endTimeSeconds: 5,
      eventType: "screen_demo",
      summary: "The cursor selects the export control.",
      events: [
        {
          timeSeconds: 2,
          type: "action",
          description: "The pointer clicks the export control.",
          confidence: 0.95,
          layoutHint: "screen_focus",
          cursor: {
            point: { x: 1.2, y: -0.1 },
            targetRect: { x: 0.7, y: 0.2, width: 0.24, height: 0.2 },
            action: "clicking",
            confidence: 1.4,
          },
          importanceRegions: [
            {
              rect: { x: 0.7, y: 0.2, width: 0.24, height: 0.2 },
              category: "visual_focus",
              strength: 0.95,
              attentionSource: "cursor_target",
            },
          ],
        },
      ],
      confidence: 0.9,
      uncertainties: [],
      sufficient: true,
      analysisLevel: "screenshots",
      modelVersion: "test",
      evidence: [],
    });

    expect(context.events[0]?.layoutHint).toBe("screen_focus");
    expect(context.events[0]?.cursor?.point).toEqual({ x: 1, y: 0 });
    expect(context.events[0]?.cursor?.confidence).toBe(1);
    expect(context.events[0]?.importanceRegions?.[0]?.attentionSource).toBe(
      "cursor_target"
    );
  });
});

describe("visual analysis budget", () => {
  const baseSignals = {
    candidateScore: 75,
    contentType: "gaming" as const,
    cached: false,
    hasPaidProvider: true,
    hasTranscriptEvidence: true,
    localVisualScore: 8,
    audioScore: 6,
    chatScore: 7,
    fastAction: true,
    ambiguity: 0.7,
  };

  it("uses screenshots first for strong temporal candidates", () => {
    const budget = new VisualAnalysisBudgetService({
      ...DEFAULT_VISUAL_ANALYSIS_BUDGET,
      streamBudgetUsd: 0.2,
    });
    const decision = budget.decide(baseSignals);
    expect(decision.level).toBe("screenshots_then_video");
    expect(decision.maximumFrames).toBeGreaterThanOrEqual(8);
    expect(budget.usage.spentUsd).toBeGreaterThan(0);
  });

  it("reuses cached evidence without spending budget", () => {
    const budget = new VisualAnalysisBudgetService();
    expect(budget.decide({ ...baseSignals, cached: true }).level).toBe("cached");
    expect(budget.usage.spentUsd).toBe(0);
  });

  it("stops paid analysis when the stream budget is exhausted", () => {
    const budget = new VisualAnalysisBudgetService({
      ...DEFAULT_VISUAL_ANALYSIS_BUDGET,
      streamBudgetUsd: 0.008,
      screenshotCandidateCostUsd: 0.008,
    });
    expect(budget.decide(baseSignals).level).toBe("screenshots_then_video");
    expect(budget.decide(baseSignals).level).toBe("local_only");
    expect(budget.reserveVideoEscalation()).toBe(false);
  });

  it("carries prior stream usage into later live passes", () => {
    const budget = new VisualAnalysisBudgetService(
      {
        ...DEFAULT_VISUAL_ANALYSIS_BUDGET,
        streamBudgetUsd: 0.2,
      },
      { spentUsd: 0.198, analyzedCandidates: 4 }
    );
    expect(budget.decide(baseSignals).level).toBe("local_only");
    expect(budget.usage.remainingUsd).toBeCloseTo(0.002);
  });
});
