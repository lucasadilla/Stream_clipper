import { prisma } from "@/lib/db";
import { toJsonValue } from "@/lib/utils";
import { MAX_CLIP_SECONDS, MIN_CLIP_SECONDS } from "@/lib/clipConstants";
import {
  buildSpecificClipReason,
  buildSpecificClipTitle,
  clipLengthFromMoment,
  scoreTranscriptClipWorthiness,
} from "@/lib/clipDescriptions";
import {
  getClipContentProfile,
  inferClipContentType,
  type ClipContentProfile,
  type ClipContentType,
} from "@/lib/clipContentProfile";
import {
  isSpecificClickableTitle,
  rankClipCandidatesWithAI,
  sanitizeRankedClipTitle,
  type RankedCandidate,
} from "@/services/clipRankingService";
import { refineClipToCompleteSpeech } from "@/lib/clipBoundaries";
import {
  narrativePlanQualityBonus,
  narrativePlanSummary,
  planNarrativeClip,
  type NarrativeBeat,
  type NarrativePlan,
} from "@/lib/narrativeBeats";

export const CLIP_SUGGESTION_VERSION = 6;

const MIN_SCORE = 6;
const OVERLAP_RATIO = 0.45;

type ClipCandidate = {
  start: number;
  end: number;
  title: string;
  reason: string;
  confidence: number;
  source: string;
  worth: number;
  contentType: ClipContentType;
  context: string;
  focusTimeSeconds: number;
  rankingEvidence?: string;
  titleAccuracyScore?: number;
  clickabilityScore?: number;
  boundaryAdjusted?: boolean;
  endingComplete?: boolean;
  narrativePlan?: NarrativePlan;
  narrativeSource?: "deterministic" | "ai";
};

function rankingCandidateId(candidate: ClipCandidate, index: number): string {
  return [
    "candidate",
    index,
    Math.round(candidate.start * 1000),
    Math.round(candidate.end * 1000),
    candidate.source,
  ].join("_");
}

type TranscriptSnippetChunk = {
  id: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
};

type CandidateChatMessage = {
  videoTimeSeconds: number | null;
  authorName: string | null;
  messageText: string;
};

interface EventWindowRawData {
  metrics?: {
    topMessages?: string[];
    hypeHits?: string[];
  };
}

function transcriptSnippetFromChunks(
  chunks: TranscriptSnippetChunk[],
  start: number,
  end: number,
  take = 8
): string {
  const text: string[] = [];
  for (const chunk of chunks) {
    if (chunk.startTimeSeconds > end) break;
    if (chunk.endTimeSeconds < start) continue;
    if (
      !chunk.text ||
      chunk.text === "[silence]" ||
      chunk.text === "[processing error]" ||
      chunk.text.includes("[Live transcript")
    ) {
      continue;
    }
    text.push(chunk.text);
    if (text.length >= take) break;
  }
  return text.join(" ");
}

