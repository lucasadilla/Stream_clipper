import { sanitizeDurationSeconds } from "@/lib/timelineBounds";

/** Minimum score to show an audio spike on the timeline. */
export const AUDIO_SPIKE_MIN_SCORE = 3;

export type AudioSpikeType = "volume_spike" | "loud_section";
export type AudioSpikeIntensity = "low" | "medium" | "high";

export interface AudioEventInput {
  id?: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  type: string;
  score: number;
  summary?: string | null;
  rawData?: unknown;
}

export interface WaveformBucket {
  startTimeSeconds: number;
  endTimeSeconds: number;
  /** Normalized loudness 0–1 */
  level: number;
}

export interface AudioSpikeMarker {
  id: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  type: AudioSpikeType;
  score: number;
  summary: string;
  intensity: AudioSpikeIntensity;
}

export function dbToLevel(db: number): number {
  return Math.max(0, Math.min(1, (db + 60) / 50));
}

export function audioSpikeIntensity(
  score: number,
  type: AudioSpikeType
): AudioSpikeIntensity {
  if (type === "volume_spike" || score >= 8) return "high";
  if (score >= 5) return "medium";
  return "low";
}

export function downsampleVolumeSamples(
  samples: Array<{ timeSeconds: number; volumeDb: number }>,
  maxTimeSeconds: number,
  bucketCount = 320
): WaveformBucket[] {
  const maxTime = sanitizeDurationSeconds(maxTimeSeconds);
  const buckets = Math.min(2000, Math.max(1, Math.floor(bucketCount)));
  if (maxTime <= 0 || buckets <= 0) return [];

  const levels = new Array<number>(buckets).fill(0);
  for (const sample of samples) {
    if (sample.timeSeconds < 0 || sample.timeSeconds > maxTime) continue;
    const idx = Math.min(
      buckets - 1,
      Math.floor((sample.timeSeconds / maxTime) * buckets)
    );
    levels[idx] = Math.max(levels[idx], dbToLevel(sample.volumeDb));
  }

  return levels.map((level, i) => ({
    startTimeSeconds: (i / buckets) * maxTime,
    endTimeSeconds: ((i + 1) / buckets) * maxTime,
    level,
  }));
}

export function buildWaveformFromAudioEvents(
  events: AudioEventInput[],
  maxTimeSeconds: number,
  bucketCount = 320
): WaveformBucket[] {
  const maxTime = sanitizeDurationSeconds(maxTimeSeconds);
  if (maxTime <= 0) return [];

  const bucketTotal = Math.min(2000, Math.max(1, Math.floor(bucketCount)));
  const waveform = downsampleVolumeSamples([], maxTime, bucketTotal);

  for (const event of events) {
    if (event.type === "silence") continue;

    const raw = event.rawData as {
      samples?: Array<{ timeSeconds: number; volumeDb: number }>;
      max?: number;
      mean?: number;
    } | null;

    if (raw?.samples?.length) {
      for (const sample of raw.samples) {
        const idx = Math.min(
          bucketTotal - 1,
          Math.floor((sample.timeSeconds / maxTime) * bucketTotal)
        );
        waveform[idx].level = Math.max(
          waveform[idx].level,
          dbToLevel(sample.volumeDb)
        );
      }
      continue;
    }

    const peakDb = raw?.max ?? raw?.mean;
    const level =
      peakDb !== undefined
        ? dbToLevel(peakDb)
        : Math.min(1, event.score / 10);

    const startIdx = Math.min(
      bucketTotal - 1,
      Math.floor((event.startTimeSeconds / maxTime) * bucketTotal)
    );
    const endIdx = Math.min(
      bucketTotal,
      Math.ceil((event.endTimeSeconds / maxTime) * bucketTotal)
    );
    for (let i = startIdx; i < endIdx; i++) {
      waveform[i].level = Math.max(waveform[i].level, level);
    }
  }

  return waveform;
}

export function buildAudioSpikeMarkers(
  events: AudioEventInput[],
  minScore = AUDIO_SPIKE_MIN_SCORE
): AudioSpikeMarker[] {
  return events
    .filter(
      (e) =>
        (e.type === "volume_spike" || e.type === "loud_section") &&
        e.score >= minScore
    )
    .map((e) => ({
      id: e.id ?? `${e.startTimeSeconds}-${e.type}`,
      startTimeSeconds: e.startTimeSeconds,
      endTimeSeconds: e.endTimeSeconds,
      type: e.type as AudioSpikeType,
      score: e.score,
      summary: e.summary ?? "",
      intensity: audioSpikeIntensity(e.score, e.type as AudioSpikeType),
    }))
    .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
}

export function selectAudioSpikesForTimeline(
  markers: AudioSpikeMarker[],
  maxCount = 100
): AudioSpikeMarker[] {
  if (markers.length <= maxCount) return markers;
  return [...markers]
    .sort((a, b) => b.score - a.score)
    .slice(0, maxCount)
    .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
}

export function formatAudioSpikeTooltip(marker: AudioSpikeMarker): string {
  const label =
    marker.type === "volume_spike" ? "Volume spike" : "Loud section";
  return [label, `Score ${marker.score.toFixed(1)}`, marker.summary]
    .filter(Boolean)
    .join("\n");
}

export function waveformHasSignal(buckets: WaveformBucket[]): boolean {
  return buckets.some((b) => b.level > 0.04);
}
