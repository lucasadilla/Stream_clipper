import { z } from "zod";
import type { NarrativePlan } from "@/lib/narrativeBeats";
import type { StructuredVisualContext } from "@/lib/visualAnalysis";
import { isSpecificClickableClipTitle } from "@/lib/clipTitleQuality";

export const HOOK_ENGINE_VERSION = "hook-engine-v1";
export const HOOK_POLICY_VERSION = "hook-policy-v1";

export const hookEngineModeSchema = z.enum(["legacy", "shadow", "new", "ab"]);
export type HookEngineMode = z.infer<typeof hookEngineModeSchema>;

export const hookTypeSchema = z.enum([
  "natural",
  "action_first",
  "reaction_first",
  "quote_first",
  "payoff_tease",
  "context_compressed",
]);
export type HookType = z.infer<typeof hookTypeSchema>;

const scoreSchema = z.number().min(0).max(100);

export const hookSourceSegmentSchema = z.object({
  sourceStartSeconds: z.number().min(0),
  sourceEndSeconds: z.number().min(0),
  timelineStartSeconds: z.number().min(0),
  kind: z.enum(["opening", "setup", "continuation", "tease"]),
});

export const openingMetricsSchema = z.object({
  firstFrameStrength: scoreSchema,
  movementAtHalfSecond: scoreSchema,
  subjectVisibility: scoreSchema,
  audioImmediacy: scoreSchema,
  firstSecondCuriosity: scoreSchema,
  firstSecondClarity: scoreSchema,
  firstThreeSecondPromise: scoreSchema,
  firstThreeSecondPacing: scoreSchema,
});

export const hookCandidateSchema = z.object({
  candidateId: z.string().min(1),
  hookType: hookTypeSchema,
  sourceSegments: z.array(hookSourceSegmentSchema).min(1).max(4),
  openingStartTimestamp: z.number().min(0),
  openingEndTimestamp: z.number().min(0),
  requiresTemporalReordering: z.boolean(),
  firstVisualTimestamp: z.number().min(0),
  firstSpokenWordTimestamp: z.number().min(0).nullable(),
  firstCaptionText: z.string().max(180),
  hookTranscript: z.string().max(800),
  contextRequired: z.array(z.string().max(180)).max(8),
  contextProvided: z.array(z.string().max(180)).max(8),
  payoffTimestamp: z.number().min(0).nullable(),
  estimatedNarrativeCompleteness: scoreSchema,
  visualStrength: scoreSchema,
  reactionStrength: scoreSchema,
  speechImmediacy: scoreSchema,
  curiosityStrength: scoreSchema,
  clarity: scoreSchema,
  contextBurden: scoreSchema,
  spoilerRisk: scoreSchema,
  pacingQuality: scoreSchema,
  captionOpportunity: scoreSchema,
  misleadingHookRisk: scoreSchema,
  rankScore: scoreSchema,
  openingMetrics: openingMetricsSchema,
  reasoningEvidence: z.array(z.string().min(1).max(260)).min(1).max(12),
  warnings: z.array(z.string().max(240)).max(8),
});
export type HookCandidate = z.infer<typeof hookCandidateSchema>;

export const titleCandidateSchema = z.object({
  id: z.string().min(1),
  strategy: z.enum([
    "specific_fact",
    "curiosity",
    "result",
    "conflict",
    "quote",
    "unexpected_outcome",
    "challenge",
    "explanation",
    "reaction",
  ]),
  title: z.string().min(3).max(100),
  specificity: scoreSchema,
  curiosity: scoreSchema,
  accuracy: scoreSchema,
  brevity: scoreSchema,
  naturalness: scoreSchema,
  spoilerRisk: scoreSchema,
  clickbaitRisk: scoreSchema,
  rankScore: scoreSchema,
  evidence: z.array(z.string().min(1).max(180)).min(1).max(6),
  warnings: z.array(z.string().max(180)).max(6),
});
export type TitleCandidate = z.infer<typeof titleCandidateSchema>;

export const firstVisualSchema = z.object({
  timestampSeconds: z.number().min(0),
  classification: z.enum([
    "action",
    "reaction",
    "outcome",
    "context",
    "speech",
    "unknown",
  ]),
  strength: scoreSchema,
  motionLevel: scoreSchema,
  faceVisible: z.boolean().nullable(),
  reason: z.string().max(260),
  evidence: z.array(z.string().max(220)).max(6),
});

