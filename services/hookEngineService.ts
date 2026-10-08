import { z } from "zod";
import { getAiClient, hasAnyAiKey } from "@/lib/aiProvider";
import { getHookEnginePolicy } from "@/lib/aiModelPolicy";
import {
  HOOK_POLICY_VERSION,
  buildLocalClipPackage,
  clipPackageSchema,
  reviewHookCandidate,
  titleCandidateSchema,
  type BuildHookPackageInput,
  type ClipPackage,
  type HookCandidate,
  type TitleCandidate,
} from "@/lib/hookIntelligence";
import {
  isRankedTitleGrounded,
  isSpecificClickableTitle,
  sanitizeRankedClipTitle,
} from "@/services/clipRankingService";

const hookJudgeResponseSchema = z.object({
  reviews: z
    .array(
      z.object({
        momentId: z.string(),
        selectedCandidateId: z.string(),
        decisionEvidence: z.array(z.string().min(2).max(260)).min(1).max(8),
        warnings: z.array(z.string().max(220)).max(6),
        titles: z
          .array(
            z.object({
              strategy: titleCandidateSchema.shape.strategy,
              title: z.string().min(3).max(100),
              evidence: z.string().min(2).max(180),
              specificity: z.number().min(0).max(100),
              curiosity: z.number().min(0).max(100),
              accuracy: z.number().min(0).max(100),
              brevity: z.number().min(0).max(100),
              naturalness: z.number().min(0).max(100),
              spoilerRisk: z.number().min(0).max(100),
              clickbaitRisk: z.number().min(0).max(100),
            })
          )
          .min(3)
          .max(20),
      })
    )
    .max(20),
});

type HookJudgeResponse = z.infer<typeof hookJudgeResponseSchema>;

function normalize(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function evidenceIsGrounded(evidence: string, input: BuildHookPackageInput) {
  const needle = normalize(evidence);
  if (needle.split(" ").length < 2) return false;
  const source = normalize(
    [
      input.title,
      ...input.transcriptChunks.map((chunk) => chunk.text),
      ...(input.visualContext?.events.map((event) => event.description) ?? []),
      ...(input.narrativePlan?.beats.map((beat) => beat.evidence) ?? []),
    ].join(" ")
  );
  return source.includes(needle);
}

function safeTitleCandidates(
  review: HookJudgeResponse["reviews"][number],
  input: BuildHookPackageInput,
  fallback: TitleCandidate[]
): TitleCandidate[] {
  const context = [
    input.transcriptChunks.map((chunk) => chunk.text).join(" "),
    ...(input.knownPeople ?? []),
  ]
    .filter(Boolean)
    .join(" ");
  const candidates = review.titles.flatMap((candidate, index) => {
    const title = sanitizeRankedClipTitle(candidate.title);
    if (
      !isSpecificClickableTitle(title) ||
      !evidenceIsGrounded(candidate.evidence, input) ||
      !isRankedTitleGrounded(title, candidate.evidence, context)
    ) {
      return [];
    }
    const rankScore = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          candidate.specificity * 0.23 +
            candidate.curiosity * 0.16 +
            candidate.accuracy * 0.29 +
            candidate.brevity * 0.1 +
            candidate.naturalness * 0.14 -
            candidate.spoilerRisk * 0.05 -
            candidate.clickbaitRisk * 0.15 +
            12
        )
      )
    );
    return [
      titleCandidateSchema.parse({
        id: `ai-title-${index}-${Math.abs(hashString(title))}`,
        ...candidate,
        title,
        rankScore,
        evidence: [candidate.evidence],
        warnings: [
          ...(candidate.spoilerRisk >= 60 ? ["High spoiler risk."] : []),
          ...(candidate.clickbaitRisk >= 35 ? ["Potential clickbait risk."] : []),
        ],
      }),
    ];
  });
  return [...candidates, ...fallback]
    .filter(
      (candidate, index, all) =>
        all.findIndex(
          (other) => other.title.toLocaleLowerCase() === candidate.title.toLocaleLowerCase()
        ) === index
    )
    .sort((a, b) => b.rankScore - a.rankScore)
    .slice(0, 20);
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return hash;
}

function estimatedCost(
  inputTokens: number | null,
  outputTokens: number | null
): number | null {
  const inputRate = Number(process.env.HOOK_STRONG_INPUT_USD_PER_MILLION);
  const outputRate = Number(process.env.HOOK_STRONG_OUTPUT_USD_PER_MILLION);
  if (
    inputTokens == null ||
    outputTokens == null ||
    !Number.isFinite(inputRate) ||
    !Number.isFinite(outputRate)
  ) {
    return null;
  }
  return (inputTokens * inputRate + outputTokens * outputRate) / 1_000_000;
}

