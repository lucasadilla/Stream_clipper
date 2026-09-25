import { z } from "zod";

export const renderQualityCategorySchema = z.enum([
  "framing",
  "captions",
  "cuts",
  "clarity",
  "platform",
  "audio",
]);

export const renderQualityIssueSchema = z.object({
  severity: z.enum(["warning", "critical"]),
  category: renderQualityCategorySchema,
  timestampSeconds: z.number().finite().nonnegative().nullable(),
  title: z.string().trim().min(1).max(100),
  evidence: z.string().trim().min(1).max(320),
  recommendation: z.string().trim().min(1).max(320),
});

export const renderQualityScoresSchema = z.object({
  framing: z.number().finite().min(0).max(100).transform(Math.round),
  captions: z.number().finite().min(0).max(100).transform(Math.round),
  cuts: z.number().finite().min(0).max(100).transform(Math.round),
  clarity: z.number().finite().min(0).max(100).transform(Math.round),
  platformReadiness: z.number().finite().min(0).max(100).transform(Math.round),
});

export const postRenderQualityReviewSchema = z.object({
  version: z.literal(1),
  verdict: z.enum(["pass", "review", "fail"]),
  score: z.number().int().min(0).max(100),
  summary: z.string().trim().min(1).max(360),
  scores: renderQualityScoresSchema,
  issues: z.array(renderQualityIssueSchema).max(8),
  strengths: z.array(z.string().trim().min(1).max(180)).max(4),
  reviewer: z.enum(["ai_visual", "technical_only"]),
  model: z.string().trim().min(1).max(120).nullable(),
  samplesReviewed: z.number().int().min(0).max(12),
  reviewedAt: z.string().datetime(),
});

export type RenderQualityIssue = z.infer<typeof renderQualityIssueSchema>;
export type RenderQualityScores = z.infer<typeof renderQualityScoresSchema>;
export type PostRenderQualityReview = z.infer<
  typeof postRenderQualityReviewSchema
>;

const aiCriticResponseSchema = z.object({
  summary: z.string().trim().min(1).max(360),
  scores: renderQualityScoresSchema,
  issues: z.array(renderQualityIssueSchema).max(8).default([]),
  strengths: z.array(z.string().trim().min(1).max(180)).max(4).default([]),
});

export interface TechnicalReviewInput {
  durationSeconds: number;
  expectedDurationSeconds: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string | null;
  audioCodec: string | null;
  fileSizeBytes: number;
  format: "vertical" | "native";
  expectedDimensions?: { width: number; height: number };
  sourceDimensions?: { width: number; height: number };
  expectsAudio: boolean;
  expectsCaptions: boolean;
}