export const coverCandidateSchema = z.object({
  timestampSeconds: z.number().min(0),
  score: scoreSchema,
  classification: z.string().min(1).max(80),
  reason: z.string().min(1).max(240),
});

export const packageIssueSchema = z.object({
  severity: z.enum(["info", "warning", "critical"]),
  code: z.string().min(1).max(80),
  message: z.string().min(1).max(260),
});

export const platformPackageSchema = z.object({
  platform: z.string().min(1),
  title: z.string().nullable(),
  description: z.string().nullable(),
  hashtags: z.array(z.string()),
  tags: z.array(z.string()),
  postCopy: z.string().nullable(),
  coverTimestampSeconds: z.number().min(0).nullable(),
  cta: z.string().nullable(),
  confidenceDimensions: z.record(z.string(), scoreSchema),
  reasoningEvidence: z.array(z.string().max(240)),
  warnings: z.array(z.string().max(240)),
  modelVersion: z.string(),
  policyVersion: z.string(),
});

export const hookDnaSchema = z.object({
  version: z.literal(HOOK_ENGINE_VERSION),
  sourceMomentId: z.string(),
  creator: z.string().nullable(),
  contentCategory: z.string(),
  hookType: hookTypeSchema,
  firstFrameTimestamp: z.number(),
  firstVisualClassification: z.string(),
  motionLevel: scoreSchema,
  faceVisible: z.boolean().nullable(),
  reactionStrength: scoreSchema,
  firstSpokenWordTimestamp: z.number().nullable(),
  firstCaptionTimestamp: z.number().nullable(),
  firstCaptionText: z.string(),
  openingTranscript: z.string(),
  hookDuration: z.number().min(0),
  setupDuration: z.number().min(0).nullable(),
  payoffTimestamp: z.number().nullable(),
  reactionTimestamp: z.number().nullable(),
  resolutionTimestamp: z.number().nullable(),
  cutsInFirstThreeSeconds: z.number().int().min(0),
  temporalReorderingUsed: z.boolean(),
  titleStrategy: z.string(),
  title: z.string(),
  coverFrameTimestamp: z.number().nullable(),
  modelVersions: z.array(z.string()),
  policyVersion: z.string(),
  creatorOverrides: z.array(z.string()),
});
export type HookDNA = z.infer<typeof hookDnaSchema>;

export const clipPackageSchema = z.object({
  version: z.literal(HOOK_ENGINE_VERSION),
  mode: hookEngineModeSchema,
  selectedMoment: z.object({
    id: z.string(),
    startTimeSeconds: z.number(),
    endTimeSeconds: z.number(),
    focusTimeSeconds: z.number(),
    momentQuality: scoreSchema,
    hookability: scoreSchema,
  }),
  hookCandidates: z.array(hookCandidateSchema).min(1),
  recommendedHookCandidateId: z.string(),
  selectedHook: hookCandidateSchema,
  storyPlan: z.object({
    arcType: z.string(),
    beats: z.array(
      z.object({
        role: z.string(),
        timeSeconds: z.number().nullable(),
        evidence: z.string(),
      })
    ),
    narrativeCompleteness: scoreSchema,
  }),
  editPlan: z.object({
    sourceSegments: z.array(hookSourceSegmentSchema),
    temporalReorderingAllowed: z.boolean(),
    temporalReorderingApplied: z.boolean(),
    rationale: z.string(),
  }),
  firstVisual: firstVisualSchema,
  firstCaption: z.object({
    timestampSeconds: z.number().nullable(),
    text: z.string(),
    source: z.literal("transcript"),
    appearsImmediately: z.boolean(),
  }),
  coverCandidates: z.array(coverCandidateSchema).max(6),
  titleCandidates: z.array(titleCandidateSchema).min(1).max(20),
  recommendedTitleCandidateId: z.string(),
  selectedTitleCandidateId: z.string(),
  creatorSelection: z
    .object({
      hookCandidateId: z.string(),
      titleCandidateId: z.string().nullable(),
      updatedAt: z.string(),
    })
    .nullable(),
  platformPackages: z.array(platformPackageSchema),
  qualityReview: z.object({
    passed: z.boolean(),
    repairPasses: z.number().int().min(0).max(1),
    issues: z.array(packageIssueSchema),
  }),
  decisionEvidence: z.array(z.string().max(260)),
  warnings: z.array(z.string().max(240)),
  modelDecision: z
    .object({
      provider: z.string(),
      model: z.string(),
      latencyMs: z.number().min(0),
      inputTokens: z.number().int().min(0).nullable(),
      outputTokens: z.number().int().min(0).nullable(),
      estimatedCostUsd: z.number().min(0).nullable(),
      cacheHit: z.boolean(),
    })
    .nullable(),
  hookDNA: hookDnaSchema,
});
export type ClipPackage = z.infer<typeof clipPackageSchema>;