function promptForPackages(
  inputs: BuildHookPackageInput[],
  packages: ClipPackage[]
): string {
  const openingLimit = getHookEnginePolicy().openingCandidatesPerMoment;
  const packets = packages.map((clipPackage, index) => {
    const input = inputs[index]!;
    return {
      momentId: input.momentId,
      contentCategory: input.contentCategory,
      currentTitle: input.title,
      verifiedPeople: input.knownPeople ?? [],
      sourceTranscript: input.transcriptChunks
        .map(
          (chunk) =>
            `[${chunk.id} ${chunk.startTimeSeconds.toFixed(2)}-${chunk.endTimeSeconds.toFixed(2)}] ${chunk.text}`
        )
        .join(" ")
        .slice(0, 6500),
      visualEvidence: input.visualContext?.events.slice(0, 10),
      narrativeBeats: input.narrativePlan?.beats.slice(0, 8),
      candidates: clipPackage.hookCandidates.slice(0, openingLimit).map((candidate) => ({
        candidateId: candidate.candidateId,
        hookType: candidate.hookType,
        openingStartTimestamp: candidate.openingStartTimestamp,
        openingEndTimestamp: candidate.openingEndTimestamp,
        firstCaptionText: candidate.firstCaptionText,
        hookTranscript: candidate.hookTranscript,
        dimensions: {
          visualStrength: candidate.visualStrength,
          speechImmediacy: candidate.speechImmediacy,
          curiosityStrength: candidate.curiosityStrength,
          clarity: candidate.clarity,
          contextBurden: candidate.contextBurden,
          spoilerRisk: candidate.spoilerRisk,
          narrativeCompleteness: candidate.estimatedNarrativeCompleteness,
        },
        evidence: candidate.reasoningEvidence,
        warnings: candidate.warnings,
      })),
    };
  });

  return `You are Clipper's final Hook and Title Judge. Compare only the supplied,
grounded opening candidates. Pick the opening that gives a stranger immediate
clarity and curiosity while preserving the actual story. Curiosity is not
confusion. Penalize missing context, fake stakes, spoilers, dead first frames,
late speech, generic formulas, and unnecessary nonlinear editing.

Generate 8-12 truthful title candidates per moment, using varied strategies.
Titles must be specific, natural, 4-11 words, under 72 characters, and supported
by an exact evidence phrase from that moment. Do not invent quotes, outcomes,
names, stakes, or context. Avoid generic hype, ALL CAPS, emojis, and hashtags.
Every title must read as a complete headline with a clear subject and action.
Never use a raw transcript fragment, verbal filler such as "you know" or
"I mean," or a title beginning with a conjunction or preposition. When a
verified person is central to the moment, prefer their name over a vague pronoun.
Transcript wording is evidence, not a ready-made title. Reject greetings,
politeness, acknowledgements, clause collisions, missing objects, and vague
"this" or "that" references. A stranger must understand the subject and action.
Never end with "that's why," "that's how," "on an ongoing basis," or another
fragment that depends on missing context. Never use analysis labels such as
scene change, visual motion detected, event window, or narrative arc as copy.

Return JSON only:
{"reviews":[{"momentId":"id","selectedCandidateId":"candidate-id","decisionEvidence":["concise grounded reason"],"warnings":[],"titles":[{"strategy":"specific_fact","title":"Specific title","evidence":"exact source phrase","specificity":90,"curiosity":80,"accuracy":98,"brevity":90,"naturalness":92,"spoilerRisk":10,"clickbaitRisk":3}]}]}

Every selectedCandidateId must be one of that moment's supplied candidates.
Every evidence string for a title must be copied exactly from its source transcript.

MOMENTS:
${JSON.stringify(packets)}`;
}

async function judgeWithModel(
  inputs: BuildHookPackageInput[],
  packages: ClipPackage[]
): Promise<{
  response: HookJudgeResponse;
  provider: string;
  model: string;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
} | null> {
  if (!hasAnyAiKey() || inputs.length === 0) return null;
  const policy = getHookEnginePolicy();
  const prompt = promptForPackages(inputs, packages);
  const models = [policy.strong.model, policy.strong.fallbackModel].filter(
    (model, index, all): model is string => Boolean(model) && all.indexOf(model) === index
  );
  for (const model of models) {
    const started = Date.now();
    try {
      const response = await getAiClient().chat.completions.create(
        {
          model,
          messages: [
            {
              role: "system",
              content:
                "You are a skeptical short-form story editor. Accuracy and context completeness outrank hype. Return schema-valid JSON only.",
            },
            { role: "user", content: prompt },
          ],
          response_format: { type: "json_object" },
          temperature: policy.strong.temperature,
          max_tokens: policy.strong.maxTokens,
        },
        { timeout: policy.strong.timeoutMs }
      );
      const content = response.choices[0]?.message?.content;
      if (!content) continue;
      const parsed: unknown = JSON.parse(content);
      return {
        response: hookJudgeResponseSchema.parse(parsed),
        provider: policy.strong.provider,
        model,
        latencyMs: Date.now() - started,
        inputTokens: response.usage?.prompt_tokens ?? null,
        outputTokens: response.usage?.completion_tokens ?? null,
      };
    } catch (error) {
      console.warn(
        `[hook-engine] ${model} judge failed:`,
        error instanceof Error ? error.message : error
      );
    }
  }
  return null;
}

