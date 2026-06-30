import { LIVE_SEGMENT_SECONDS } from "@/lib/timelineConstants";

export interface LiveTimelineSegment {
  id: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  label: string;
  /** True when this block just arrived from the live pipeline */
  isNew?: boolean;
}

interface TranscriptChunk {
  id: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
  rawJson?: unknown;
}

function isWhisperChunk(rawJson: unknown): boolean {
  if (!rawJson || typeof rawJson !== "object") return false;
  return (rawJson as { whisper?: boolean }).whisper === true;
}

function isLiveChunk(rawJson: unknown): boolean {
  if (!rawJson || typeof rawJson !== "object") return false;
  return (rawJson as { live?: boolean }).live === true;
}

/** Build timeline blocks from Whisper transcript chunks, live placeholders, or synthetic blocks. */
export function buildLiveTimelineSegments(
  transcripts: TranscriptChunk[],
  recordedSeconds: number,
  newIds: Set<string> = new Set()
): LiveTimelineSegment[] {
  const whisperChunks = transcripts.filter((t) => isWhisperChunk(t.rawJson));
  if (whisperChunks.length > 0) {
    return whisperChunks.map((t) => ({
      id: t.id,
      startTimeSeconds: t.startTimeSeconds,
      endTimeSeconds: t.endTimeSeconds,
      label: t.text.slice(0, 48) || "Speech",
      isNew: newIds.has(t.id),
    }));
  }

  const liveChunks = transcripts.filter((t) => isLiveChunk(t.rawJson));

  if (liveChunks.length > 0) {
    return liveChunks.map((t) => ({
      id: t.id,
      startTimeSeconds: t.startTimeSeconds,
      endTimeSeconds: t.endTimeSeconds,
      label: t.text.replace(/^\[Live transcript[^\]]*\]\s*/i, "").slice(0, 48) || "Live",
      isNew: newIds.has(t.id),
    }));
  }

  const blockCount = Math.max(0, Math.floor(recordedSeconds / LIVE_SEGMENT_SECONDS));
  const segments: LiveTimelineSegment[] = [];

  for (let i = 0; i < blockCount; i++) {
    const start = i * LIVE_SEGMENT_SECONDS;
    const end = start + LIVE_SEGMENT_SECONDS;
    const id = `synthetic-${start}`;
    segments.push({
      id,
      startTimeSeconds: start,
      endTimeSeconds: end,
      label: `${start}s–${end}s`,
      isNew: newIds.has(id),
    });
  }

  return segments;
}
