import { prisma } from "@/lib/db";
import { toJsonValue } from "@/lib/utils";
import { enrichEventWindowClip } from "@/services/findClipService";
import { MAX_CLIP_SECONDS } from "@/lib/clipConstants";

const MIN_SCORE = 10;

function overlaps(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export async function autoSuggestClips(
  streamSessionId: string,
  limit = 5
) {
  const [windows, audioEvents, existingClips] = await Promise.all([
    prisma.eventWindow.findMany({
      where: { streamSessionId, score: { gte: MIN_SCORE } },
      orderBy: { score: "desc" },
      take: 20,
    }),
    prisma.audioEvent.findMany({
      where: { streamSessionId, score: { gte: 6 } },
      orderBy: { score: "desc" },
      take: 10,
    }),
    prisma.clipSuggestion.findMany({
      where: { streamSessionId, status: { not: "rejected" } },
    }),
  ]);

  const candidates: Array<{
    start: number;
    end: number;
    title: string;
    reason: string;
    confidence: number;
  }> = [];

  for (const w of windows) {
    const enriched = await enrichEventWindowClip(streamSessionId, w);
    candidates.push(enriched);
  }

  for (const a of audioEvents) {
    const start = Math.max(0, a.startTimeSeconds - 3);
    const end = start + Math.min(45, Math.max(20, a.endTimeSeconds - a.startTimeSeconds + 8));
    const transcript = await getTranscriptSnippet(streamSessionId, start, end);

    const { buildSpecificClipTitle, buildSpecificClipReason } = await import(
      "@/lib/clipDescriptions"
    );

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
    });
  }

  const created = [];
  for (const c of candidates) {
    if (created.length >= limit) break;

    const hasOverlap = existingClips.some((clip) =>
      overlaps(c.start, c.end, clip.startTimeSeconds, clip.endTimeSeconds)
    );
    if (hasOverlap) continue;

    const clip = await prisma.clipSuggestion.create({
      data: {
        streamSessionId,
        title: c.title,
        startTimeSeconds: c.start,
        endTimeSeconds: c.end,
        reason: c.reason,
        confidence: c.confidence,
        suggestedLayout: "center_crop",
        status: "suggested",
        rawAiJson: toJsonValue({ source: "auto_suggest" }),
      },
    });
    created.push(clip);
    existingClips.push(clip);
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
    take: 2,
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