function normalizeEvidenceText(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function evidenceTimeFromChunks(
  chunks: TranscriptSnippetChunk[],
  start: number,
  end: number,
  evidence: string
): number | null {
  const needle = normalizeEvidenceText(evidence);
  if (!needle) return null;
  for (const chunk of chunks) {
    if (chunk.startTimeSeconds > end) break;
    if (chunk.endTimeSeconds < start) continue;
    if (normalizeEvidenceText(chunk.text).includes(needle)) {
      return Math.max(
        start,
        Math.min(end, (chunk.startTimeSeconds + chunk.endTimeSeconds) / 2)
      );
    }
  }
  return null;
}

function rankedBeatStrength(
  role: NarrativeBeat["role"],
  scores: NonNullable<RankedCandidate["narrativeScores"]>
): number {
  switch (role) {
    case "hook":
      return scores.hook / 100;
    case "payoff":
    case "reaction":
      return scores.payoff / 100;
    case "resolution":
      return scores.completeness / 100;
    case "setup":
    case "escalation":
      return scores.coherence / 100;
  }
}

function mergeRankedNarrativePlan(
  base: NarrativePlan | undefined,
  ranked: RankedCandidate
): NarrativePlan | undefined {
  if (
    !base ||
    ranked.startTimeSeconds == null ||
    ranked.endTimeSeconds == null ||
    ranked.focusTimeSeconds == null ||
    !ranked.narrativeArcType ||
    !ranked.narrativeScores
  ) {
    return base;
  }
  const rankedStart = ranked.startTimeSeconds;
  const rankedEnd = ranked.endTimeSeconds;
  const rankedFocus = ranked.focusTimeSeconds;
  const selectedChunks = base.contextChunks.filter(
    (chunk) =>
      chunk.endTimeSeconds >= rankedStart - 0.5 &&
      chunk.startTimeSeconds <= rankedEnd + 0.5
  );
  const chunkById = new Map(
    base.contextChunks.map((chunk) => [chunk.id, chunk])
  );
  const beats = (ranked.narrativeBeats ?? []).flatMap((beat) => {
    const chunk = chunkById.get(beat.chunkId);
    if (!chunk) return [];
    return [
      {
        ...beat,
        startTimeSeconds: chunk.startTimeSeconds,
        endTimeSeconds: chunk.endTimeSeconds,
        strength: rankedBeatStrength(beat.role, ranked.narrativeScores!),
      },
    ];
  });
  const first = selectedChunks[0];
  const last = selectedChunks.at(-1);
  const focusChunk = selectedChunks.reduce<TranscriptSnippetChunk | null>(
    (closest, chunk) => {
      if (!closest) return chunk;
      const chunkDistance = Math.abs(
        (chunk.startTimeSeconds + chunk.endTimeSeconds) / 2 -
          rankedFocus
      );
      const closestDistance = Math.abs(
        (closest.startTimeSeconds + closest.endTimeSeconds) / 2 -
          rankedFocus
      );
      return chunkDistance < closestDistance ? chunk : closest;
    },
    null
  );
  const blendScore = (deterministic: number, ai: number) =>
    Math.round(deterministic * 0.35 + ai * 0.65);
  const blendedScores = {
    hook: blendScore(base.scores.hook, ranked.narrativeScores.hook),
    payoff: blendScore(base.scores.payoff, ranked.narrativeScores.payoff),
    completeness: blendScore(
      base.scores.completeness,
      ranked.narrativeScores.completeness
    ),
    standalone: blendScore(
      base.scores.standalone,
      ranked.narrativeScores.standalone
    ),
    coherence: blendScore(
      base.scores.coherence,
      ranked.narrativeScores.coherence
    ),
    pacing: blendScore(base.scores.pacing, ranked.narrativeScores.pacing),
    total: blendScore(base.scores.total, ranked.narrativeScores.total),
  };

  return {
    ...base,
    startTimeSeconds: rankedStart,
    endTimeSeconds: rankedEnd,
    focusTimeSeconds: rankedFocus,
    startChunkId: first?.id ?? null,
    endChunkId: last?.id ?? null,
    focusChunkId: focusChunk?.id ?? null,
    arcType: ranked.narrativeArcType,
    beats,
    scores: blendedScores,
    selectedText: selectedChunks.map((chunk) => chunk.text).join(" "),
    endingComplete: true,
    accepted: true,
    rejectionReason: undefined,
  };
}

function chatInRange(
  messages: CandidateChatMessage[],
  start: number,
  end: number
): Array<{ authorName?: string; messageText: string }> {
  return messages
    .filter(
      (message) =>
        message.videoTimeSeconds != null &&
        message.videoTimeSeconds >= start &&
        message.videoTimeSeconds <= end
    )
    .slice(0, 12)
    .map((message) => ({
      ...(message.authorName ? { authorName: message.authorName } : {}),
      messageText: message.messageText,
    }));
}

function overlapRatio(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): number {
  const overlapStart = Math.max(aStart, bStart);
  const overlapEnd = Math.min(aEnd, bEnd);
  const overlap = Math.max(0, overlapEnd - overlapStart);
  const shorter = Math.min(aEnd - aStart, bEnd - bStart);
  if (shorter <= 0) return 0;
  return overlap / shorter;
}

function clampClipRange(
  start: number,
  end: number,
  profile: ClipContentProfile
): { start: number; end: number } {
  const s = Math.max(0, start);
  let e = Math.max(s + MIN_CLIP_SECONDS, end);
  const duration = e - s;
  if (duration < profile.targetMinSeconds) {
    e = s + profile.targetMinSeconds;
  } else if (duration > profile.targetMaxSeconds) {
    e = s + profile.targetMaxSeconds;
  }
  if (e - s > MAX_CLIP_SECONDS) {
    e = s + MAX_CLIP_SECONDS;
  }
  return { start: s, end: e };
}

function isTooSimilar(
  candidate: ClipCandidate,
  existing: Array<{ startTimeSeconds: number; endTimeSeconds: number }>
): boolean {
  return existing.some(
    (clip) =>
      overlapRatio(
        candidate.start,
        candidate.end,
        clip.startTimeSeconds,
        clip.endTimeSeconds
      ) >= OVERLAP_RATIO
  );
}

function sourceBonus(source: string, profile: ClipContentProfile): number {
  switch (source) {
    case "event_window":
      return profile.eventWeight;
    case "audio_event":
      return profile.audioWeight;
    case "transcript_density":
      return profile.transcriptWeight;
    default:
      return 0;
  }
}

export async function autoSuggestClips(
  streamSessionId: string,
  limit = 10,
  options?: {
    extraLimit?: number;
    fromSeconds?: number;
    throughSeconds?: number;
  }
) {
  const extra = Math.max(0, Math.min(15, options?.extraLimit ?? 0));
  const take = Math.max(0, Math.min(25, limit));
  const targetCount = Math.max(1, take + extra);
  const fromSeconds = Math.max(0, options?.fromSeconds ?? 0);
  const throughSeconds = Math.max(
    fromSeconds,
    options?.throughSeconds ?? Number.MAX_SAFE_INTEGER
  );
  const transcriptContextStart = Math.max(0, fromSeconds - 90);

  const [windows, audioEvents, existingClips, transcriptChunks, session] =
    await Promise.all([
      prisma.eventWindow.findMany({
        where: {
          streamSessionId,
          score: { gte: MIN_SCORE },
          endTimeSeconds: { gte: fromSeconds },
          startTimeSeconds: { lte: throughSeconds },
        },
        orderBy: { score: "desc" },
        take: 50,
      }),
      prisma.audioEvent.findMany({
        where: {
          streamSessionId,
          score: { gte: 4 },
          endTimeSeconds: { gte: fromSeconds },
          startTimeSeconds: { lte: throughSeconds },
        },
        orderBy: { score: "desc" },
        take: 30,
      }),
      prisma.clipSuggestion.findMany({
        where: { streamSessionId, status: { not: "rejected" } },
      }),
      prisma.transcriptChunk.findMany({
        where: {
          streamSessionId,
          endTimeSeconds: { gte: transcriptContextStart },
          startTimeSeconds: { lte: throughSeconds },
        },
        orderBy: { startTimeSeconds: "asc" },
        take: 2500,
          select: {
            id: true,
            startTimeSeconds: true,
            endTimeSeconds: true,
            text: true,
            rawJson: true,
          },
      }),
      prisma.streamSession.findUnique({
        where: { id: streamSessionId },
        select: { title: true, description: true, channelTitle: true },
      }),
    ]);

  const transcriptSample = transcriptChunks
    .slice(0, 80)
    .map((chunk) => chunk.text)
    .join(" ");
  const contentType = inferClipContentType({
    title: session?.title,
    description: session?.description,
    transcript: transcriptSample,
  });
  const profile = getClipContentProfile(contentType);
  const usableTranscriptChunks = transcriptChunks.filter((chunk) => {
    const text = chunk.text.trim();
    return (
      text.length > 0 &&
      text !== "[silence]" &&
      text !== "[processing error]" &&
      !text.includes("[Live transcript")
    );
  });
  const newTranscriptChunks = usableTranscriptChunks.filter(
    (chunk) =>
      chunk.endTimeSeconds >= fromSeconds &&
      chunk.startTimeSeconds <= throughSeconds
  );

  const chatMessages =
    windows.length > 0
      ? await prisma.chatMessage.findMany({
          where: {
            streamSessionId,
            videoTimeSeconds: {
              gte: Math.min(...windows.map((window) => window.startTimeSeconds)),
              lte: Math.max(...windows.map((window) => window.endTimeSeconds)),
            },
          },
          orderBy: { videoTimeSeconds: "asc" },
          take: 1000,
          select: {
            videoTimeSeconds: true,
            authorName: true,
            messageText: true,
          },
        })
      : [];

  const candidates: ClipCandidate[] = [];

  for (const w of windows) {
    const raw = w.rawData as EventWindowRawData | null;
    const momentRange = clipLengthFromMoment(
      w.startTimeSeconds,
      w.endTimeSeconds
    );
    const clamped = clampClipRange(
      contentType === "gaming" || contentType === "gameplay_only"
        ? momentRange.start - 2
        : momentRange.start,
      contentType === "gaming" || contentType === "gameplay_only"
        ? momentRange.end + 5
        : momentRange.end,
      profile
    );
    const transcript = transcriptSnippetFromChunks(
      transcriptChunks,
      clamped.start,
      clamped.end
    );
    const chat = chatInRange(
      chatMessages,
      w.startTimeSeconds,
      w.endTimeSeconds
    );
    if (chat.length === 0 && raw?.metrics?.topMessages?.length) {
      chat.push(
        ...raw.metrics.topMessages
          .slice(0, 12)
          .map((messageText) => ({ messageText }))
      );
    }
    const title = buildSpecificClipTitle({
      startTimeSeconds: clamped.start,
      endTimeSeconds: clamped.end,
      chatMessages: chat,
      transcriptText: transcript,
      hypeHits: raw?.metrics?.hypeHits,
    });
    const reason = buildSpecificClipReason({
      startTimeSeconds: clamped.start,
      endTimeSeconds: clamped.end,
      chatMessages: chat,
      transcriptText: transcript,
      eventSummary: w.summary,
      hypeHits: raw?.metrics?.hypeHits,
    });
    const transcriptWorth = scoreTranscriptClipWorthiness(
      `${transcript} ${reason}`
    );
    candidates.push({
      start: clamped.start,
      end: clamped.end,
      title,
      reason,
      confidence: Math.min(0.95, 0.5 + w.score / 50),
      source: "event_window",
      contentType,
      focusTimeSeconds: Math.max(
        clamped.start,
        Math.min(clamped.end, (w.startTimeSeconds + w.endTimeSeconds) / 2)
      ),
      context: [
        transcript,
        w.summary,
        ...chat.slice(0, 6).map((message) => message.messageText),
      ]
        .filter(Boolean)
        .join(" | "),
      worth:
        sourceBonus("event_window", profile) +
        w.score +
        transcriptWorth +
        Math.min(0.95, 0.5 + w.score / 50) * 20,
    });
  }

  for (const a of audioEvents) {
    const rawStart = Math.max(0, a.startTimeSeconds - 3);
    const rawEnd =
      rawStart +
      Math.min(
        profile.targetMaxSeconds,
        Math.max(
          profile.targetMinSeconds,
          a.endTimeSeconds - a.startTimeSeconds + 8
        )
      );
    const { start, end } = clampClipRange(rawStart, rawEnd, profile);
    const transcript = transcriptSnippetFromChunks(
      transcriptChunks,
      start,
      end
    );
    const title = buildSpecificClipTitle({
      startTimeSeconds: start,
      endTimeSeconds: end,
      transcriptText: transcript,
      audioSummary: a.summary,
    });
    const reason = buildSpecificClipReason({
      startTimeSeconds: start,
      endTimeSeconds: end,
      transcriptText: transcript,
      audioSummary: a.summary,
    });
    const tw = scoreTranscriptClipWorthiness(transcript);

    candidates.push({
      start,
      end,
      title,
      reason,
      confidence: Math.min(0.92, 0.45 + a.score / 18 + tw / 100),
      source: "audio_event",
      contentType,
      focusTimeSeconds: Math.max(
        start,
        Math.min(end, (a.startTimeSeconds + a.endTimeSeconds) / 2)
      ),
      context: [transcript, a.summary].filter(Boolean).join(" | "),
      worth:
        sourceBonus("audio_event", profile) +
        a.score * (contentType === "podcast" ? 0.75 : 2) +
        tw,
    });
  }

  // Strong transcript hooks — prefer these over even sampling.
  {
    const scored = newTranscriptChunks
      .filter((chunk) => chunk.text.trim().length > 24)
      .map((c) => ({
        chunk: c,
        score: scoreTranscriptClipWorthiness(c.text),
      }))
      .filter((c) => c.score >= 18)
      .sort((a, b) => b.score - a.score)
      .slice(0, 40);

    for (const { chunk, score } of scored) {
      if (candidates.length >= targetCount * 3) break;
      const mid = (chunk.startTimeSeconds + chunk.endTimeSeconds) / 2;
      const { start, end } = clampClipRange(
        mid - profile.targetMinSeconds / 2,
        mid + profile.targetMaxSeconds / 2,
        profile
      );
      const transcript = transcriptSnippetFromChunks(
        transcriptChunks,
        start,
        end
      );
      const better =
        transcript.length > chunk.text.trim().length
          ? transcript
          : chunk.text.trim();
      candidates.push({
        start,
        end,
        title: buildSpecificClipTitle({
          startTimeSeconds: start,
          endTimeSeconds: end,
          transcriptText: better,
        }),
        reason: buildSpecificClipReason({
          startTimeSeconds: start,
          endTimeSeconds: end,
          transcriptText: better,
        }),
        confidence: Math.min(0.88, 0.4 + score / 80),
        source: "transcript_density",
        contentType,
        focusTimeSeconds: mid,
        context: better,
        worth: sourceBonus("transcript_density", profile) + score,
      });
    }
  }

  // Guaranteed transcript fallback. Anchor ranges to real speech chunks rather
  // than arbitrary timestamps, so sparse transcripts still produce choices.
  if (candidates.length < targetCount && newTranscriptChunks.length > 0) {
    const slots = Math.min(
      newTranscriptChunks.length,
      Math.max(targetCount * 2, 6)
    );
    for (let i = 0; i < slots; i++) {
      const chunkIndex = Math.min(
        newTranscriptChunks.length - 1,
        Math.floor(((i + 0.5) / slots) * newTranscriptChunks.length)
      );
      const anchor = newTranscriptChunks[chunkIndex];
      const center =
        (anchor.startTimeSeconds + anchor.endTimeSeconds) / 2;
      const { start, end } = clampClipRange(
        center - profile.targetMinSeconds / 2,
        center + profile.targetMaxSeconds / 2,
        profile
      );
      const transcript = transcriptSnippetFromChunks(
        transcriptChunks,
        start,
        end
      );
      const tw = scoreTranscriptClipWorthiness(transcript);
      const context = transcript || anchor.text.trim();
      if (!context) continue;
      candidates.push({
        start,
        end,
        title: buildSpecificClipTitle({
          startTimeSeconds: start,
          endTimeSeconds: end,
          transcriptText: context,
        }),
        reason: buildSpecificClipReason({
          startTimeSeconds: start,
          endTimeSeconds: end,
          transcriptText: context,
        }),
        confidence: Math.min(0.55, 0.3 + tw / 100),
        source: "even_sample",
        contentType,
        focusTimeSeconds: center,
        context,
        worth: Math.max(1, tw),
      });
    }
  }

  // Target lengths guide candidate discovery, but a complete ending outranks a
  // shorter duration. Give the completion pass the full product clip budget.
  const narrativeMaximumSeconds = MAX_CLIP_SECONDS;
  for (const candidate of candidates) {
    const plan = planNarrativeClip({
      startTimeSeconds: candidate.start,
      endTimeSeconds: candidate.end,
      focusTimeSeconds: candidate.focusTimeSeconds,
      transcriptChunks: usableTranscriptChunks,
      contentType,
      source: candidate.source,
      targetMinSeconds: Math.min(profile.targetMinSeconds, 18),
      maximumDurationSeconds: narrativeMaximumSeconds,
    });
    candidate.narrativePlan = plan;
    candidate.narrativeSource = "deterministic";
    candidate.worth += narrativePlanQualityBonus(plan);
    if (plan.accepted && plan.selectedText) {
      candidate.start = plan.startTimeSeconds;
      candidate.end = plan.endTimeSeconds;
      candidate.focusTimeSeconds = plan.focusTimeSeconds;
      candidate.context = [plan.selectedText, candidate.context]
        .filter(Boolean)
        .join(" | ");
      candidate.reason = `${candidate.reason} ${narrativePlanSummary(plan)}`.trim();
    }
  }

  candidates.sort((a, b) => b.worth - a.worth || b.confidence - a.confidence);

  const aiPoolSize = Math.min(20, Math.max(10, targetCount * 2));
  const aiPool = candidates.slice(0, aiPoolSize);
  const aiCandidateEntries = aiPool.map((candidate, index) => ({
    id: rankingCandidateId(candidate, index),
    candidate,
  }));
  const aiCandidatesById = new Map(
    aiCandidateEntries.map((entry) => [entry.id, entry.candidate])
  );
  const aiRanking = await rankClipCandidatesWithAI({
    streamTitle: session?.title,
    streamDescription: session?.description,
    channelTitle: session?.channelTitle,
    contentType,
    candidates: aiCandidateEntries.map(({ id, candidate }) => ({
      id,
      startTimeSeconds: candidate.start,
      endTimeSeconds: candidate.end,
      source: candidate.source,
      currentTitle: candidate.title,
      context: candidate.context,
      signalScore: candidate.worth,
      focusTimeSeconds: candidate.focusTimeSeconds,
      targetMinSeconds: Math.min(profile.targetMinSeconds, 18),
      maximumDurationSeconds: narrativeMaximumSeconds,
      transcriptChunks: candidate.narrativePlan?.contextChunks,
    })),
  });
  if (aiRanking?.length) {
    const rankedCandidates = aiRanking.flatMap((ranked) => {
      const candidate = aiCandidatesById.get(ranked.id);
      if (!candidate) return [];
      const narrativePlan = mergeRankedNarrativePlan(
        candidate.narrativePlan,
        ranked
      );
      return [
        {
          ...candidate,
          title: ranked.title,
          // `reason` is surfaced as public description/caption context. Keep
          // ranking rationale internal so producer notes never reach a post.
          reason: candidate.reason,
          rankingEvidence: ranked.evidence,
          titleAccuracyScore: ranked.titleAccuracyScore,
          clickabilityScore: ranked.clickabilityScore,
          start: ranked.startTimeSeconds ?? candidate.start,
          end: ranked.endTimeSeconds ?? candidate.end,
          focusTimeSeconds:
            ranked.focusTimeSeconds ??
            evidenceTimeFromChunks(
              transcriptChunks,
              ranked.startTimeSeconds ?? candidate.start,
              ranked.endTimeSeconds ?? candidate.end,
              ranked.evidence
            ) ??
            candidate.focusTimeSeconds,
          narrativePlan,
          narrativeSource: "ai" as const,
          worth:
            candidate.worth * 0.25 +
            ranked.interestScore * 0.55 +
            (narrativePlan?.scores.total ?? 0) * 0.2,
          confidence: Math.max(
            candidate.confidence,
            Math.min(0.98, ranked.interestScore / 100)
          ),
        },
      ];
    });
    rankedCandidates.sort((a, b) => b.worth - a.worth);
    const rankedOriginals = new Set(
      aiRanking.flatMap((ranked) => {
        const original = aiCandidatesById.get(ranked.id);
        return original ? [original] : [];
      })
    );
    candidates.splice(
      0,
      candidates.length,
      ...rankedCandidates,
      ...candidates.filter((candidate) => !rankedOriginals.has(candidate))
    );
  }

  const selected: ClipCandidate[] = [];
  const accepted = existingClips.map((c) => ({
    startTimeSeconds: c.startTimeSeconds,
    endTimeSeconds: c.endTimeSeconds,
  }));

  for (const c of candidates) {
    if (selected.length >= targetCount) break;
    if (Number.isFinite(throughSeconds)) {
      c.end = Math.min(c.end, throughSeconds);
      if (c.end - c.start < MIN_CLIP_SECONDS) continue;
    }
    const visualSignal =
      (contentType === "gaming" || contentType === "gameplay_only") &&
      (c.source === "event_window" || c.source === "audio_event");
    if (c.narrativePlan?.rejectionReason === "housekeeping_only") continue;
    if (c.narrativePlan?.rejectionReason && !visualSignal) continue;
    if (
      c.source === "even_sample" &&
      c.narrativePlan &&
      !c.narrativePlan.accepted
    ) {
      continue;
    }
    const boundary = refineClipToCompleteSpeech({
      start: c.start,
      end: c.end,
      transcriptChunks: usableTranscriptChunks,
      maximumDurationSeconds: narrativeMaximumSeconds,
      postRollSeconds:
        contentType === "gaming" || contentType === "gameplay_only" ? 1.35 : 0.7,
      requireSettledEnding: options?.throughSeconds != null,
    });
    if (!boundary.endingComplete) continue;
    c.start = boundary.start;
    c.end = boundary.end;
    c.boundaryAdjusted = boundary.adjusted;
    c.endingComplete = boundary.endingComplete;
    if (c.narrativePlan) {
      c.narrativePlan = {
        ...c.narrativePlan,
        startTimeSeconds: c.start,
        endTimeSeconds: c.end,
        endingComplete: boundary.endingComplete,
      };
    }
    if (isTooSimilar(c, accepted)) continue;
    const cleanTitle = sanitizeRankedClipTitle(c.title);
    if (!isSpecificClickableTitle(cleanTitle)) continue;
    if (
      c.source === "even_sample" &&
      selected.length >= Math.ceil(targetCount * 0.6)
    ) {
      continue;
    }

    c.title = cleanTitle;
    selected.push(c);
    accepted.push({
      startTimeSeconds: c.start,
      endTimeSeconds: c.end,
    });
  }

  const created = await Promise.all(
    selected.map((candidate) =>
      prisma.clipSuggestion.create({
        data: {
          streamSessionId,
          title: candidate.title.slice(0, 200),
          startTimeSeconds: candidate.start,
          endTimeSeconds: candidate.end,
          reason: candidate.reason.slice(0, 2000),
          confidence: candidate.confidence,
          suggestedLayout: "auto",
          status: "suggested",
          rawAiJson: toJsonValue({
            source: "auto_suggest",
            suggestionVersion: CLIP_SUGGESTION_VERSION,
            kind: candidate.source,
            worth: candidate.worth,
            contentType: candidate.contentType,
            focusTimeSeconds: candidate.focusTimeSeconds,
            rankingEvidence: candidate.rankingEvidence,
            titleAccuracyScore: candidate.titleAccuracyScore,
            clickabilityScore: candidate.clickabilityScore,
            boundaryAdjusted: candidate.boundaryAdjusted,
            endingComplete: candidate.endingComplete,
            narrativeEngineVersion: 2,
            narrativeSource: candidate.narrativeSource,
            narrative: candidate.narrativePlan
              ? {
                  startTimeSeconds: candidate.narrativePlan.startTimeSeconds,
                  endTimeSeconds: candidate.narrativePlan.endTimeSeconds,
                  focusTimeSeconds: candidate.narrativePlan.focusTimeSeconds,
                  startChunkId: candidate.narrativePlan.startChunkId,
                  endChunkId: candidate.narrativePlan.endChunkId,
                  focusChunkId: candidate.narrativePlan.focusChunkId,
                  arcType: candidate.narrativePlan.arcType,
                  beats: candidate.narrativePlan.beats,
                  scores: candidate.narrativePlan.scores,
                  endingComplete: candidate.narrativePlan.endingComplete,
                  accepted: candidate.narrativePlan.accepted,
                }
              : undefined,
          }),
        },
      })
    )
  );

  return { created: created.length, clips: created };
}

export async function createManualClip(
  streamSessionId: string,
  params: {
    title: string;
    startTimeSeconds: number;
    endTimeSeconds: number;
    reason?: string;
  }
) {
  const { title, startTimeSeconds, endTimeSeconds, reason } = params;

  if (endTimeSeconds <= startTimeSeconds) {
    throw new Error("End time must be after start time");
  }
  if (endTimeSeconds - startTimeSeconds > MAX_CLIP_SECONDS) {
    throw new Error(`Clips must be ${MAX_CLIP_SECONDS / 60} minutes or shorter`);
  }

  return prisma.clipSuggestion.create({
    data: {
      streamSessionId,
      title,
      startTimeSeconds,
      endTimeSeconds,
      reason: reason ?? "Manual clip selection",
      confidence: 1,
      suggestedLayout: "center_crop",
      status: "saved",
      rawAiJson: toJsonValue({ source: "manual" }),
    },
  });
}

export async function updateClipSuggestion(
  clipSuggestionId: string,
  data: {
    title?: string;
    startTimeSeconds?: number;
    endTimeSeconds?: number;
    reason?: string;
    suggestedLayout?: string;
    status?: string;
  }
) {
  const existing = await prisma.clipSuggestion.findUnique({
    where: { id: clipSuggestionId },
  });
  if (!existing) throw new Error("Clip not found");

  const start = data.startTimeSeconds ?? existing.startTimeSeconds;
  const end = data.endTimeSeconds ?? existing.endTimeSeconds;
  if (end <= start) throw new Error("End time must be after start time");
  if (end - start < MIN_CLIP_SECONDS) {
    throw new Error(`Clips must be at least ${MIN_CLIP_SECONDS}s`);
  }
  if (end - start > MAX_CLIP_SECONDS) {
    throw new Error(`Clips must be ${MAX_CLIP_SECONDS / 60} minutes or shorter`);
  }

  return prisma.clipSuggestion.update({
    where: { id: clipSuggestionId },
    data: {
      ...(data.title != null ? { title: data.title.slice(0, 200) } : {}),
      ...(data.reason != null ? { reason: data.reason.slice(0, 2000) } : {}),
      ...(data.suggestedLayout != null
        ? { suggestedLayout: data.suggestedLayout }
        : {}),
      ...(data.status != null ? { status: data.status } : {}),
      startTimeSeconds: start,
      endTimeSeconds: end,
    },
  });
}
