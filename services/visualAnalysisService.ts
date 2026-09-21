import path from "path";
import { prisma } from "@/lib/db";
import {
  detectVisualChanges,
  parsePortableGraymap,
  type LocalVisualEventType,
} from "@/lib/visualAnalysis";
import { extractVisualScanFrames } from "@/lib/ffmpeg";
import {
  ensureDir,
  fileExists,
  getFramesDir,
  resolveStoragePath,
} from "@/lib/storage";
import { toJsonValue } from "@/lib/utils";

const LOCAL_VISUAL_EVENT_TYPES: LocalVisualEventType[] = [
  "scene_change",
  "high_motion",
  "interface_change",
];

function configuredIntervalSeconds(fallback = 2): number {
  const parsed = Number.parseFloat(
    process.env.VISUAL_SCAN_INTERVAL_SECONDS?.trim() ?? ""
  );
  return Number.isFinite(parsed) && parsed >= 0.1 ? parsed : fallback;
}

function configuredScanWidth(): number {
  const parsed = Number.parseInt(
    process.env.VISUAL_SCAN_WIDTH?.trim() ?? "",
    10
  );
  return Number.isFinite(parsed) && parsed >= 48 ? parsed : 160;
}

async function persistLocalVisualEvents(input: {
  streamSessionId: string;
  startTimeSeconds: number;
  endTimeSeconds?: number;
  replaceAll: boolean;
  events: ReturnType<typeof detectVisualChanges>["events"];
}) {
  const overlap = input.replaceAll
    ? {}
    : {
        endTimeSeconds: { gte: input.startTimeSeconds },
        ...(input.endTimeSeconds != null
          ? { startTimeSeconds: { lte: input.endTimeSeconds } }
          : {}),
      };
  await prisma.visualEvent.deleteMany({
    where: {
      streamSessionId: input.streamSessionId,
      type: { in: LOCAL_VISUAL_EVENT_TYPES },
      ...overlap,
    },
  });
  if (input.events.length === 0) return 0;
  const created = await prisma.visualEvent.createMany({
    data: input.events.map((event) => ({
      streamSessionId: input.streamSessionId,
      startTimeSeconds: event.startTimeSeconds,
      endTimeSeconds: event.endTimeSeconds,
      type: event.type,
      score: event.score,
      summary: event.summary,
      rawData: toJsonValue(event.rawData),
    })),
  });
  return created.count;
}

async function scanVisualWindow(input: {
  streamSessionId: string;
  sourceFilePath: string;
  startTimeSeconds: number;
  endTimeSeconds?: number;
  intervalSeconds: number;
  replaceAll: boolean;
}) {
  const framesRoot = getFramesDir(input.streamSessionId);
  const scanId = `${Math.round(input.startTimeSeconds * 1000)}-${
    input.endTimeSeconds == null ? "end" : Math.round(input.endTimeSeconds * 1000)
  }-${Date.now()}`;
  const scanDir = path.join(framesRoot, "visual-scan", scanId);
  await ensureDir(scanDir);

  try {
    const scanFrames = await extractVisualScanFrames(
      resolveStoragePath(input.sourceFilePath),
      scanDir,
      {
        startTimeSeconds: input.startTimeSeconds,
        endTimeSeconds: input.endTimeSeconds,
        intervalSeconds: input.intervalSeconds,
        width: configuredScanWidth(),
      }
    );
    const fs = await import("fs/promises");
    const frames = await Promise.all(
      scanFrames.map(async (frame) =>
        parsePortableGraymap(
          await fs.readFile(frame.filePath),
          frame.timestampSeconds
        )
      )
    );
    const analysis = detectVisualChanges(frames, input.intervalSeconds);
    const events = await persistLocalVisualEvents({
      streamSessionId: input.streamSessionId,
      startTimeSeconds: input.startTimeSeconds,
      endTimeSeconds: input.endTimeSeconds,
      replaceAll: input.replaceAll,
      events: analysis.events,
    });
    return {
      events,
      framesExtracted: frames.length,
      metricsComputed: analysis.metrics.length,
      startTimeSeconds: input.startTimeSeconds,
      endTimeSeconds:
        input.endTimeSeconds ?? frames.at(-1)?.timestampSeconds ?? input.startTimeSeconds,
      intervalSeconds: input.intervalSeconds,
    };
  } finally {
    const fs = await import("fs/promises");
    await fs.rm(scanDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Full low-cost pass for uploaded VODs and the end-of-stream sweep. */
export async function analyzeVisual(
  streamSessionId: string,
  sourceFilePath: string,
  intervalSeconds = configuredIntervalSeconds()
) {
  return scanVisualWindow({
    streamSessionId,
    sourceFilePath,
    startTimeSeconds: 0,
    intervalSeconds,
    replaceAll: true,
  });
}

/** Incremental low-cost pass for a newly captured portion of a live source. */
export async function analyzeVisualWindow(
  streamSessionId: string,
  sourceFilePath: string,
  startTimeSeconds: number,
  endTimeSeconds: number,
  intervalSeconds = configuredIntervalSeconds()
) {
  if (endTimeSeconds - startTimeSeconds < intervalSeconds) {
    return {
      events: 0,
      framesExtracted: 0,
      metricsComputed: 0,
      startTimeSeconds,
      endTimeSeconds,
      intervalSeconds,
      skipped: true,
    };
  }
  return scanVisualWindow({
    streamSessionId,
    sourceFilePath,
    startTimeSeconds: Math.max(0, startTimeSeconds),
    endTimeSeconds,
    intervalSeconds,
    replaceAll: false,
  });
}

/**
 * Scan only footage not covered by prior local events. This makes live ticks
 * cheap and lets the final VOD pass reuse already persisted evidence.
 */
export async function analyzePendingVisualWindow(
  streamSessionId: string,
  throughSeconds: number
) {
  const source = await prisma.sourceMedia.findFirst({
    where: { streamSessionId },
    orderBy: { createdAt: "desc" },
    select: { filePath: true },
  });
  if (!source?.filePath || !fileExists(source.filePath)) {
    return { skipped: true, reason: "no_media" };
  }
  const latest = await prisma.visualEvent.findFirst({
    where: {
      streamSessionId,
      type: { in: LOCAL_VISUAL_EVENT_TYPES },
    },
    orderBy: { endTimeSeconds: "desc" },
    select: { endTimeSeconds: true },
  });
  const intervalSeconds = configuredIntervalSeconds();
  const startTimeSeconds = Math.max(
    0,
    (latest?.endTimeSeconds ?? 0) - intervalSeconds
  );
  if (throughSeconds - startTimeSeconds < Math.max(8, intervalSeconds * 3)) {
    return { skipped: true, reason: "caught_up" };
  }
  return analyzeVisualWindow(
    streamSessionId,
    source.filePath,
    startTimeSeconds,
    throughSeconds,
    intervalSeconds
  );
}
