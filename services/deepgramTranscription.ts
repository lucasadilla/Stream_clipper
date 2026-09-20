import fs from "fs";
import path from "path";
import {
  isValidCaptionText,
  sanitizeCaptionText,
} from "@/lib/captionStyles";
import type {
  TranscriptSegmentWithMeta,
  TranscriptWord,
  TranscriptionContextPacket,
} from "@/lib/transcriptionTypes";

interface DeepgramWord {
  word?: string;
  punctuated_word?: string;
  start?: number;
  end?: number;
  confidence?: number;
  speaker?: number | string;
}

interface DeepgramUtterance {
  start?: number;
  end?: number;
  transcript?: string;
  confidence?: number;
  words?: DeepgramWord[];
}

interface DeepgramResponse {
  metadata?: {
    model_info?: Record<string, { name?: string }>;
  };
  results?: {
    utterances?: DeepgramUtterance[];
    channels?: Array<{
      alternatives?: Array<{
        transcript?: string;
        confidence?: number;
        words?: DeepgramWord[];
      }>;
    }>;
  };
}

const DEEPGRAM_RETRIES = 3;

export function isDeepgramConfigured(): boolean {
  return Boolean(process.env.DEEPGRAM_API_KEY?.trim());
}

export function getDeepgramModel(): string {
  return process.env.DEEPGRAM_MODEL?.trim() || "nova-3";
}

function contentTypeForAudio(audioPath: string): string {
  switch (path.extname(audioPath).toLowerCase()) {
    case ".mp3":
      return "audio/mpeg";
    case ".m4a":
    case ".mp4":
      return "audio/mp4";
    case ".webm":
      return "audio/webm";
    default:
      return "audio/wav";
  }
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeWord(
  raw: DeepgramWord,
  offset: number
): TranscriptWord | null {
  const word = sanitizeCaptionText(raw.punctuated_word ?? raw.word ?? "");
  if (!isValidCaptionText(word)) return null;
  const start = offset + finiteNumber(raw.start, 0);
  const end = offset + Math.max(finiteNumber(raw.end, raw.start ?? 0), raw.start ?? 0);
  return {
    word,
    start,
    end: Math.max(start + 0.01, end),
    ...(typeof raw.confidence === "number"
      ? { confidence: Math.min(1, Math.max(0, raw.confidence)) }
      : {}),
    ...(raw.speaker != null ? { speaker: String(raw.speaker) } : {}),
  };
}

function averageConfidence(words: TranscriptWord[], fallback?: number): number | undefined {
  const values = words.flatMap((word) =>
    typeof word.confidence === "number" ? [word.confidence] : []
  );
  if (values.length > 0) {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }
  return typeof fallback === "number" ? fallback : undefined;
}

export function parseDeepgramTranscription(
  response: DeepgramResponse,
  timeOffsetSeconds: number,
  model = getDeepgramModel()
): TranscriptSegmentWithMeta[] {
  const utterances = response.results?.utterances ?? [];
  const parsedUtterances = utterances.flatMap((utterance) => {
    const text = sanitizeCaptionText(utterance.transcript ?? "");
    if (!isValidCaptionText(text)) return [];
    const words = (utterance.words ?? []).flatMap((word) => {
      const normalized = normalizeWord(word, timeOffsetSeconds);
      return normalized ? [normalized] : [];
    });
    const start = words[0]?.start ?? timeOffsetSeconds + finiteNumber(utterance.start, 0);
    const end =
      words.at(-1)?.end ??
      timeOffsetSeconds + finiteNumber(utterance.end, finiteNumber(utterance.start, 0));
    return [
      {
        startTimeSeconds: start,
        endTimeSeconds: Math.max(start + 0.01, end),
        text,
        rawText: utterance.transcript ?? text,
        words,
        estimatedTiming: words.length === 0,
        confidence: averageConfidence(words, utterance.confidence),
        provider: "deepgram" as const,
        model,
        timingModel: model,
      },
    ];
  });
  if (parsedUtterances.length > 0) return parsedUtterances;

  const alternative = response.results?.channels?.[0]?.alternatives?.[0];
  const text = sanitizeCaptionText(alternative?.transcript ?? "");
  if (!isValidCaptionText(text)) return [];
  const words = (alternative?.words ?? []).flatMap((word) => {
    const normalized = normalizeWord(word, timeOffsetSeconds);
    return normalized ? [normalized] : [];
  });
  const start = words[0]?.start ?? timeOffsetSeconds;
  const end = words.at(-1)?.end ?? start + 0.01;
  return [
    {
      startTimeSeconds: start,
      endTimeSeconds: Math.max(start + 0.01, end),
      text,
      rawText: alternative?.transcript ?? text,
      words,
      estimatedTiming: words.length === 0,
      confidence: averageConfidence(words, alternative?.confidence),
      provider: "deepgram",
      model,
      timingModel: model,
    },
  ];
}

function buildDeepgramUrl(context: TranscriptionContextPacket): string {
  const url = new URL("https://api.deepgram.com/v1/listen");
  url.searchParams.set("model", getDeepgramModel());
  url.searchParams.set("smart_format", "true");
  url.searchParams.set("punctuate", "true");
  url.searchParams.set("utterances", "true");
  url.searchParams.set("utt_split", "0.8");
  if (!context.language || /^(auto|detect)$/i.test(context.language)) {
    url.searchParams.set("detect_language", "true");
  } else if (context.language) {
    url.searchParams.set("language", context.language);
  }
  if (/^(1|true|yes|on)$/i.test(process.env.DEEPGRAM_DIARIZE?.trim() ?? "")) {
    url.searchParams.set("diarize", "true");
  }
  for (const keyterm of context.keyterms.slice(0, 100)) {
    url.searchParams.append("keyterm", keyterm);
  }
  return url.toString();
}

export async function transcribeDeepgramAudio(
  audioPath: string,
  timeOffsetSeconds: number,
  context: TranscriptionContextPacket
): Promise<TranscriptSegmentWithMeta[]> {
  const apiKey = process.env.DEEPGRAM_API_KEY?.trim();
  if (!apiKey) throw new Error("DEEPGRAM_API_KEY is not configured");

  let lastError: unknown;
  for (let attempt = 1; attempt <= DEEPGRAM_RETRIES; attempt++) {
    try {
      const audio = await fs.promises.readFile(audioPath);
      const response = await fetch(buildDeepgramUrl(context), {
        method: "POST",
        headers: {
          Authorization: `Token ${apiKey}`,
          "Content-Type": contentTypeForAudio(audioPath),
        },
        body: audio,
        signal: AbortSignal.timeout(45_000),
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(
          `Deepgram transcription failed (${response.status}): ${body.slice(0, 500)}`
        );
      }
      return parseDeepgramTranscription(
        (await response.json()) as DeepgramResponse,
        timeOffsetSeconds
      );
    } catch (error) {
      lastError = error;
      if (attempt < DEEPGRAM_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Deepgram transcription failed");
}