function applyReview(
  clipPackage: ClipPackage,
  input: BuildHookPackageInput,
  review: HookJudgeResponse["reviews"][number],
  decision: NonNullable<Awaited<ReturnType<typeof judgeWithModel>>>
): ClipPackage {
  const proposed = clipPackage.hookCandidates.find(
    (candidate) => candidate.candidateId === review.selectedCandidateId
  );
  const selectedHook: HookCandidate =
    proposed &&
    !reviewHookCandidate(proposed).some((issue) => issue.severity === "critical")
      ? proposed
      : clipPackage.selectedHook;
  const titleCandidates = safeTitleCandidates(
    review,
    input,
    clipPackage.titleCandidates
  );
  const selectedTitle = titleCandidates[0] ?? clipPackage.titleCandidates[0]!;
  const issues = reviewHookCandidate(selectedHook);
  const shareCount = Math.max(1, decision.response.reviews.length);
  const inputTokens =
    decision.inputTokens == null
      ? null
      : Math.ceil(decision.inputTokens / shareCount);
  const outputTokens =
    decision.outputTokens == null
      ? null
      : Math.ceil(decision.outputTokens / shareCount);
  return clipPackageSchema.parse({
    ...clipPackage,
    recommendedHookCandidateId: selectedHook.candidateId,
    selectedHook,
    firstVisual: {
      ...clipPackage.firstVisual,
      timestampSeconds: selectedHook.firstVisualTimestamp,
      strength: selectedHook.visualStrength,
      motionLevel: selectedHook.openingMetrics.movementAtHalfSecond,
      reason: selectedHook.reasoningEvidence[0],
      evidence: selectedHook.reasoningEvidence,
    },
    firstCaption: {
      timestampSeconds: selectedHook.firstSpokenWordTimestamp,
      text: selectedHook.firstCaptionText,
      source: "transcript",
      appearsImmediately:
        selectedHook.firstSpokenWordTimestamp != null &&
        selectedHook.firstSpokenWordTimestamp - selectedHook.openingStartTimestamp <= 0.35,
    },
    titleCandidates,
    recommendedTitleCandidateId: selectedTitle.id,
    selectedTitleCandidateId: selectedTitle.id,
    qualityReview: {
      passed: !issues.some((issue) => issue.severity === "critical"),
      repairPasses: clipPackage.qualityReview.repairPasses,
      issues,
    },
    decisionEvidence: review.decisionEvidence.filter((item) =>
      evidenceIsGrounded(item, input)
    ).length
      ? review.decisionEvidence.filter((item) => evidenceIsGrounded(item, input))
      : selectedHook.reasoningEvidence,
    warnings: [...new Set([...clipPackage.warnings, ...review.warnings])],
    modelDecision: {
      provider: decision.provider,
      model: decision.model,
      latencyMs: decision.latencyMs,
      inputTokens,
      outputTokens,
      estimatedCostUsd: estimatedCost(inputTokens, outputTokens),
      cacheHit: false,
    },
    hookDNA: {
      ...clipPackage.hookDNA,
      hookType: selectedHook.hookType,
      firstFrameTimestamp: selectedHook.firstVisualTimestamp,
      reactionStrength: selectedHook.reactionStrength,
      firstSpokenWordTimestamp: selectedHook.firstSpokenWordTimestamp,
      firstCaptionTimestamp: selectedHook.firstSpokenWordTimestamp,
      firstCaptionText: selectedHook.firstCaptionText,
      openingTranscript: selectedHook.hookTranscript,
      hookDuration: Math.max(
        0,
        selectedHook.openingEndTimestamp - selectedHook.openingStartTimestamp
      ),
      payoffTimestamp: selectedHook.payoffTimestamp,
      temporalReorderingUsed: selectedHook.requiresTemporalReordering,
      titleStrategy: selectedTitle.strategy,
      title: selectedTitle.title,
      modelVersions: [
        ...clipPackage.hookDNA.modelVersions,
        `${decision.provider}:${decision.model}`,
      ],
      policyVersion: HOOK_POLICY_VERSION,
    },
  });
}

/**
 * Build local opening candidates for every serious moment, then spend one
 * bounded strong-model call comparing only the best configured subset.
 */
export async function buildHookPackages(
  inputs: BuildHookPackageInput[]
): Promise<Map<string, ClipPackage>> {
  const policy = getHookEnginePolicy();
  const localPackages = inputs.map((input) => buildLocalClipPackage(input));
  if (policy.mode === "legacy") return new Map();

  const seriousInputs = inputs.slice(0, policy.seriousCandidateLimit);
  const seriousPackages = localPackages.slice(0, policy.seriousCandidateLimit);
  const decision = await judgeWithModel(seriousInputs, seriousPackages);
  const reviewsByMoment = new Map(
    decision?.response.reviews.map((review) => [review.momentId, review]) ?? []
  );
  return new Map(
    inputs.map((input, index) => {
      const local = localPackages[index]!;
      const review = reviewsByMoment.get(input.momentId);
      return [
        input.momentId,
        review && decision ? applyReview(local, input, review, decision) : local,
      ];
    })
  );
}