export interface AiCriticReview {
  summary: string;
  scores: RenderQualityScores;
  issues: RenderQualityIssue[];
  strengths: string[];
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function dedupeTimes(times: number[], durationSeconds: number): number[] {
  const maxTime = Math.max(0.05, durationSeconds - 0.05);
  const seen = new Set<number>();
  for (const value of times) {
    if (!Number.isFinite(value)) continue;
    const rounded = Math.round(Math.max(0, Math.min(maxTime, value)) * 20) / 20;
    seen.add(rounded);
  }
  return [...seen].sort((a, b) => a - b);
}

/** Select broad coverage plus before/after frames at edit boundaries. */
export function buildCriticSampleTimes(
  durationSeconds: number,
  cutTimes: number[] = [],
  maxSamples = 6
): number[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return [];
  if (durationSeconds < 0.5) return [Math.max(0, durationSeconds / 2)];

  const edge = Math.min(0.35, durationSeconds * 0.08);
  const baseline = [
    edge,
    durationSeconds * 0.2,
    durationSeconds * 0.5,
    durationSeconds * 0.8,
    durationSeconds - edge,
  ];
  const cutFrames = cutTimes.flatMap((time) => [time - 0.08, time + 0.08]);
  const candidates = dedupeTimes([...cutFrames, ...baseline], durationSeconds);
  if (candidates.length <= maxSamples) return candidates;

  const selected = dedupeTimes([edge, durationSeconds - edge], durationSeconds);
  const cutCandidates = dedupeTimes(cutFrames, durationSeconds);
  const cutSlots = Math.max(0, maxSamples - selected.length);
  if (cutCandidates.length <= cutSlots) {
    selected.push(...cutCandidates);
  } else if (cutSlots === 1) {
    selected.push(cutCandidates[Math.floor(cutCandidates.length / 2)]!);
  } else {
    for (let index = 0; index < cutSlots; index += 1) {
      const candidateIndex = Math.round(
        (index * (cutCandidates.length - 1)) / (cutSlots - 1)
      );
      selected.push(cutCandidates[candidateIndex]!);
    }
  }
  for (const value of candidates) {
    if (selected.length >= maxSamples) break;
    if (!selected.includes(value)) selected.push(value);
  }
  return selected.sort((a, b) => a - b);
}

export function buildTechnicalQualityReview(
  input: TechnicalReviewInput
): PostRenderQualityReview {
  const issues: RenderQualityIssue[] = [];
  const scores: RenderQualityScores = {
    framing: 100,
    captions: 100,
    cuts: 100,
    clarity: 100,
    platformReadiness: 100,
  };

  if (input.sourceDimensions) {
    const sourceShortSide = Math.min(
      input.sourceDimensions.width,
      input.sourceDimensions.height
    );
    if (sourceShortSide < 720) {
      issues.push({
        severity: "warning",
        category: "clarity",
        timestampSeconds: null,
        title: "Source video is low resolution",
        evidence: `The source is only ${input.sourceDimensions.width}x${input.sourceDimensions.height}; a larger export cannot restore missing detail.`,
        recommendation: "Use the original HD source video and render again.",
      });
      scores.clarity = Math.min(scores.clarity, 40);
      scores.platformReadiness = Math.min(scores.platformReadiness, 65);
    }
  }

  if (!input.videoCodec || input.width <= 0 || input.height <= 0) {
    issues.push({
      severity: "critical",
      category: "clarity",
      timestampSeconds: 0,
      title: "Video stream could not be verified",
      evidence: "The completed file did not report a valid video stream or dimensions.",
      recommendation: "Render the clip again before publishing it.",
    });
    scores.clarity = 20;
    scores.platformReadiness = 20;
  }

  const durationDelta = Math.abs(
    input.durationSeconds - input.expectedDurationSeconds
  );
  const durationTolerance = Math.max(0.75, input.expectedDurationSeconds * 0.035);
  if (durationDelta > durationTolerance) {
    const critical = durationDelta > Math.max(2, input.expectedDurationSeconds * 0.12);
    issues.push({
      severity: critical ? "critical" : "warning",
      category: "cuts",
      timestampSeconds: Math.max(0, input.durationSeconds),
      title: "Export length differs from the edit",
      evidence: `Expected ${input.expectedDurationSeconds.toFixed(1)}s but rendered ${input.durationSeconds.toFixed(1)}s.`,
      recommendation: "Review the opening and closing cut points before posting.",
    });
    scores.cuts = critical ? 35 : 72;
    scores.platformReadiness = Math.min(scores.platformReadiness, critical ? 45 : 78);
  }

  if (input.format === "vertical" && input.width > 0 && input.height > 0) {
    const ratio = input.width / input.height;
    const expectedRatio = input.expectedDimensions
      ? input.expectedDimensions.width / input.expectedDimensions.height : 9 / 16;
    if (Math.abs(ratio - expectedRatio) > 0.025) {
      issues.push({
        severity: "critical",
        category: "platform",
        timestampSeconds: null,
        title: input.expectedDimensions ? "Export does not match the platform format" : "Export is not true 9:16",
        evidence: `The rendered dimensions are ${input.width}x${input.height}.`,
        recommendation: "Render with the selected platform preset before publishing.",
      });
      scores.platformReadiness = 30;
      scores.framing = Math.min(scores.framing, 65);
    }
    if (input.height < (input.expectedDimensions?.height ?? 1280)) {
      issues.push({
        severity: "warning",
        category: "clarity",
        timestampSeconds: null,
        title: "Vertical resolution is lower than recommended",
        evidence: `The rendered height is ${input.height}px.`,
        recommendation: "Use a 1080x1920 final export for sharper social uploads.",
      });
      scores.clarity = Math.min(scores.clarity, 72);
      scores.platformReadiness = Math.min(scores.platformReadiness, 82);
    }
  }

  if (input.fps > 0 && input.fps < 23) {
    issues.push({
      severity: "warning",
      category: "clarity",
      timestampSeconds: null,
      title: "Motion may look choppy",
      evidence: `The export reports ${input.fps.toFixed(1)} frames per second.`,
      recommendation: "Export at 30 fps or preserve the source frame rate.",
    });
    scores.clarity = Math.min(scores.clarity, 70);
  }

  if (input.expectsAudio && !input.audioCodec) {
    issues.push({
      severity: "critical",
      category: "audio",
      timestampSeconds: null,
      title: "Audio is missing",
      evidence: "No audio stream was detected in the rendered file.",
      recommendation: "Check the source audio and render the clip again.",
    });
    scores.platformReadiness = Math.min(scores.platformReadiness, 35);
  }

  if (input.fileSizeBytes < 80_000) {
    issues.push({
      severity: "critical",
      category: "clarity",
      timestampSeconds: null,
      title: "Rendered file is unexpectedly small",
      evidence: `The output file is only ${Math.max(0, Math.round(input.fileSizeBytes / 1024))} KB.`,
      recommendation: "Open the file to confirm it is complete, then render again if needed.",
    });
    scores.clarity = Math.min(scores.clarity, 25);
    scores.platformReadiness = Math.min(scores.platformReadiness, 25);
  }

  const score = clampScore(
    (scores.framing +
      scores.captions +
      scores.cuts +
      scores.clarity +
      scores.platformReadiness) /
      5
  );
  const verdict = issues.some((issue) => issue.severity === "critical")
    ? "fail"
    : issues.length > 0
      ? "review"
      : "pass";

  return {
    version: 1,
    verdict,
    score,
    summary:
      issues.length === 0
        ? "The exported file passed all technical delivery checks."
        : "The export completed, but one or more technical details should be reviewed.",
    scores,
    issues: issues.slice(0, 8),
    strengths:
      issues.length === 0
        ? [
            input.expectedDimensions ? "Correct platform delivery format" : input.format === "vertical"
              ? "Correct vertical delivery format"
              : "Valid native video delivery",
            input.audioCodec ? "Video and audio streams are present" : "Video stream is present",
          ]
        : [],
    reviewer: "technical_only",
    model: null,
    samplesReviewed: 0,
    reviewedAt: new Date().toISOString(),
  };
}

export function parseAiCriticResponse(value: unknown): AiCriticReview | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const candidate = raw.review ?? raw.result ?? raw;
  const parsed = aiCriticResponseSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function issueKey(issue: RenderQualityIssue): string {
  return `${issue.category}:${issue.title.toLowerCase()}:${Math.round(
    issue.timestampSeconds ?? -1
  )}`;
}

export function mergeAiQualityReview(
  technical: PostRenderQualityReview,
  ai: AiCriticReview,
  options: {
    model: string;
    samplesReviewed: number;
    durationSeconds: number;
    sampleTimes: number[];
  }
): PostRenderQualityReview {
  const sampleTimes = options.sampleTimes;
  const groundedAiIssues = ai.issues.flatMap((issue) => {
    const timestamp = issue.timestampSeconds;
    if (timestamp === null) {
      return issue.category === "platform" || issue.category === "audio"
        ? [issue]
        : [];
    }
    if (timestamp > options.durationSeconds + 0.25) return [];
    const nearest = sampleTimes.reduce(
      (best, sample) =>
        Math.abs(sample - timestamp) < Math.abs(best - timestamp) ? sample : best,
      sampleTimes[0] ?? timestamp
    );
    // A visual claim must point to a frame the model actually received.
    if (
      issue.category !== "cuts" &&
      sampleTimes.length > 0 &&
      Math.abs(nearest - timestamp) > 0.75
    ) {
      return [];
    }
    return [{ ...issue, timestampSeconds: Math.max(0, Math.min(options.durationSeconds, timestamp)) }];
  });

  const seen = new Set<string>();
  const issues = [...technical.issues, ...groundedAiIssues]
    .filter((issue) => {
      const key = issueKey(issue);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
  const scores: RenderQualityScores = {
    framing: Math.min(technical.scores.framing, ai.scores.framing),
    captions: Math.min(technical.scores.captions, ai.scores.captions),
    cuts: Math.min(technical.scores.cuts, ai.scores.cuts),
    clarity: Math.min(technical.scores.clarity, ai.scores.clarity),
    platformReadiness: Math.min(
      technical.scores.platformReadiness,
      ai.scores.platformReadiness
    ),
  };
  const score = clampScore(
    scores.framing * 0.24 +
      scores.captions * 0.2 +
      scores.cuts * 0.24 +
      scores.clarity * 0.14 +
      scores.platformReadiness * 0.18
  );
  const verdict = issues.some((issue) => issue.severity === "critical") || score < 60
    ? "fail"
    : issues.length > 0 || score < 84
      ? "review"
      : "pass";

  return {
    version: 1,
    verdict,
    score,
    summary: ai.summary,
    scores,
    issues,
    strengths: [...new Set([...ai.strengths, ...technical.strengths])].slice(0, 4),
    reviewer: "ai_visual",
    model: options.model,
    samplesReviewed: options.samplesReviewed,
    reviewedAt: new Date().toISOString(),
  };
}

export function parsePostRenderQualityReview(
  value: unknown
): PostRenderQualityReview | null {
  const parsed = postRenderQualityReviewSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
