import { hasIncompleteSpeechEnding } from "@/lib/clipBoundaries";
import type { ClipContentType } from "@/lib/clipContentProfile";
import type {
  StructuredVisualContext,
  VisualNarrativeRole,
} from "@/lib/visualAnalysis";

export type NarrativeBeatRole =
  | "hook"
  | "setup"
  | "escalation"
  | "payoff"
  | "reaction"
  | "resolution";

export type NarrativeArcType =
  | "question_answer"
  | "problem_solution"
  | "claim_evidence"
  | "reversal"
  | "setup_payoff"
  | "reaction"
  | "visual_payoff"
  | "standalone_insight"
  | "incomplete";

export type NarrativeTranscriptChunk = {
  id: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
};

export type NarrativeBeat = {
  role: NarrativeBeatRole;
  chunkId: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  evidence: string;
  strength: number;
};

export type NarrativeScores = {
  hook: number;
  payoff: number;
  completeness: number;
  standalone: number;
  coherence: number;
  pacing: number;
  total: number;
};

export type NarrativePlan = {
  startTimeSeconds: number;
  endTimeSeconds: number;
  focusTimeSeconds: number;
  startChunkId: string | null;
  endChunkId: string | null;
  focusChunkId: string | null;
  arcType: NarrativeArcType;
  beats: NarrativeBeat[];
  scores: NarrativeScores;
  contextChunks: NarrativeTranscriptChunk[];
  visualBeats?: Array<{
    role: VisualNarrativeRole;
    timeSeconds: number;
    evidence: string;
    strength: number;
  }>;
  selectedText: string;
  endingComplete: boolean;
  accepted: boolean;
  rejectionReason?: string;
};

type RoleScores = Record<NarrativeBeatRole, number>;

const INVALID_TRANSCRIPT =
  /^\[(?:silence|processing error|live transcript[^\]]*)\]$/i;