export interface HookTranscriptChunk {
  id: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
}

export interface BuildHookPackageInput {
  momentId: string;
  creator?: string | null;
  knownPeople?: string[];
  contentCategory: string;
  title: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  focusTimeSeconds: number;
  momentQuality: number;
  transcriptChunks: HookTranscriptChunk[];
  visualContext?: StructuredVisualContext;
  narrativePlan?: NarrativePlan;
  mode: HookEngineMode;
}

const FILLER_OPENING = /^(?:so|well|okay|ok|um+|uh+|like|you know|all right|alright|basically)\b/i;
const DEAD_VISUAL = /\b(?:loading|menu|idle|blank|logo|intro|waiting|dead space)\b/i;
const CURIOSITY = /\b(?:why|how|what|wait|problem|found|secret|impossible|unless|until|wrong|mistake|actually|never|way)\b|\?/i;
const GENERIC_TITLE = /\b(?:insane|crazy|epic|unbelievable|must watch|you won'?t believe|stream clip|gaming moment)\b/i;

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function words(value: string): string[] {
  return cleanText(value).split(" ").filter(Boolean);
}

function captionPhrase(value: string): string {
  return words(value).slice(0, 9).join(" ").slice(0, 180);
}

function usefulSpeech(chunk: HookTranscriptChunk): boolean {
  const text = cleanText(chunk.text);
  return (
    words(text).length >= 3 &&
    !/^\[(?:silence|processing error)\]$/i.test(text) &&
    !FILLER_OPENING.test(text)
  );
}

function visualClassification(
  visual: StructuredVisualContext | undefined,
  timestamp: number
): z.infer<typeof firstVisualSchema>["classification"] {
  const event = visual?.events
    .filter((item) => Math.abs(item.timeSeconds - timestamp) <= 1.25)
    .sort((a, b) => b.confidence - a.confidence)[0];
  if (!event) return "unknown";
  if (event.type === "action") return "action";
  if (event.type === "reaction") return "reaction";
  if (event.type === "outcome") return "outcome";
  return "context";
}

function visualStrengthAt(
  visual: StructuredVisualContext | undefined,
  timestamp: number
): number {
  const nearby = visual?.events.filter(
    (event) => Math.abs(event.timeSeconds - timestamp) <= 1.5
  ) ?? [];
  if (nearby.length === 0) {
    return visual?.sufficient ? clampScore(visual.confidence * 55) : 28;
  }
  return clampScore(
    Math.max(...nearby.map((event) => event.confidence * 100)) +
      (nearby.some((event) => event.type === "action" || event.type === "outcome")
        ? 8
        : 0)
  );
}

function reactionStrengthAt(
  visual: StructuredVisualContext | undefined,
  timestamp: number
): number {
  const reaction = visual?.events
    .filter(
      (event) =>
        event.type === "reaction" && Math.abs(event.timeSeconds - timestamp) <= 2
    )
    .sort((a, b) => b.confidence - a.confidence)[0];
  return reaction ? clampScore(reaction.confidence * 100) : 12;
}

function candidateId(type: HookType, timestamp: number): string {
  return `${type}-${Math.round(timestamp * 1000)}`;
}

function candidateFor(input: {
  source: BuildHookPackageInput;
  hookType: HookType;
  start: number;
  openingEnd: number;
  segments?: HookCandidate["sourceSegments"];
  reordered?: boolean;
  evidence: string[];
  warnings?: string[];
  spoilerRisk?: number;
  contextBurden?: number;
}): HookCandidate {
  const { source } = input;
  const orderedChunks = source.transcriptChunks
    .filter(
      (chunk) =>
        chunk.endTimeSeconds >= input.start &&
        chunk.startTimeSeconds <= source.endTimeSeconds
    )
    .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
  const firstSpeech = orderedChunks.find(usefulSpeech) ?? orderedChunks[0];
  const speechDelay = firstSpeech
    ? Math.max(0, firstSpeech.startTimeSeconds - input.start)
    : 5;
  const transcript = cleanText(
    orderedChunks
      .filter((chunk) => chunk.startTimeSeconds <= input.openingEnd + 2)
      .map((chunk) => chunk.text)
      .join(" ")
  ).slice(0, 800);
  const visualStrength = visualStrengthAt(source.visualContext, input.start);
  const reactionStrength = reactionStrengthAt(source.visualContext, input.start);
  const speechImmediacy = clampScore(100 - speechDelay * 32);
  const curiosityStrength = clampScore(
    42 + (CURIOSITY.test(transcript) ? 32 : 0) + reactionStrength * 0.12
  );
  const contextBurden = clampScore(
    input.contextBurden ??
      (input.start > source.startTimeSeconds + 2.5 ? 44 : 24) +
        (/\b(?:he|she|they|it|this|that)\b/i.test(captionPhrase(transcript)) ? 18 : 0)
  );
  const clarity = clampScore(92 - contextBurden * 0.65);
  const spoilerRisk = clampScore(input.spoilerRisk ?? 12);
  const completeness = clampScore(source.narrativePlan?.scores.completeness ?? 66);
  const pacing = clampScore(
    48 + speechImmediacy * 0.28 + visualStrength * 0.25 - contextBurden * 0.14
  );
  const captionOpportunity = clampScore(
    firstSpeech ? 55 + Math.min(30, words(firstSpeech.text).length * 3) : 10
  );
  const misleadingHookRisk = clampScore(
    input.reordered ? 12 + spoilerRisk * 0.22 : 3
  );
  const rankScore = clampScore(
    visualStrength * 0.16 +
      speechImmediacy * 0.13 +
      curiosityStrength * 0.18 +
      clarity * 0.14 +
      completeness * 0.15 +
      pacing * 0.12 +
      captionOpportunity * 0.08 +
      reactionStrength * 0.04 -
      contextBurden * 0.08 -
      spoilerRisk * 0.07 -
      misleadingHookRisk * 0.12 +
      18
  );
  const sourceSegments = input.segments ?? [
    {
      sourceStartSeconds: input.start,
      sourceEndSeconds: source.endTimeSeconds,
      timelineStartSeconds: 0,
      kind: "opening" as const,
    },
  ];
  const classification = visualClassification(source.visualContext, input.start);
  const warnings = [...(input.warnings ?? [])];
  if (contextBurden >= 65) warnings.push("Opening may require missing context.");
  if (spoilerRisk >= 65) warnings.push("Opening may reveal too much of the payoff.");
  if (speechDelay > 3) warnings.push("Speech begins more than three seconds after the opening.");

  return hookCandidateSchema.parse({
    candidateId: candidateId(input.hookType, input.start),
    hookType: input.hookType,
    sourceSegments,
    openingStartTimestamp: input.start,
    openingEndTimestamp: input.openingEnd,
    requiresTemporalReordering: input.reordered ?? false,
    firstVisualTimestamp: input.start,
    firstSpokenWordTimestamp: firstSpeech?.startTimeSeconds ?? null,
    firstCaptionText: firstSpeech ? captionPhrase(firstSpeech.text) : "",
    hookTranscript: transcript,
    contextRequired: contextBurden >= 55 ? ["Earlier subject or stakes may need clarification."] : [],
    contextProvided: orderedChunks.slice(0, 2).map((chunk) => captionPhrase(chunk.text)),
    payoffTimestamp:
      source.narrativePlan?.beats.find((beat) => beat.role === "payoff")
        ?.startTimeSeconds ?? null,
    estimatedNarrativeCompleteness: completeness,
    visualStrength,
    reactionStrength,
    speechImmediacy,
    curiosityStrength,
    clarity,
    contextBurden,
    spoilerRisk,
    pacingQuality: pacing,
    captionOpportunity,
    misleadingHookRisk,
    rankScore,
    openingMetrics: {
      firstFrameStrength: visualStrength,
      movementAtHalfSecond: clampScore(visualStrength + (classification === "action" ? 12 : -8)),
      subjectVisibility: clampScore(visualStrength + (classification === "unknown" ? -14 : 8)),
      audioImmediacy: speechImmediacy,
      firstSecondCuriosity: curiosityStrength,
      firstSecondClarity: clarity,
      firstThreeSecondPromise: clampScore((curiosityStrength + completeness) / 2),
      firstThreeSecondPacing: pacing,
    },
    reasoningEvidence: input.evidence,
    warnings: [...new Set(warnings)].slice(0, 8),
  });
}

export function generateHookCandidates(
  source: BuildHookPackageInput
): HookCandidate[] {
  const start = Math.max(0, source.startTimeSeconds);
  const end = Math.max(start + 0.5, source.endTimeSeconds);
  const openingEnd = Math.min(end, start + 3);
  const chunks = source.transcriptChunks
    .filter(
      (chunk) =>
        chunk.endTimeSeconds >= start - 0.5 && chunk.startTimeSeconds <= end + 0.5
    )
    .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
  const candidates: HookCandidate[] = [
    candidateFor({
      source,
      hookType: "natural",
      start,
      openingEnd,
      evidence: [
        `Preserves chronological order from ${start.toFixed(2)}s.`,
        chunks[0]?.text ? `Opening transcript: ${captionPhrase(chunks[0].text)}` : "No opening speech was available.",
      ],
    }),
  ];

  const useful = chunks.find(
    (chunk) =>
      usefulSpeech(chunk) &&
      chunk.startTimeSeconds <= Math.min(end, source.focusTimeSeconds + 2)
  );
  if (useful && useful.startTimeSeconds > start + 0.45) {
    candidates.push(
      candidateFor({
        source,
        hookType: "context_compressed",
        start: Math.max(start, useful.startTimeSeconds - 0.12),
        openingEnd: Math.min(end, useful.startTimeSeconds + 3),
        contextBurden: useful.startTimeSeconds > start + 8 ? 54 : 28,
        evidence: [
          `Removed ${(useful.startTimeSeconds - start).toFixed(2)}s before the earliest useful speech.`,
          `First grounded line: ${captionPhrase(useful.text)}`,
        ],
      })
    );
  }

  const quote = [...chunks]
    .filter(usefulSpeech)
    .filter((chunk) => chunk.startTimeSeconds <= Math.min(end, source.focusTimeSeconds + 3))
    .sort((a, b) => {
      const score = (chunk: HookTranscriptChunk) =>
        (CURIOSITY.test(chunk.text) ? 40 : 0) +
        Math.min(25, words(chunk.text).length * 2) -
        (FILLER_OPENING.test(cleanText(chunk.text)) ? 35 : 0);
      return score(b) - score(a);
    })[0];
  if (quote && CURIOSITY.test(quote.text) && quote.startTimeSeconds > start + 0.2) {
    candidates.push(
      candidateFor({
        source,
        hookType: "quote_first",
        start: Math.max(start, quote.startTimeSeconds - 0.1),
        openingEnd: Math.min(end, quote.endTimeSeconds + 1.5),
        contextBurden: /\b(?:he|she|they|it|this|that)\b/i.test(quote.text) ? 58 : 34,
        evidence: [
          `Uses an exact spoken line at ${quote.startTimeSeconds.toFixed(2)}s.`,
          `Quote: ${captionPhrase(quote.text)}`,
        ],
      })
    );
  }

  const visualEvents = source.visualContext?.events
    .filter((event) => event.timeSeconds >= start && event.timeSeconds <= end)
    .sort((a, b) => b.confidence - a.confidence) ?? [];
  const action = visualEvents.find(
    (event) => event.type === "action" || event.type === "outcome"
  );
  if (action && action.timeSeconds > start + 0.2) {
    candidates.push(
      candidateFor({
        source,
        hookType: "action_first",
        start: Math.max(start, action.timeSeconds - 0.18),
        openingEnd: Math.min(end, action.timeSeconds + 2.82),
        contextBurden: action.timeSeconds > source.focusTimeSeconds + 2 ? 62 : 38,
        spoilerRisk: action.type === "outcome" ? 58 : 16,
        evidence: [
          `Starts on verified ${action.type} at ${action.timeSeconds.toFixed(2)}s.`,
          action.description,
        ],
      })
    );
  }

  const reaction = visualEvents.find((event) => event.type === "reaction");
  if (reaction && reaction.timeSeconds > start + 0.2) {
    candidates.push(
      candidateFor({
        source,
        hookType: "reaction_first",
        start: Math.max(start, reaction.timeSeconds - 0.16),
        openingEnd: Math.min(end, reaction.timeSeconds + 2.5),
        contextBurden: 48,
        spoilerRisk: 36,
        evidence: [
          `Starts on a verified reaction at ${reaction.timeSeconds.toFixed(2)}s.`,
          reaction.description,
        ],
      })
    );
  }

  const payoff = source.narrativePlan?.beats.find((beat) => beat.role === "payoff");
  if (
    payoff &&
    payoff.startTimeSeconds >= start + 4 &&
    payoff.startTimeSeconds <= end - 1 &&
    !DEAD_VISUAL.test(payoff.evidence)
  ) {
    const teaseStart = Math.max(start, payoff.startTimeSeconds - 0.18);
    const teaseEnd = Math.min(end, teaseStart + 0.55);
    candidates.push(
      candidateFor({
        source,
        hookType: "payoff_tease",
        start: teaseStart,
        openingEnd: teaseEnd,
        reordered: true,
        segments: [
          {
            sourceStartSeconds: teaseStart,
            sourceEndSeconds: teaseEnd,
            timelineStartSeconds: 0,
            kind: "tease",
          },
          {
            sourceStartSeconds: start,
            sourceEndSeconds: end,
            timelineStartSeconds: teaseEnd - teaseStart,
            kind: "setup",
          },
        ],
        spoilerRisk: 64,
        contextBurden: 42,
        evidence: [
          `Teases only ${(teaseEnd - teaseStart).toFixed(2)}s of the grounded payoff.`,
          payoff.evidence,
        ],
        warnings: ["Temporal reordering remains disabled unless the rollout policy explicitly enables it."],
      })
    );
  }

  return candidates
    .filter(
      (candidate, index, all) =>
        all.findIndex(
          (other) =>
            other.hookType === candidate.hookType &&
            Math.abs(other.openingStartTimestamp - candidate.openingStartTimestamp) < 0.15
        ) === index
    )
    .sort((a, b) => b.rankScore - a.rankScore);
}

function titleScore(title: string, strategy: TitleCandidate["strategy"]): TitleCandidate {
  const cleaned = cleanText(title).replace(/[.!,:;|-]+$/g, "").slice(0, 100);
  const titleWords = words(cleaned);
  const generic = GENERIC_TITLE.test(cleaned);
  const allCaps = /^[A-Z\d\W]+$/.test(cleaned) && /[A-Z]/.test(cleaned);
  const publishable = isSpecificClickableClipTitle(cleaned);
  const specificity = clampScore(
    78 - (generic ? 50 : 0) - (publishable ? 0 : 55) +
      (titleWords.length >= 5 ? 8 : 0)
  );
  const curiosity = clampScore(48 + (CURIOSITY.test(cleaned) ? 28 : 0));
  const accuracy = generic ? 58 : 88;
  const brevity = clampScore(100 - Math.max(0, titleWords.length - 9) * 10);
  const naturalness = clampScore(
    88 - (allCaps ? 55 : 0) - (generic ? 25 : 0) - (publishable ? 0 : 60)
  );
  const spoilerRisk = strategy === "result" || strategy === "unexpected_outcome" ? 32 : 12;
  const clickbaitRisk = clampScore((generic ? 70 : 5) + (allCaps ? 25 : 0));
  const rankScore = clampScore(
    specificity * 0.25 +
      curiosity * 0.18 +
      accuracy * 0.27 +
      brevity * 0.12 +
      naturalness * 0.18 -
      spoilerRisk * 0.06 -
      clickbaitRisk * 0.18 +
      10
  );
  return titleCandidateSchema.parse({
    id: `title-${strategy}-${Math.abs(hashString(cleaned))}`,
    strategy,
    title: cleaned || "A specific moment from the stream",
    specificity,
    curiosity,
    accuracy,
    brevity,
    naturalness,
    spoilerRisk,
    clickbaitRisk,
    rankScore,
    evidence: [cleaned || "Source clip title"],
    warnings: [
      ...(generic ? ["Generic short-form language was penalized."] : []),
      ...(allCaps ? ["Excessive capitalization was penalized."] : []),
      ...(!publishable ? ["Title reads like an incomplete transcript fragment."] : []),
    ],
  });
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return hash;
}

export function buildLocalTitleCandidates(
  title: string,
  hook: HookCandidate
): TitleCandidate[] {
  const candidates = [
    titleScore(title, "specific_fact"),
    ...(hook.firstCaptionText && hook.firstCaptionText.length >= 12
      ? [titleScore(hook.firstCaptionText, "quote")]
      : []),
  ];
  const publishable = candidates
    .filter((candidate) => isSpecificClickableClipTitle(candidate.title))
    .filter(
      (candidate, index, all) =>
        all.findIndex(
          (other) => other.title.toLocaleLowerCase() === candidate.title.toLocaleLowerCase()
        ) === index
    )
    .sort((a, b) => b.rankScore - a.rankScore);
  // Keep the package structurally valid for an old/manual clip with no usable
  // title. Callers must not apply this low-scoring fallback automatically.
  return publishable.length > 0 ? publishable : candidates.slice(0, 1);
}

export function reviewHookCandidate(candidate: HookCandidate) {
  const issues: z.infer<typeof packageIssueSchema>[] = [];
  const add = (
    severity: "info" | "warning" | "critical",
    code: string,
    message: string
  ) => issues.push({ severity, code, message });
  if (candidate.visualStrength < 32) add("warning", "weak_first_visual", "The first frame has weak visual evidence.");
  if (candidate.speechImmediacy < 35) add("warning", "late_speech", "Meaningful speech begins too slowly for this opening.");
  if (candidate.clarity < 42) add("critical", "opening_confusion", "The opening creates confusion instead of a clear curiosity gap.");
  if (candidate.contextBurden > 72) add("critical", "missing_context", "The opening removes context needed to understand the moment.");
  if (candidate.spoilerRisk > 78) add("critical", "payoff_spoiled", "The opening reveals too much of the payoff.");
  if (candidate.misleadingHookRisk > 40) add("critical", "misleading_hook", "The opening could promise a story the clip does not deliver.");
  if (candidate.estimatedNarrativeCompleteness < 45) add("critical", "incomplete_story", "The clip does not contain a complete enough story.");
  if (!candidate.firstCaptionText && candidate.firstSpokenWordTimestamp != null) {
    add("warning", "missing_first_caption", "The first spoken phrase has no grounded caption text.");
  }
  return issues;
}

function coverCandidates(
  source: BuildHookPackageInput
): Array<z.infer<typeof coverCandidateSchema>> {
  const events = source.visualContext?.events ?? [];
  const ranked: Array<z.infer<typeof coverCandidateSchema>> = events
    .filter(
      (event) =>
        event.timeSeconds >= source.startTimeSeconds &&
        event.timeSeconds <= source.endTimeSeconds
    )
    .map((event) => ({
      timestampSeconds: event.timeSeconds,
      score: clampScore(
        event.confidence * 100 +
          (event.type === "reaction" || event.type === "outcome" ? 8 : 0)
      ),
      classification: event.type,
      reason: event.description,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  if (ranked.length === 0) {
    ranked.push({
      timestampSeconds: source.focusTimeSeconds,
      score: 45,
      classification: "focus",
      reason: "Uses the strongest known moment timestamp when visual evidence is unavailable.",
    });
  }
  return ranked;
}

export function buildLocalClipPackage(source: BuildHookPackageInput): ClipPackage {
  const hookCandidates = generateHookCandidates(source);
  let selectedHook = hookCandidates[0]!;
  let issues = reviewHookCandidate(selectedHook);
  let repairPasses = 0;
  if (issues.some((issue) => issue.severity === "critical")) {
    const repair = hookCandidates.find(
      (candidate) =>
        candidate.candidateId !== selectedHook.candidateId &&
        !reviewHookCandidate(candidate).some((issue) => issue.severity === "critical")
    );
    if (repair) {
      selectedHook = repair;
      issues = reviewHookCandidate(selectedHook);
      repairPasses = 1;
    }
  }
  const titles = buildLocalTitleCandidates(source.title, selectedHook);
  const selectedTitle = titles[0]!;
  const covers = coverCandidates(source);
  const reactionBeat = source.narrativePlan?.beats.find((beat) => beat.role === "reaction");
  const resolutionBeat = source.narrativePlan?.beats.find((beat) => beat.role === "resolution");
  const setupBeat = source.narrativePlan?.beats.find((beat) => beat.role === "setup");
  const firstVisual = firstVisualSchema.parse({
    timestampSeconds: selectedHook.firstVisualTimestamp,
    classification: visualClassification(source.visualContext, selectedHook.firstVisualTimestamp),
    strength: selectedHook.visualStrength,
    motionLevel: selectedHook.openingMetrics.movementAtHalfSecond,
    faceVisible:
      selectedHook.reactionStrength >= 35
        ? true
        : source.visualContext?.analysisLevel === "local"
          ? null
          : false,
    reason: selectedHook.reasoningEvidence[0]!,
    evidence: selectedHook.reasoningEvidence,
  });
  const hookDNA: HookDNA = {
    version: HOOK_ENGINE_VERSION,
    sourceMomentId: source.momentId,
    creator: source.creator ?? null,
    contentCategory: source.contentCategory,
    hookType: selectedHook.hookType,
    firstFrameTimestamp: selectedHook.firstVisualTimestamp,
    firstVisualClassification: firstVisual.classification,
    motionLevel: firstVisual.motionLevel,
    faceVisible: firstVisual.faceVisible,
    reactionStrength: selectedHook.reactionStrength,
    firstSpokenWordTimestamp: selectedHook.firstSpokenWordTimestamp,
    firstCaptionTimestamp: selectedHook.firstSpokenWordTimestamp,
    firstCaptionText: selectedHook.firstCaptionText,
    openingTranscript: selectedHook.hookTranscript,
    hookDuration: Math.max(0, selectedHook.openingEndTimestamp - selectedHook.openingStartTimestamp),
    setupDuration:
      setupBeat && selectedHook.payoffTimestamp != null
        ? Math.max(0, selectedHook.payoffTimestamp - setupBeat.startTimeSeconds)
        : null,
    payoffTimestamp: selectedHook.payoffTimestamp,
    reactionTimestamp: reactionBeat?.startTimeSeconds ?? null,
    resolutionTimestamp: resolutionBeat?.startTimeSeconds ?? null,
    cutsInFirstThreeSeconds: selectedHook.sourceSegments.filter(
      (segment) => segment.timelineStartSeconds > 0 && segment.timelineStartSeconds <= 3
    ).length,
    temporalReorderingUsed: selectedHook.requiresTemporalReordering,
    titleStrategy: selectedTitle.strategy,
    title: selectedTitle.title,
    coverFrameTimestamp: covers[0]?.timestampSeconds ?? null,
    modelVersions: [
      source.visualContext?.modelVersion,
      source.narrativePlan ? "narrative-engine-v2" : null,
    ].filter((value): value is string => Boolean(value)),
    policyVersion: HOOK_POLICY_VERSION,
    creatorOverrides: [],
  };

  return clipPackageSchema.parse({
    version: HOOK_ENGINE_VERSION,
    mode: source.mode,
    selectedMoment: {
      id: source.momentId,
      startTimeSeconds: source.startTimeSeconds,
      endTimeSeconds: source.endTimeSeconds,
      focusTimeSeconds: source.focusTimeSeconds,
      momentQuality: clampScore(source.momentQuality),
      hookability: selectedHook.rankScore,
    },
    hookCandidates,
    recommendedHookCandidateId: selectedHook.candidateId,
    selectedHook,
    storyPlan: {
      arcType: source.narrativePlan?.arcType ?? "unknown",
      beats:
        source.narrativePlan?.beats.map((beat) => ({
          role: beat.role,
          timeSeconds: beat.startTimeSeconds,
          evidence: beat.evidence,
        })) ?? [],
      narrativeCompleteness: clampScore(
        source.narrativePlan?.scores.completeness ??
          selectedHook.estimatedNarrativeCompleteness
      ),
    },
    editPlan: {
      sourceSegments: selectedHook.sourceSegments,
      temporalReorderingAllowed: false,
      temporalReorderingApplied: false,
      rationale: selectedHook.requiresTemporalReordering
        ? "Stored for shadow comparison; nonlinear editing remains gated."
        : "Uses a grounded contiguous source opening.",
    },
    firstVisual,
    firstCaption: {
      timestampSeconds: selectedHook.firstSpokenWordTimestamp,
      text: selectedHook.firstCaptionText,
      source: "transcript",
      appearsImmediately:
        selectedHook.firstSpokenWordTimestamp != null &&
        selectedHook.firstSpokenWordTimestamp - selectedHook.openingStartTimestamp <= 0.35,
    },
    coverCandidates: covers,
    titleCandidates: titles,
    recommendedTitleCandidateId: selectedTitle.id,
    selectedTitleCandidateId: selectedTitle.id,
    creatorSelection: null,
    platformPackages: [],
    qualityReview: {
      passed: !issues.some((issue) => issue.severity === "critical"),
      repairPasses,
      issues,
    },
    decisionEvidence: selectedHook.reasoningEvidence,
    warnings: selectedHook.warnings,
    modelDecision: null,
    hookDNA,
  });
}

export function shouldApplyHookDecision(
  mode: HookEngineMode,
  momentId: string,
  abPercent: number
): boolean {
  if (mode === "new") return true;
  if (mode !== "ab") return false;
  const bucket = Math.abs(hashString(momentId)) % 100;
  return bucket < Math.max(0, Math.min(100, Math.round(abPercent)));
}

