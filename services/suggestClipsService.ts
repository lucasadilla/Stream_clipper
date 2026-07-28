import { prisma } from "@/lib/db";
import { toJsonValue } from "@/lib/utils";
import { enrichEventWindowClip } from "@/services/findClipService";
import { MAX_CLIP_SECONDS, MIN_CLIP_SECONDS } from "@/lib/clipConstants";

const MIN_SCORE = 8;
const TARGET_MIN_SECONDS = 20;
const TARGET_MAX_SECONDS = 55;
const OVERLAP_RATIO = 0.45;

type ClipCandidate = {
  start: number;
  end: number;
  title: string;
  reason: string;
  confidence: number;
  source: string;
};

function overlaps(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): boolean {
  return aStart < bEnd && bStart < aEnd;
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

function clampClipRange(start: number, end: number): { start: number; end: number } {
  let s = Math.max(0, start);
  let e = Math.max(s + MIN_CLIP_SECONDS, end);
  const duration = e - s;
  if (duration < TARGET_MIN_SECONDS) {
    e = s + TARGET_MIN_SECONDS;
  } else if (duration > TARGET_MAX_SECONDS) {
    e = s + TARGET_MAX_SECONDS;
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

export async function autoSuggestClips(
  streamSessionId: string,
  limit = 10,
  options?: { extraLimit?: number }
) {
  const extra = Math.max(0, Math.min(15, options?.extraLimit ?? 0));
  const take = Math.max(0, Math.min(25, limit));
  const targetCount = Math.max(1, take + extra);

  const [windows, audioEvents, existingClips, transcriptChunks] =
    await Promise.all([
      prisma.eventWindow.findMany({
        where: { streamSessionId, score: { gte: MIN_SCORE } },
        orderBy: { score: "desc" },
        take: 40,
      }),
      prisma.audioEvent.findMany({
        where: { streamSessionId, score: { gte: 5 } },
        orderBy: { score: "desc" },
        take: 20,
      }),
      prisma.clipSuggestion.findMany({
        where: { streamSessionId, status: { not: "rejected" } },
      }),
      prisma.transcriptChunk.findMany({
        where: { streamSessionId },
        orderBy: { startTimeSeconds: "asc" },
        take: 400,
      }),
    ]);

  const candidates: ClipCandidate[] = [];

  for (const w of windows) {
    const enriched = await enrichEventWindowClip(streamSessionId, w);
    const clamped = clampClipRange(enriched.start, enriched.end);
    candidates.push({
      ...enriched,
      start: clamped.start,
      end: clamped.end,
      source: "event_window",
    });
  }

  const { buildSpecificClipTitle, buildSpecificClipReason } = await import(
    "@/lib/clipDescriptions"
  );

  for (const a of audioEvents) {
    const rawStart = Math.max(0, a.startTimeSeconds - 3);
    const rawEnd =
      rawStart +
      Math.min(
        TARGET_MAX_SECONDS,
        Math.max(TARGET_MIN_SECONDS, a.endTimeSeconds - a.startTimeSeconds + 8)
      );
    const { start, end } = clampClipRange(rawStart, rawEnd);
    const transcript = await getTranscriptSnippet(streamSessionId, start, end);

    candidates.push({
      start,
      end,
      title: buildSpecificClipTitle({
        startTimeSeconds: start,
        endTimeSeconds: end,
        transcriptText: transcript,
        audioSummary: a.summary,
      }),
      reason: buildSpecificClipReason({
        startTimeSeconds: start,
        endTimeSeconds: end,
        transcriptText: transcript,
        audioSummary: a.summary,
      }),
      confidence: Math.min(0.9, 0.4 + a.score / 20),
      source: "audio_event",
    });
  }

  // Transcript density fallbacks when hype signals are sparse.
  if (candidates.length < targetCount) {
    const usable = transcriptChunks.filter((c) => {
      const text = c.text.trim();
      return (
        text.length > 24 &&
        text !== "[silence]" &&
        text !== "[processing error]" &&
        !text.includes("[Live transcript")
      );
    });

    const excitement =
      /\b(omg|wtf|no way|clip|insane|crazy|dude|bro|what|holy|lol|lmao|gg|rage|died|clutch)\b/i;

    const scored = usable
      .map((c) => {
        const words = c.text.trim().split(/\s+/).length;
        const bonus = excitement.test(c.text) ? 12 : 0;
        return { chunk: c, score: words + bonus };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 30);

    for (const { chunk } of scored) {
      if (candidates.length >= targetCount * 2) break;
      const mid = (chunk.startTimeSeconds + chunk.endTimeSeconds) / 2;
      const { start, end } = clampClipRange(
        mid - TARGET_MIN_SECONDS / 2,
        mid + TARGET_MAX_SECONDS / 2
      );
      const transcript = chunk.text.trim();
      candidates.push({
        start,
        end,
        title: buildSpecificClipTitle({
          startTimeSeconds: start,
          endTimeSeconds: end,
          transcriptText: transcript,
        }),
        reason: buildSpecificClipReason({
          startTimeSeconds: start,
          endTimeSeconds: end,
          transcriptText: transcript,
        }),
        confidence: Math.min(0.75, 0.35 + transcript.length / 400),
        source: "transcript_density",
      });
    }
  }

  // Even spacing fallback across the recorded timeline.
  if (candidates.length < targetCount && transcriptChunks.length > 0) {
    const maxEnd = Math.max(
      ...transcriptChunks.map((c) => c.endTimeSeconds),
      TARGET_MAX_SECONDS
    );
    const slots = Math.max(targetCount, 6);
    for (let i = 0; i < slots; i++) {
      const center = ((i + 0.5) / slots) * maxEnd;
      const { start, end } = clampClipRange(
        center - TARGET_MIN_SECONDS / 2,
        center + TARGET_MAX_SECONDS / 2
      );
      if (start >= maxEnd - MIN_CLIP_SECONDS) continue;
      const transcript = await getTranscriptSnippet(streamSessionId, start, end);
      candidates.push({
        start,
        end,
        title: buildSpecificClipTitle({
          startTimeSeconds: start,
          endTimeSeconds: end,
          transcriptText: transcript,
        }),
        reason: buildSpecificClipReason({
          startTimeSeconds: start,
          endTimeSeconds: end,
          transcriptText: transcript || "Evenly sampled moment from the stream.",
        }),
        confidence: 0.4,
        source: "even_sample",
      });
    }
  }

  candidates.sort((a, b) => b.confidence - a.confidence);

  const created = [];
  const accepted = existingClips.map((c) => ({
    startTimeSeconds: c.startTimeSeconds,
    endTimeSeconds: c.endTimeSeconds,
  }));

  for (const c of candidates) {
    if (created.length >= targetCount) break;
    if (isTooSimilar(c, accepted)) continue;

    const clip = await prisma.clipSuggestion.create({
      data: {
        streamSessionId,
        title: c.title.slice(0, 200),
        startTimeSeconds: c.start,
        endTimeSeconds: c.end,
        reason: c.reason.slice(0, 2000),
        confidence: c.confidence,
        suggestedLayout: "auto",
        status: "suggested",
        rawAiJson: toJsonValue({ source: "auto_suggest", kind: c.source }),
      },
    });
    created.push(clip);
    accepted.push({
      startTimeSeconds: clip.startTimeSeconds,
      endTimeSeconds: clip.endTimeSeconds,
    });
  }

  return { created: created.length, clips: created };
}

async function getTranscriptSnippet(
  streamSessionId: string,
  start: number,
  end: number
) {
  const chunks = await prisma.transcriptChunk.findMany({
    where: {
      streamSessionId,
      startTimeSeconds: { lte: end },
      endTimeSeconds: { gte: start },
    },
    orderBy: { startTimeSeconds: "asc" },
    take: 4,
  });
  return chunks.map((c) => c.text).join(" ");
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
