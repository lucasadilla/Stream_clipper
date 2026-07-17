import { toJsonValue } from "@/lib/utils";
import { prisma } from "@/lib/db";
import { analyzeAudioVolume, hasAudioStream } from "@/lib/ffmpeg";
import {
  getUploadDir,
  getWaveformCachePath,
  listSourceCandidateFiles,
  resolveStoragePath,
  toRelativeStoragePath,
} from "@/lib/storage";
import { formatSeconds } from "@/lib/time";
import {
  dbToLevel,
  downsampleVolumeSamples,
  buildWaveformFromAudioEvents,
  type WaveformBucket,
} from "@/lib/audioSpikeTimeline";
import { existsSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { findLocalSourceMedia } from "@/services/sourceMediaRepairService";

export interface AudioVolumeSample {
  timeSeconds: number;
  volumeDb: number;
}

interface WaveformCacheFile {
  maxTimeSeconds: number;
  buckets: WaveformBucket[];
}

/** Avoid spamming ffmpeg on video-only DASH parts every poll. */
const noAudioRetryAfter = new Map<string, number>();
const NO_AUDIO_RETRY_MS = 60_000;

function clearNoAudioBackoff(streamSessionId: string) {
  noAudioRetryAfter.delete(streamSessionId);
}

/**
 * Prefer the main source when it has audio; otherwise look for a companion
 * yt-dlp audio-only track (e.g. source.f140.m4a next to source.f299.mp4).
 */
async function resolveAudioInputPath(
  streamSessionId: string,
  preferredRelativePath: string
): Promise<string | null> {
  const preferred = resolveStoragePath(preferredRelativePath);
  if (existsSync(preferred) && (await hasAudioStream(preferred))) {
    return preferred;
  }

  const candidates = await listSourceCandidateFiles(getUploadDir(streamSessionId));
  for (const full of candidates) {
    if (full === preferred) continue;
    if (await hasAudioStream(full)) return full;
  }
  return null;
}

export async function readWaveformCache(
  streamSessionId: string
): Promise<WaveformCacheFile | null> {
  const cachePath = getWaveformCachePath(streamSessionId);
  if (!existsSync(cachePath)) return null;
  try {
    const raw = await readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw) as WaveformCacheFile;
    if (!Array.isArray(parsed.buckets)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeWaveformCache(
  streamSessionId: string,
  data: WaveformCacheFile
): Promise<void> {
  const cachePath = getWaveformCachePath(streamSessionId);
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(data));
}

async function mergeWaveformSegment(
  streamSessionId: string,
  startTimeSeconds: number,
  endTimeSeconds: number,
  level: number,
  maxTimeSeconds: number
): Promise<void> {
  const bucketCount = 320;
  const existing =
    (await readWaveformCache(streamSessionId)) ??
    ({
      maxTimeSeconds,
      buckets: downsampleVolumeSamples([], maxTimeSeconds, bucketCount),
    } satisfies WaveformCacheFile);

  const span = Math.max(maxTimeSeconds, existing.maxTimeSeconds, endTimeSeconds);
  let buckets = existing.buckets;
  if (span > existing.maxTimeSeconds && existing.maxTimeSeconds > 0) {
    buckets = downsampleVolumeSamples([], span, bucketCount);
    for (const bucket of existing.buckets) {
      const idx = Math.min(
        bucketCount - 1,
        Math.floor((bucket.startTimeSeconds / span) * bucketCount)
      );
      buckets[idx].level = Math.max(buckets[idx].level, bucket.level);
    }
  } else if (buckets.length !== bucketCount) {
    buckets = downsampleVolumeSamples([], span, bucketCount);
  }

  const startIdx = Math.min(
    bucketCount - 1,
    Math.floor((startTimeSeconds / span) * bucketCount)
  );
  const endIdx = Math.min(
    bucketCount,
    Math.ceil((endTimeSeconds / span) * bucketCount)
  );
  for (let i = startIdx; i < endIdx; i++) {
    buckets[i].level = Math.max(buckets[i].level, level);
  }

  await writeWaveformCache(streamSessionId, {
    maxTimeSeconds: span,
    buckets,
  });
}

export async function syncSessionAudioAnalysis(streamSessionId: string) {
  const sourceMedia = await findLocalSourceMedia(streamSessionId);
  if (!sourceMedia?.filePath) {
    return { eventsAdded: 0, analyzed: false, reason: "no_source" as const };
  }

  const backoffUntil = noAudioRetryAfter.get(streamSessionId) ?? 0;
  if (Date.now() < backoffUntil) {
    return { eventsAdded: 0, analyzed: false, reason: "no_audio" as const };
  }

  const audioPath = await resolveAudioInputPath(
    streamSessionId,
    sourceMedia.filePath
  );
  if (!audioPath) {
    noAudioRetryAfter.set(streamSessionId, Date.now() + NO_AUDIO_RETRY_MS);
    return { eventsAdded: 0, analyzed: false, reason: "no_audio" as const };
  }
  clearNoAudioBackoff(streamSessionId);

  const audioRelativePath =
    audioPath === resolveStoragePath(sourceMedia.filePath)
      ? sourceMedia.filePath
      : toRelativeStoragePath(audioPath);

  const session = await prisma.streamSession.findUnique({
    where: { id: streamSessionId },
    include: { liveRecording: true },
  });
  const isLive =
    session?.liveStatus === "live" || session?.liveStatus === "upcoming";
  const recorded =
    session?.liveRecording?.recordedSeconds ??
    sourceMedia.durationSeconds ??
    0;

  if (isLive && recorded > 0) {
    const fromSeconds = Math.max(0, recorded - 30);
    try {
      const result = await analyzeAudioSegment(
        streamSessionId,
        audioRelativePath,
        fromSeconds,
        recorded
      );
      return { eventsAdded: result.events, analyzed: true, reason: "live" as const };
    } catch (err) {
      console.warn("[audio] live analysis failed:", err instanceof Error ? err.message : err);
      return { eventsAdded: 0, analyzed: false, reason: "live_failed" as const };
    }
  }

  const [eventCount, cache] = await Promise.all([
    prisma.audioEvent.count({ where: { streamSessionId } }),
    readWaveformCache(streamSessionId),
  ]);

  if (eventCount > 0 && cache) {
    return { eventsAdded: 0, analyzed: false, reason: "cached" as const };
  }

  try {
    const result = await analyzeAudio(streamSessionId, audioRelativePath);
    return { eventsAdded: result.events, analyzed: true, reason: "full" as const };
  } catch (err) {
    console.warn(
      "[audio] full analysis failed:",
      err instanceof Error ? err.message : err
    );
    return { eventsAdded: 0, analyzed: false, reason: "failed" as const };
  }
}

export async function getTimelineWaveform(
  streamSessionId: string,
  maxTimeSeconds: number
): Promise<WaveformBucket[]> {
  const cache = await readWaveformCache(streamSessionId);
  if (cache && cache.maxTimeSeconds >= maxTimeSeconds * 0.85) {
    return cache.buckets;
  }

  const events = await prisma.audioEvent.findMany({
    where: { streamSessionId },
    orderBy: { startTimeSeconds: "asc" },
    select: {
      startTimeSeconds: true,
      endTimeSeconds: true,
      type: true,
      score: true,
      rawData: true,
    },
  });

  return buildWaveformFromAudioEvents(events, maxTimeSeconds);
}

export async function analyzeAudio(
  streamSessionId: string,
  sourceFilePath: string
) {
  const fullPath = resolveStoragePath(sourceFilePath);
  const samples = await analyzeAudioVolume(fullPath);
  const maxTimeSeconds =
    samples.length > 0
      ? Math.max(...samples.map((s) => s.timeSeconds))
      : 0;

  await prisma.audioEvent.deleteMany({ where: { streamSessionId } });

  const events = detectAudioEvents(samples);

  const created = [];
  for (const event of events) {
    const record = await prisma.audioEvent.create({
      data: {
        streamSessionId,
        startTimeSeconds: event.startTimeSeconds,
        endTimeSeconds: event.endTimeSeconds,
        type: event.type,
        score: event.score,
        summary: event.summary,
        rawData: toJsonValue({ samples: event.samples }),
      },
    });
    created.push(record);
  }

  if (maxTimeSeconds > 0) {
    await writeWaveformCache(streamSessionId, {
      maxTimeSeconds,
      buckets: downsampleVolumeSamples(samples, maxTimeSeconds, 320),
    });
  }

  return { events: created.length };
}

interface DetectedAudioEvent {
  startTimeSeconds: number;
  endTimeSeconds: number;
  type: "volume_spike" | "silence" | "loud_section";
  score: number;
  summary: string;
  samples: AudioVolumeSample[];
}

function detectAudioEvents(
  samples: AudioVolumeSample[]
): DetectedAudioEvent[] {
  if (samples.length === 0) return [];

  const events: DetectedAudioEvent[] = [];
  const volumes = samples.map((s) => s.volumeDb);
  const avg = volumes.reduce((a, b) => a + b, 0) / volumes.length;
  const threshold = avg + 8;

  // Detect volume spikes (sudden increase)
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const curr = samples[i];
    const delta = curr.volumeDb - prev.volumeDb;

    if (delta > 10 || curr.volumeDb > threshold) {
      const start = prev.timeSeconds;
      const end = curr.timeSeconds + 2;
      events.push({
        startTimeSeconds: start,
        endTimeSeconds: end,
        type: "volume_spike",
        score: Math.min(10, delta / 2 + 3),
        summary: `Audio volume spiked between ${formatSeconds(start)} and ${formatSeconds(end)}, suggesting a reaction, shout, or exciting moment.`,
        samples: [prev, curr],
      });
    }
  }

  // Detect silence
  for (const sample of samples) {
    if (sample.volumeDb < -50) {
      events.push({
        startTimeSeconds: sample.timeSeconds,
        endTimeSeconds: sample.timeSeconds + 2,
        type: "silence",
        score: 1,
        summary: `Quiet/silent section around ${formatSeconds(sample.timeSeconds)}.`,
        samples: [sample],
      });
    }
  }

  // Detect sustained loud sections
  let loudStart: number | null = null;
  for (const sample of samples) {
    if (sample.volumeDb > avg + 5) {
      if (loudStart === null) loudStart = sample.timeSeconds;
    } else if (loudStart !== null) {
      const duration = sample.timeSeconds - loudStart;
      if (duration >= 3) {
        events.push({
          startTimeSeconds: loudStart,
          endTimeSeconds: sample.timeSeconds,
          type: "loud_section",
          score: Math.min(8, duration),
          summary: `Sustained loud audio from ${formatSeconds(loudStart)} to ${formatSeconds(sample.timeSeconds)}, indicating hype or intense gameplay.`,
          samples: samples.filter(
            (s) => s.timeSeconds >= loudStart! && s.timeSeconds <= sample.timeSeconds
          ),
        });
      }
      loudStart = null;
    }
  }

  // Deduplicate overlapping events
  return mergeOverlappingEvents(events);
}

function mergeOverlappingEvents(
  events: DetectedAudioEvent[]
): DetectedAudioEvent[] {
  if (events.length === 0) return [];
  const sorted = [...events].sort(
    (a, b) => a.startTimeSeconds - b.startTimeSeconds
  );
  const merged: DetectedAudioEvent[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const curr = sorted[i];
    if (
      curr.startTimeSeconds <= last.endTimeSeconds &&
      curr.type === last.type
    ) {
      last.endTimeSeconds = Math.max(last.endTimeSeconds, curr.endTimeSeconds);
      last.score = Math.max(last.score, curr.score);
    } else {
      merged.push(curr);
    }
  }

  return merged;
}

/** Analyze a time segment of the source file (for live incremental updates). */
export async function analyzeAudioSegment(
  streamSessionId: string,
  sourceFilePath: string,
  startTimeSeconds: number,
  endTimeSeconds: number
) {
  const fullPath = resolveStoragePath(sourceFilePath);
  const duration = endTimeSeconds - startTimeSeconds;
  if (duration <= 0) return { events: 0 };
  if (!(await hasAudioStream(fullPath))) return { events: 0 };

  const { runCommand, getFfmpegPath } = await import("@/lib/ffmpeg");
  const { stderr: segErr } = await runCommand(getFfmpegPath(), [
    "-ss",
    String(startTimeSeconds),
    "-t",
    String(duration),
    "-i",
    fullPath,
    "-map",
    "0:a:0?",
    "-af",
    "volumedetect",
    "-f",
    "null",
    "-",
  ]);

  const meanMatch = segErr.match(/mean_volume: (-?[0-9.]+) dB/);
  const maxMatch = segErr.match(/max_volume: (-?[0-9.]+) dB/);
  if (!meanMatch && !maxMatch) return { events: 0 };
  const mean = meanMatch ? parseFloat(meanMatch[1]) : -30;
  const max = maxMatch ? parseFloat(maxMatch[1]) : mean;

  // The waveform represents all audio, not only unusually loud moments. The
  // previous implementation never cached ordinary/quiet live audio, leaving
  // the timeline permanently on "Analyzing audio levels...".
  await mergeWaveformSegment(
    streamSessionId,
    startTimeSeconds,
    endTimeSeconds,
    dbToLevel(mean),
    endTimeSeconds
  );

  if (max > -12 || mean > -18) {
    await prisma.audioEvent.create({
      data: {
        streamSessionId,
        startTimeSeconds,
        endTimeSeconds,
        type: max > -8 ? "volume_spike" : "loud_section",
        score: Math.min(10, (max + 20) / 3),
        summary: `Live audio reaction from ${formatSeconds(startTimeSeconds)} to ${formatSeconds(endTimeSeconds)}.`,
        rawData: toJsonValue({ mean, max, live: true }),
      },
    });
    return { events: 1 };
  }

  return { events: 0 };
}
