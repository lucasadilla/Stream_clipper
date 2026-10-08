import { prisma } from "@/lib/db";
import { buildCaptionTrack, type CaptionCue } from "@/lib/captionTrack";
import { applyCaptionEdits } from "@/lib/captionEdits";
import {
  buildAutomaticCaptionDirection,
  parseCaptionDirectionPlan,
  type CaptionDirectionPlan,
} from "@/lib/captionDirector";
import { toJsonValue } from "@/lib/utils";
import { readCaptionEdits } from "@/services/captionEditService";
import { getTranscriptChunksForRange } from "@/services/transcriptService";

async function captionCuesForClip(input: {
  streamSessionId: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
}): Promise<CaptionCue[]> {
  const [chunks, edits] = await Promise.all([
    getTranscriptChunksForRange(
      input.streamSessionId,
      input.startTimeSeconds,
      input.endTimeSeconds
    ),
    readCaptionEdits(input.streamSessionId),
  ]);
  return applyCaptionEdits(
    buildCaptionTrack(
      chunks.map((chunk) => ({
        id: chunk.id,
        startTimeSeconds: chunk.startTimeSeconds,
        endTimeSeconds: chunk.endTimeSeconds,
        text: chunk.text,
        rawJson: chunk.rawJson,
      })),
      "vertical"
    ),
    edits
  ).filter(
    (cue) =>
      cue.endTimeSeconds > input.startTimeSeconds &&
      cue.startTimeSeconds < input.endTimeSeconds
  );
}

export async function getCaptionDirectionForClip(
  clipSuggestionId: string,
  options: { force?: boolean } = {}
): Promise<{ plan: CaptionDirectionPlan; cues: CaptionCue[] }> {
  const clip = await prisma.clipSuggestion.findUnique({
    where: { id: clipSuggestionId },
    select: {
      id: true,
      title: true,
      reason: true,
      startTimeSeconds: true,
      endTimeSeconds: true,
      streamSessionId: true,
      captionDirection: true,
      streamSession: { select: { title: true } },
    },
  });
  if (!clip) throw new Error("Clip not found");

  const cues = await captionCuesForClip(clip);
  const automatic = buildAutomaticCaptionDirection(cues);
  const cached = options.force
    ? null
    : parseCaptionDirectionPlan(clip.captionDirection, cues);
  if (cached) {
    return { plan: cached, cues };
  }

  const plan = automatic;

  await prisma.clipSuggestion
    .update({
      where: { id: clip.id },
      data: { captionDirection: toJsonValue(plan) },
    })
    .catch((error) => {
      console.warn(
        "[caption-director] could not cache direction:",
        error instanceof Error ? error.message : error
      );
    });
  return { plan, cues };
}

/** Read-only lookup for render/autopilot; never puts an AI call on the render path. */
export async function getCachedCaptionDirectionForClip(
  clipSuggestionId: string,
  cues: CaptionCue[]
): Promise<CaptionDirectionPlan | null> {
  const clip = await prisma.clipSuggestion.findUnique({
    where: { id: clipSuggestionId },
    select: { captionDirection: true },
  });
  return parseCaptionDirectionPlan(clip?.captionDirection, cues);
}

/** Warm local caption styling beside thumbnails without paid model calls. */
export async function prepareCaptionDirections(
  clipSuggestionIds: string[]
): Promise<void> {
  for (const id of clipSuggestionIds.slice(0, 6)) {
    await getCaptionDirectionForClip(id).catch(() => null);
  }
}
