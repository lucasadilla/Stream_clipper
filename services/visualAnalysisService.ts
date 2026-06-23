import { toJsonValue } from "@/lib/utils";
import { prisma } from "@/lib/db";
import { extractFrames } from "@/lib/ffmpeg";
import { getFramesDir, ensureDir } from "@/lib/storage";
import { resolveStoragePath } from "@/lib/storage";
import { formatSeconds } from "@/lib/time";

/** OCR provider interface — stub for MVP */
export interface OcrProvider {
  detectText(imagePath: string): Promise<string[]>;
}

/** Frame summary provider — stub for MVP */
export interface FrameSummaryProvider {
  summarize(imagePath: string): Promise<string>;
}

export class StubOcrProvider implements OcrProvider {
  async detectText(): Promise<string[]> {
    return [];
  }
}

export class StubFrameSummaryProvider implements FrameSummaryProvider {
  async summarize(): Promise<string> {
    return "Frame analysis placeholder";
  }
}

export async function analyzeVisual(
  streamSessionId: string,
  sourceFilePath: string,
  intervalSeconds = 2
) {
  const framesDir = getFramesDir(streamSessionId);
  await ensureDir(framesDir);

  const fullPath = resolveStoragePath(sourceFilePath);
  const framePaths = await extractFrames(fullPath, framesDir, intervalSeconds);

  await prisma.visualEvent.deleteMany({ where: { streamSessionId } });

  const events = detectSceneChanges(framePaths, intervalSeconds);

  const created = [];
  for (const event of events) {
    const record = await prisma.visualEvent.create({
      data: {
        streamSessionId,
        startTimeSeconds: event.startTimeSeconds,
        endTimeSeconds: event.endTimeSeconds,
        type: event.type,
        score: event.score,
        summary: event.summary,
        rawData: toJsonValue(event.rawData),
      },
    });
    created.push(record);
  }

  return { events: created.length, framesExtracted: framePaths.length };
}

interface VisualEventData {
  startTimeSeconds: number;
  endTimeSeconds: number;
  type: "scene_change" | "high_motion" | "text_detected" | "face_detected" | "facecam_region";
  score: number;
  summary: string;
  rawData: Record<string, unknown>;
}

/**
 * Simple scene change detection based on frame index spacing.
 * Real implementation would compare frame histograms/differences.
 */
function detectSceneChanges(
  framePaths: string[],
  intervalSeconds: number
): VisualEventData[] {
  const events: VisualEventData[] = [];

  // Placeholder: mark every 30 seconds as potential scene change for demo
  const sceneInterval = Math.max(1, Math.floor(30 / intervalSeconds));

  for (let i = sceneInterval; i < framePaths.length; i += sceneInterval) {
    const time = i * intervalSeconds;
    events.push({
      startTimeSeconds: time,
      endTimeSeconds: time + intervalSeconds,
      type: "scene_change",
      score: 3,
      summary: `Possible scene change detected around ${formatSeconds(time)}.`,
      rawData: { framePath: framePaths[i], frameIndex: i },
    });
  }

  // Mark first frame region as high_motion placeholder
  if (framePaths.length > 5) {
    events.push({
      startTimeSeconds: 0,
      endTimeSeconds: 10,
      type: "high_motion",
      score: 2,
      summary: `Visual activity detected in opening segment (0:00 - 0:10).`,
      rawData: { frameCount: Math.min(5, framePaths.length) },
    });
  }

  return events;
}
