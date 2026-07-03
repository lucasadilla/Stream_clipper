import fs from "fs";
import path from "path";
import OpenAI, { toFile } from "openai";
import type { TranscriptSegment } from "@/services/transcriptService";
import { TRANSCRIPT_MERGE_MAX_SECONDS } from "@/lib/aiCostConstants";
import { distributeTextAcrossSpan } from "@/lib/transcriptTiming";
import {
  getOpenAiDirectClient,
  getOpenAiWhisperModel,
  getOpenRouterApiKey,
  getOpenRouterWhisperModel,
  hasAnyAiKey,
  useOpenRouterForWhisper,
} from "@/lib/aiProvider";

const OPENROUTER_TRANSCRIBE_URL =
  "https://openrouter.ai/api/v1/audio/transcriptions";

interface WhisperWord {
  start: number;
  end: number;
  word: string;
}

interface WhisperVerboseResponse {
  text?: string;
  segments?: Array<{ start: number; end: number; text: string }>;
  words?: WhisperWord[];
}

export interface TranscriptSegmentWithMeta extends TranscriptSegment {
  estimatedTiming?: boolean;
  words?: Array<{ start: number; end: number; word: string }>;
}

interface OpenRouterSttResponse {
  text?: string;
}

const WHISPER_RETRIES = 3;

export function isProviderUnavailableError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.message} ${String(err.cause ?? "")}` : String(err);
  return /ECONNRESET|ETIMEDOUT|ECONNREFUSED|EPIPE|socket hang up|Connection error|fetch failed|exceeded your current quota|429|402|500|502|503/i.test(
    msg
  );
}

function audioFormatFromPath(audioPath: string): string {
  const ext = path.extname(audioPath).replace(/^\./, "").toLowerCase();
  return ext || "wav";
}

function resolveWhisperProvider(): "openai" | "openrouter" {
  const pref = process.env.WHISPER_PROVIDER?.trim().toLowerCase();
  if (pref === "openrouter" && useOpenRouterForWhisper()) return "openrouter";
  if (pref === "openai" || process.env.OPENAI_API_KEY?.trim()) return "openai";
  if (useOpenRouterForWhisper()) return "openrouter";
  return "openai";
}

async function transcribeViaOpenRouter(
  audioPath: string
): Promise<WhisperVerboseResponse> {
  const audioBuffer = await fs.promises.readFile(audioPath);
  const apiKey = getOpenRouterApiKey();

  const response = await fetch(OPENROUTER_TRANSCRIBE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer":
        process.env.OPENROUTER_SITE_URL?.trim() || "http://localhost:3000",
      "X-Title": process.env.OPENROUTER_APP_NAME?.trim() || "Stream Clipper",
    },
    body: JSON.stringify({
      model: getOpenRouterWhisperModel(),
      input_audio: {
        data: audioBuffer.toString("base64"),
        format: audioFormatFromPath(audioPath),
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `OpenRouter transcription failed (${response.status}): ${body.slice(0, 500)}`
    );
  }

  const data = (await response.json()) as OpenRouterSttResponse;
  return { text: data.text };
}

async function transcribeViaOpenAiDirect(
  audioPath: string
): Promise<WhisperVerboseResponse> {
  const client = getOpenAiDirectClient();
  const audioBuffer = await fs.promises.readFile(audioPath);
  const uploadFile = await toFile(audioBuffer, path.basename(audioPath), {
    type: "audio/wav",
  });

  return (await client.audio.transcriptions.create({
    file: uploadFile,
    model: getOpenAiWhisperModel(),
    response_format: "verbose_json",
    timestamp_granularities: ["word", "segment"],
  })) as WhisperVerboseResponse;
}

/** Transcribe a local audio file; segment times are offset by `timeOffsetSeconds`. */
export async function transcribeWhisperAudio(
  audioPath: string,
  timeOffsetSeconds: number
): Promise<TranscriptSegmentWithMeta[]> {
  const provider = resolveWhisperProvider();

  let response: WhisperVerboseResponse | null = null;
  for (let attempt = 1; attempt <= WHISPER_RETRIES; attempt++) {
    try {
      response =
        provider === "openrouter"
          ? await transcribeViaOpenRouter(audioPath)
          : await transcribeViaOpenAiDirect(audioPath);
      break;
    } catch (err) {
      if (attempt === WHISPER_RETRIES || !isProviderUnavailableError(err)) {
        throw err;
      }
      console.warn(
        `[whisper] transient error (attempt ${attempt}/${WHISPER_RETRIES}), retrying:`,
        err instanceof Error ? err.message : err
      );
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  if (!response) throw new Error("Whisper transcription failed");

  const rawSegments = response.segments ?? [];
  const rawWords = response.words ?? [];

  if (rawSegments.length > 0) {
    const segments = mergeAdjacentSegments(
      rawSegments
        .map((s) => ({
          startTimeSeconds: timeOffsetSeconds + s.start,
          endTimeSeconds: timeOffsetSeconds + s.end,
          text: s.text.trim(),
        }))
        .filter((s) => s.text.length > 0)
    );

    return attachWordsToSegments(segments, rawWords, timeOffsetSeconds);
  }

  const text = response.text?.trim();
  if (!text) return [];

  const { probeMedia } = await import("@/lib/ffmpeg");
  const probe = await probeMedia(audioPath);
  const duration = Math.max(probe.durationSeconds, 1);

  return distributePlaintextAcrossChunk(text, timeOffsetSeconds, duration);
}

function attachWordsToSegments(
  segments: TranscriptSegment[],
  words: WhisperWord[],
  timeOffsetSeconds: number
): TranscriptSegmentWithMeta[] {
  if (words.length === 0) {
    return segments.map((s) => ({ ...s, estimatedTiming: false }));
  }

  const absWords = words.map((w) => ({
    start: timeOffsetSeconds + w.start,
    end: timeOffsetSeconds + w.end,
    word: w.word,
  }));

  return segments.map((seg) => ({
    ...seg,
    estimatedTiming: false,
    words: absWords.filter(
      (w) => w.start >= seg.startTimeSeconds && w.start < seg.endTimeSeconds
    ),
  }));
}

function distributePlaintextAcrossChunk(
  text: string,
  timeOffsetSeconds: number,
  audioDurationSeconds: number
): TranscriptSegmentWithMeta[] {
  return distributeTextAcrossSpan(
    text,
    timeOffsetSeconds,
    timeOffsetSeconds + audioDurationSeconds
  ).map((slice) => ({
    startTimeSeconds: slice.startTimeSeconds,
    endTimeSeconds: slice.endTimeSeconds,
    text: slice.text,
    estimatedTiming: true,
  }));
}

function mergeAdjacentSegments(
  segments: TranscriptSegment[],
  maxSpanSeconds = TRANSCRIPT_MERGE_MAX_SECONDS
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
  if (resolveWhisperProvider() === "openrouter") {
    return Boolean(process.env.OPENROUTER_API_KEY?.trim());
  }
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function isAiConfigured(): boolean {
  return hasAnyAiKey();
}