const HOUSEKEEPING =
  /\b(?:welcome (?:back|in)|thanks for (?:watching|joining)|like and subscribe|follow (?:me|the channel)|we(?:'re| are) live|starting soon|be right back|technical difficulties|check out my|link in (?:the )?bio)\b/i;
const OPENING_FRAGMENT =
  /^(?:and|but|because|so|then|also|anyway|which|that|this|it|he|she|they|them|those|these|therefore|however)\b/i;
const HOOK =
  /\b(?:how|why|what if|the (?:real|biggest|worst|best) (?:reason|mistake|problem)|here(?:'s| is) (?:why|what)|nobody tells you|I (?:never|finally|almost|can't believe)|you (?:need|have) to|the truth|imagine|guess what|wait|hold on)\b/i;
const SETUP =
  /\b(?:for context|when I|when we|before (?:that|this)|at first|it started|we were|I was|the plan|the goal|the reason|because|back then|earlier|originally)\b/i;
const ESCALATION =
  /\b(?:but|however|until|suddenly|instead|except|then|the problem|went wrong|couldn't|wouldn't|kept|worse|risk|challenge|against|almost|close|last chance|one more)\b/i;
const PAYOFF =
  /\b(?:turns out|that's why|that is why|the answer|the result|in the end|eventually|finally|so I|so we|which means|therefore|worked|fixed|solved|won|lost|beat|finished|made it|got it|there it is|proved|realized|learned)\b/i;
const REACTION =
  /\b(?:no way|oh my|let's go|what the|I can't believe|wow|unreal|amazing|hilarious|that was|we did it|I did it|yes|nooo+|lol|lmao|haha+)\b/i;
const RESOLUTION =
  /\b(?:that's it|that was it|there you go|from then on|ever since|lesson|takeaway|ultimately|in the end|and that|which is why|now I know|never again)\b/i;
const PROBLEM =
  /\b(?:problem|mistake|failed|failure|wrong|broken|couldn't|wouldn't|struggled|issue|risk|lost|stuck)\b/i;
const SOLUTION =
  /\b(?:solution|fixed|solved|worked|figured out|answer|learned|changed|instead|now I)\b/i;
const CLAIM =
  /\b(?:I think|I believe|the truth|the reason|you should|you shouldn't|the best|the worst|actually|my point)\b/i;
const TRANSITION =
  /\b(?:because|but|so|then|therefore|however|instead|which means|that's why|for example|in the end)\b/i;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const score100 = (value: number) => Math.round(clamp01(value) * 100);

export function cleanNarrativeText(value: string): string {
  return value
    .replace(/\.{3,}|…+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function usableChunk(chunk: NarrativeTranscriptChunk): boolean {
  const text = cleanNarrativeText(chunk.text);
  return (
    text.length > 0 &&
    !INVALID_TRANSCRIPT.test(text) &&
    chunk.endTimeSeconds > chunk.startTimeSeconds
  );
}

function words(text: string): string[] {
  return cleanNarrativeText(text)
    .toLocaleLowerCase()
    .replace(/[^a-z0-9']+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function punctuationCompletion(text: string): number {
  const cleaned = cleanNarrativeText(text);
  if (/[.!?][)'\"]?$/.test(cleaned)) return 1;
  if (hasIncompleteSpeechEnding(cleaned)) return 0.05;
  return 0.68;
}

function classifyChunk(text: string): RoleScores {
  const cleaned = cleanNarrativeText(text);
  const wordCount = words(cleaned).length;
  const question = /\?\s*$/.test(cleaned) || /^(?:how|why|what|when|where|who|would|could|should|did|do|is|are|can)\b/i.test(cleaned);
  const exclamation = (cleaned.match(/!/g) ?? []).length;
  const emphasis = (cleaned.match(/\b[A-Z]{2,}\b/g) ?? []).length;
  const complete = punctuationCompletion(cleaned);

  return {
    hook: clamp01(
      (HOOK.test(cleaned) ? 0.58 : 0) +
        (question ? 0.34 : 0) +
        (wordCount >= 5 && wordCount <= 28 ? 0.12 : 0)
    ),
    setup: clamp01(
      (SETUP.test(cleaned) ? 0.68 : 0) +
        (wordCount >= 7 ? 0.15 : 0) +
        (TRANSITION.test(cleaned) ? 0.08 : 0)
    ),
    escalation: clamp01(
      (ESCALATION.test(cleaned) ? 0.68 : 0) +
        (PROBLEM.test(cleaned) ? 0.2 : 0) +
        Math.min(0.12, exclamation * 0.06)
    ),
    payoff: clamp01(
      (PAYOFF.test(cleaned) ? 0.7 : 0) +
        (SOLUTION.test(cleaned) ? 0.18 : 0) +
        complete * 0.12
    ),
    reaction: clamp01(
      (REACTION.test(cleaned) ? 0.76 : 0) +
        Math.min(0.18, exclamation * 0.09) +
        Math.min(0.08, emphasis * 0.04)
    ),
    resolution: clamp01(
      (RESOLUTION.test(cleaned) ? 0.72 : 0) +
        (PAYOFF.test(cleaned) ? 0.12 : 0) +
        complete * 0.2
    ),
  };
}

function closestChunkIndex(
  chunks: NarrativeTranscriptChunk[],
  timeSeconds: number
): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  chunks.forEach((chunk, index) => {
    const middle = (chunk.startTimeSeconds + chunk.endTimeSeconds) / 2;
    const distance = Math.abs(middle - timeSeconds);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function strongestIndex(
  scores: RoleScores[],
  role: NarrativeBeatRole,
  from: number,
  through: number,
  minimum: number
): number | null {
  let best: { index: number; score: number } | null = null;
  for (let index = Math.max(0, from); index <= through; index++) {
    const score = scores[index]?.[role] ?? 0;
    if (score < minimum) continue;
    if (!best || score > best.score) best = { index, score };
  }
  return best?.index ?? null;
}

function openingIsContextless(text: string): boolean {
  const cleaned = cleanNarrativeText(text);
  if (!cleaned) return true;
  if (OPENING_FRAGMENT.test(cleaned)) return true;
  const firstWords = words(cleaned).slice(0, 4);
  return firstWords.length < 3;
}

function transcriptPacingScore(
  chunks: NarrativeTranscriptChunk[],
  durationSeconds: number
): number {
  if (durationSeconds <= 0) return 0;
  const wordCount = words(chunks.map((chunk) => chunk.text).join(" ")).length;
  const wordsPerSecond = wordCount / durationSeconds;
  if (wordsPerSecond >= 1.6 && wordsPerSecond <= 3.8) return 100;
  if (wordsPerSecond >= 1.05 && wordsPerSecond <= 4.6) return 78;
  if (wordsPerSecond >= 0.6 && wordsPerSecond <= 5.2) return 55;
  return 28;
}

function inferArcType(
  selectedText: string,
  roleScores: RoleScores[],
  anchorIndex: number
): NarrativeArcType {
  const before = roleScores.slice(0, anchorIndex + 1);
  const after = roleScores.slice(anchorIndex);
  const hasQuestion = /\?/.test(selectedText);
  const hasPayoff = after.some((score) => score.payoff >= 0.45);
  const hasReaction = after.some((score) => score.reaction >= 0.52);
  if (hasQuestion && hasPayoff) return "question_answer";
  if (PROBLEM.test(selectedText) && SOLUTION.test(selectedText)) {
    return "problem_solution";
  }
  if (
    before.some((score) => score.escalation >= 0.5) &&
    hasPayoff
  ) {
    return "reversal";
  }
  if (CLAIM.test(selectedText) && (hasPayoff || TRANSITION.test(selectedText))) {
    return "claim_evidence";
  }
  if (hasReaction) return "reaction";
  if (hasPayoff) return "setup_payoff";
  return "standalone_insight";
}

function beatFromChunk(
  role: NarrativeBeatRole,
  chunk: NarrativeTranscriptChunk,
  strength: number
): NarrativeBeat {
  const evidenceWords = cleanNarrativeText(chunk.text).split(/\s+/).slice(0, 18);
  return {
    role,
    chunkId: chunk.id,
    startTimeSeconds: chunk.startTimeSeconds,
    endTimeSeconds: chunk.endTimeSeconds,
    evidence: evidenceWords.join(" "),
    strength: Math.round(clamp01(strength) * 100) / 100,
  };
}

function buildBeatList(
  chunks: NarrativeTranscriptChunk[],
  roleScores: RoleScores[],
  anchorIndex: number
): NarrativeBeat[] {
  const picks: Array<{ role: NarrativeBeatRole; index: number | null }> = [
    {
      role: "hook",
      index: strongestIndex(roleScores, "hook", 0, anchorIndex, 0.35),
    },
    {
      role: "setup",
      index: strongestIndex(roleScores, "setup", 0, anchorIndex, 0.35),
    },
    {
      role: "escalation",
      index: strongestIndex(
        roleScores,
        "escalation",
        Math.max(0, anchorIndex - 2),
        Math.min(chunks.length - 1, anchorIndex + 2),
        0.4
      ),
    },
    {
      role: "payoff",
      index: strongestIndex(
        roleScores,
        "payoff",
        anchorIndex,
        chunks.length - 1,
        0.34
      ),
    },
    {
      role: "reaction",
      index: strongestIndex(
        roleScores,
        "reaction",
        anchorIndex,
        chunks.length - 1,
        0.45
      ),
    },
    {
      role: "resolution",
      index: strongestIndex(
        roleScores,
        "resolution",
        anchorIndex,
        chunks.length - 1,
        0.42
      ),
    },
  ];

  return picks
    .flatMap(({ role, index }) => {
      if (index == null || !chunks[index]) return [];
      return [beatFromChunk(role, chunks[index], roleScores[index]![role])];
    })
    .sort(
      (a, b) =>
        a.startTimeSeconds - b.startTimeSeconds ||
        a.endTimeSeconds - b.endTimeSeconds
    );
}

function scorePlan(input: {
  chunks: NarrativeTranscriptChunk[];
  roleScores: RoleScores[];
  anchorIndex: number;
  endingComplete: boolean;
  contentType: ClipContentType;
  arcType: NarrativeArcType;
}): NarrativeScores {
  const { chunks, roleScores, anchorIndex, endingComplete, contentType, arcType } = input;
  const hook = score100(
    Math.max(0, ...roleScores.slice(0, anchorIndex + 1).map((score) => score.hook))
  );
  const payoff = score100(
    Math.max(
      0,
      ...roleScores
        .slice(anchorIndex)
        .map((score) => Math.max(score.payoff, score.reaction * 0.92))
    )
  );
  const finalScore = roleScores.at(-1);
  const completeness = endingComplete
    ? Math.round(82 + 18 * (finalScore?.resolution ?? 0))
    : 20;
  const firstText = chunks[0]?.text ?? "";
  const standalone = Math.round(
    (openingIsContextless(firstText) ? 42 : 82) +
      Math.min(14, hook * 0.14) +
      (chunks.length >= 2 ? 4 : 0)
  );
  const selectedText = chunks.map((chunk) => chunk.text).join(" ");
  const transitionCount = (selectedText.match(new RegExp(TRANSITION.source, "gi")) ?? []).length;
  const arcBonus = arcType === "standalone_insight" ? 5 : 16;
  const coherence = Math.min(
    100,
    Math.round(54 + arcBonus + Math.min(18, transitionCount * 5) + (endingComplete ? 10 : 0))
  );
  const duration = Math.max(
    0.1,
    (chunks.at(-1)?.endTimeSeconds ?? 0) - (chunks[0]?.startTimeSeconds ?? 0)
  );
  const pacing = transcriptPacingScore(chunks, duration);
  const gaming = contentType === "gaming" || contentType === "gameplay_only";
  const total = Math.round(
    hook * (gaming ? 0.16 : 0.2) +
      payoff * (gaming ? 0.3 : 0.24) +
      completeness * 0.2 +
      standalone * (gaming ? 0.1 : 0.16) +
      coherence * 0.14 +
      pacing * (gaming ? 0.1 : 0.06)
  );

  return {
    hook,
    payoff,
    completeness: Math.min(100, completeness),
    standalone: Math.min(100, standalone),
    coherence,
    pacing,
    total,
  };
}

/**
 * Build a transcript-aligned hook-to-payoff arc around a signal candidate.
 * This is intentionally deterministic so live suggestions remain useful when
 * the model is unavailable; the AI pass may tighten this plan later.
 */
export function planNarrativeClip(input: {
  startTimeSeconds: number;
  endTimeSeconds: number;
  focusTimeSeconds: number;
  transcriptChunks: NarrativeTranscriptChunk[];
  contentType: ClipContentType;
  source: string;
  targetMinSeconds: number;
  maximumDurationSeconds: number;
}): NarrativePlan {
  const originalStart = Math.max(0, input.startTimeSeconds);
  const originalEnd = Math.max(originalStart, input.endTimeSeconds);
  const maxDuration = Math.max(input.targetMinSeconds, input.maximumDurationSeconds);
  const contextStart = Math.max(0, originalStart - (input.contentType === "podcast" ? 24 : 14));
  const contextEnd = originalEnd + (input.contentType === "podcast" ? 26 : 18);
  const contextChunks = input.transcriptChunks
    .filter(usableChunk)
    .filter(
      (chunk) =>
        chunk.endTimeSeconds >= contextStart &&
        chunk.startTimeSeconds <= contextEnd
    )
    .map((chunk) => ({ ...chunk, text: cleanNarrativeText(chunk.text) }))
    .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);

  if (contextChunks.length === 0) {
    const visual =
      input.source === "event_window" ||
      input.source === "audio_event" ||
      input.source === "visual_event";
    return {
      startTimeSeconds: originalStart,
      endTimeSeconds: originalEnd,
      focusTimeSeconds: input.focusTimeSeconds,
      startChunkId: null,
      endChunkId: null,
      focusChunkId: null,
      arcType: visual ? "visual_payoff" : "incomplete",
      beats: [],
      scores: {
        hook: visual ? 48 : 0,
        payoff: visual ? 58 : 0,
        completeness: visual ? 72 : 0,
        standalone: visual ? 58 : 0,
        coherence: visual ? 55 : 0,
        pacing: 0,
        total: visual ? 54 : 0,
      },
      contextChunks: [],
      selectedText: "",
      endingComplete: visual,
      accepted: visual,
      ...(!visual ? { rejectionReason: "no_coherent_speech" } : {}),
    };
  }

  const allScores = contextChunks.map((chunk) => classifyChunk(chunk.text));
  const nearestFocus = closestChunkIndex(contextChunks, input.focusTimeSeconds);
  const originalIndexes = contextChunks
    .map((chunk, index) => ({ chunk, index }))
    .filter(
      ({ chunk }) =>
        chunk.endTimeSeconds >= originalStart &&
        chunk.startTimeSeconds <= originalEnd
    )
    .map(({ index }) => index);
  const focusPool = originalIndexes.length > 0 ? originalIndexes : [nearestFocus];
  let anchorIndex = nearestFocus;
  let anchorScore = -1;
  for (const index of focusPool) {
    const score = allScores[index]!;
    const middle =
      (contextChunks[index]!.startTimeSeconds +
        contextChunks[index]!.endTimeSeconds) /
      2;
    const proximity = Math.max(0, 1 - Math.abs(middle - input.focusTimeSeconds) / 30);
    const value =
      Math.max(score.hook, score.escalation, score.payoff, score.reaction) * 0.78 +
      proximity * 0.22;
    if (value > anchorScore) {
      anchorIndex = index;
      anchorScore = value;
    }
  }

  const earliestAllowed = Math.max(
    0,
    contextChunks[anchorIndex]!.endTimeSeconds - maxDuration
  );
  let startIndex = Math.max(0, originalIndexes[0] ?? anchorIndex);
  const hookIndex = strongestIndex(
    allScores,
    "hook",
    0,
    anchorIndex,
    input.contentType === "gameplay_only" ? 0.48 : 0.34
  );
  if (
    hookIndex != null &&
    contextChunks[hookIndex]!.startTimeSeconds >= earliestAllowed
  ) {
    startIndex = hookIndex;
  } else {
    const setupIndex = strongestIndex(allScores, "setup", 0, anchorIndex, 0.42);
    if (
      setupIndex != null &&
      contextChunks[setupIndex]!.startTimeSeconds >= earliestAllowed
    ) {
      startIndex = setupIndex;
    }
  }
  while (
    startIndex > 0 &&
    openingIsContextless(contextChunks[startIndex]!.text) &&
    contextChunks[startIndex - 1]!.startTimeSeconds >= earliestAllowed
  ) {
    startIndex -= 1;
  }

  const maximumEnd = contextChunks[startIndex]!.startTimeSeconds + maxDuration;
  const latestAllowedIndex = contextChunks.reduce(
    (last, chunk, index) =>
      chunk.endTimeSeconds <= maximumEnd + 0.01 ? index : last,
    startIndex
  );
  const payoffIndex = strongestIndex(
    allScores,
    "payoff",
    anchorIndex,
    latestAllowedIndex,
    0.34
  );
  const reactionIndex = strongestIndex(
    allScores,
    "reaction",
    anchorIndex,
    latestAllowedIndex,
    0.48
  );
  let endIndex = Math.max(
    anchorIndex,
    originalIndexes.at(-1) ?? anchorIndex,
    payoffIndex ?? anchorIndex,
    reactionIndex ?? anchorIndex
  );
  endIndex = Math.min(endIndex, latestAllowedIndex);

  // Never leave an audible dependent clause hanging. Extend only across short
  // speech gaps and never sacrifice the selected opening to exceed the cap.
  while (
    endIndex < latestAllowedIndex &&
    (hasIncompleteSpeechEnding(contextChunks[endIndex]!.text) ||
      (payoffIndex != null && endIndex === payoffIndex))
  ) {
    const next = contextChunks[endIndex + 1]!;
    const current = contextChunks[endIndex]!;
    if (next.startTimeSeconds - current.endTimeSeconds > 2.75) break;
    endIndex += 1;
  }

  while (
    endIndex < latestAllowedIndex &&
    contextChunks[endIndex]!.endTimeSeconds -
      contextChunks[startIndex]!.startTimeSeconds <
      input.targetMinSeconds
  ) {
    endIndex += 1;
  }

  const selectedChunks = contextChunks.slice(startIndex, endIndex + 1);
  const selectedScores = allScores.slice(startIndex, endIndex + 1);
  const selectedAnchor = Math.max(0, anchorIndex - startIndex);
  const first = selectedChunks[0]!;
  const last = selectedChunks.at(-1)!;
  const endingComplete = !hasIncompleteSpeechEnding(last.text);
  const selectedText = selectedChunks.map((chunk) => chunk.text).join(" ");
  const arcType = inferArcType(selectedText, selectedScores, selectedAnchor);
  const scores = scorePlan({
    chunks: selectedChunks,
    roleScores: selectedScores,
    anchorIndex: selectedAnchor,
    endingComplete,
    contentType: input.contentType,
    arcType,
  });
  const housekeepingOnly = selectedChunks.every((chunk) => HOUSEKEEPING.test(chunk.text));
  const tooShort = last.endTimeSeconds - first.startTimeSeconds < 3;
  const weakSpeech = words(selectedText).length < 7;
  const rejectionReason = housekeepingOnly
    ? "housekeeping_only"
    : !endingComplete
      ? "incomplete_ending"
      : tooShort || weakSpeech
        ? "no_coherent_speech"
        : undefined;

  return {
    startTimeSeconds: Math.max(0, first.startTimeSeconds - 0.18),
    endTimeSeconds: Math.min(maximumEnd, last.endTimeSeconds + 0.45),
    focusTimeSeconds: Math.max(
      first.startTimeSeconds,
      Math.min(last.endTimeSeconds, input.focusTimeSeconds)
    ),
    startChunkId: first.id,
    endChunkId: last.id,
    focusChunkId: contextChunks[anchorIndex]?.id ?? null,
    arcType,
    beats: buildBeatList(selectedChunks, selectedScores, selectedAnchor),
    scores,
    contextChunks,
    selectedText,
    endingComplete,
    accepted: rejectionReason == null && scores.total >= 42,
    ...(rejectionReason ? { rejectionReason } : {}),
  };
}

export function narrativePlanQualityBonus(plan: NarrativePlan): number {
  if (plan.rejectionReason) return -35;
  const arcBonus =
    plan.arcType === "question_answer" ||
    plan.arcType === "problem_solution" ||
    plan.arcType === "reversal"
      ? 12
      : plan.arcType === "setup_payoff" || plan.arcType === "claim_evidence"
        ? 8
        : 3;
  return plan.scores.total * 0.42 + arcBonus;
}

export function narrativePlanSummary(plan: NarrativePlan): string {
  const labels = plan.beats.map((beat) => beat.role).filter((role, index, all) => all.indexOf(role) === index);
  if (labels.length === 0) return "A visually driven moment with a clear outcome.";
  return `A complete ${plan.arcType.replace(/_/g, "-")} arc with ${labels.join(", ")}.`;
}

/** Blend verified visual beats into the deterministic transcript story plan. */
export function applyVisualContextToNarrativePlan(
  plan: NarrativePlan,
  visual: StructuredVisualContext
): NarrativePlan {
  const usable = visual.events
    .filter((event) => event.confidence >= 0.5)
    .sort((a, b) => a.timeSeconds - b.timeSeconds);
  if (usable.length === 0) return plan;

  const hasSetup = usable.some(
    (event) => event.type === "setup" || event.type === "context"
  );
  const hasPayoff = usable.some(
    (event) => event.type === "outcome" || event.type === "reaction"
  );
  const hasAction = usable.some((event) => event.type === "action");
  const verifiedArc =
    visual.sufficient && visual.confidence >= 0.62 && (hasPayoff || hasAction);
  const visualStrength = Math.round(visual.confidence * 100);
  const blend = (base: number, visualScore: number, weight = 0.35) =>
    Math.min(100, Math.round(base * (1 - weight) + visualScore * weight));
  const scores: NarrativeScores = {
    hook: blend(plan.scores.hook, hasAction ? visualStrength : 55, 0.22),
    payoff: blend(plan.scores.payoff, hasPayoff ? visualStrength : 45, 0.42),
    completeness: blend(
      plan.scores.completeness,
      hasSetup && hasPayoff ? visualStrength : 58,
      0.38
    ),
    standalone: blend(
      plan.scores.standalone,
      visual.sufficient ? visualStrength : 48,
      0.3
    ),
    coherence: blend(
      plan.scores.coherence,
      visual.sufficient ? visualStrength : 50,
      0.3
    ),
    pacing: plan.scores.pacing,
    total: 0,
  };
  scores.total = Math.round(
    scores.hook * 0.18 +
      scores.payoff * 0.26 +
      scores.completeness * 0.2 +
      scores.standalone * 0.14 +
      scores.coherence * 0.16 +
      scores.pacing * 0.06
  );

  return {
    ...plan,
    arcType:
      verifiedArc &&
      (plan.arcType === "incomplete" || plan.contextChunks.length === 0)
        ? "visual_payoff"
        : plan.arcType,
    scores,
    visualBeats: usable.map((event) => ({
      role: event.type,
      timeSeconds: event.timeSeconds,
      evidence: event.description,
      strength: event.confidence,
    })),
    endingComplete: verifiedArc ? true : plan.endingComplete,
    accepted: verifiedArc ? true : plan.accepted,
    ...(verifiedArc && plan.rejectionReason === "no_coherent_speech"
      ? { rejectionReason: undefined }
      : {}),
  };
}
