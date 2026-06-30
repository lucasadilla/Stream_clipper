import fs from "fs";
import OpenAI from "openai";
import type { TranscriptSegment } from "@/services/transcriptService";

const WHISPER_MODEL = "whisper-1";

let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

interface WhisperVerboseResponse {
  text?: string;
  segments?: Array<{ start: number; end: number; text: string }>;
}

/** Transcribe a local audio file; segment times are offset by `timeOffsetSeconds`. */
export async function transcribeWhisperAudio(
  audioPath: string,
  timeOffsetSeconds: number
): Promise<TranscriptSegment[]> {
  const client = getOpenAI();
  const response = (await client.audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: WHISPER_MODEL,
    response_format: "verbose_json",
    timestamp_granularities: ["segment"],
  })) as WhisperVerboseResponse;

  const rawSegments = response.segments ?? [];
  if (rawSegments.length > 0) {
    return mergeAdjacentSegments(
      rawSegments
        .map((s) => ({
          startTimeSeconds: timeOffsetSeconds + s.start,
          endTimeSeconds: timeOffsetSeconds + s.end,
          text: s.text.trim(),
        }))
        .filter((s) => s.text.length > 0)
    );
  }

  const text = response.text?.trim();
  if (!text) return [];

  const { probeMedia } = await import("@/lib/ffmpeg");
  const probe = await probeMedia(audioPath);
  const duration = Math.max(probe.durationSeconds, 1);

  return [
    {
      startTimeSeconds: timeOffsetSeconds,
      endTimeSeconds: timeOffsetSeconds + duration,
      text,
    },
  ];
}

/** Merge short Whisper segments into ~45s chunks (fewer DB rows + faster embedding). */
function mergeAdjacentSegments(
  segments: TranscriptSegment[],
  maxSpanSeconds = 45
): TranscriptSegment[] {
  if (segments.length === 0) return [];

  const merged: TranscriptSegment[] = [];
  let current = { ...segments[0] };

  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    const span = seg.endTimeSeconds - current.startTimeSeconds;
    if (span <= maxSpanSeconds) {
      current.endTimeSeconds = seg.endTimeSeconds;
      current.text = `${current.text} ${seg.text}`.trim();
    } else {
      merged.push(current);
      current = { ...seg };
    }
  }
  merged.push(current);
  return merged;
}

export function isWhisperAvailable(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}
