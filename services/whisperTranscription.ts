import fs from "fs";
import path from "path";
import { toFile } from "openai";
import type { TranscriptSegment } from "@/services/transcriptService";
import { TRANSCRIPT_MERGE_MAX_SECONDS } from "@/lib/aiCostConstants";
import { distributeTextAcrossSpan } from "@/lib/transcriptTiming";
import {
  getOpenAiDirectClient,
  getOpenAiTranscriptionQualityModel,
  getOpenAiWhisperModel,
  getOpenRouterApiKey,
  getOpenRouterWhisperModel,
  getWhisperProviderOrder,
  getTranscriptionLanguage,
  hasAnyAiKey,
  type WhisperProvider,
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
  segments?: Array<{ start: number; end: number; text: string }>;
  words?: WhisperWord[];
}

export interface WhisperTranscriptionOptions {
  /** Recent transcript/title context helps preserve names and technical terms. */
  prompt?: string;
  /** ISO-639-1 language. Supplying it improves accuracy and latency. */
  language?: string;
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

async function transcribeWithProvider(
  provider: WhisperProvider,
  audioPath: string,
  options: WhisperTranscriptionOptions
): Promise<WhisperVerboseResponse> {
  return provider === "openrouter"
    ? transcribeViaOpenRouter(audioPath, options)
    : transcribeViaOpenAiDirect(audioPath, options);
}

async function transcribeViaOpenRouter(
  audioPath: string,
  options: WhisperTranscriptionOptions
): Promise<WhisperVerboseResponse> {
  const audioBuffer = await fs.promises.readFile(audioPath);
  const apiKey = getOpenRouterApiKey();
  const language = options.language ?? getTranscriptionLanguage();
  const model = getOpenRouterWhisperModel();
  const baseBody = {
    model,
    input_audio: {
      data: audioBuffer.toString("base64"),
      format: audioFormatFromPath(audioPath),
    },
    temperature: 0,
    ...(language ? { language } : {}),
    ...(options.prompt?.trim()
      ? { prompt: options.prompt.trim().slice(-800) }
      : {}),
  };

  // Prefer word/segment clocks so captions stay locked to the WAV. Fall back to
  // plain text if this model/provider rejects verbose_json.
  const timed = await fetch(OPENROUTER_TRANSCRIBE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer":
        process.env.OPENROUTER_SITE_URL?.trim() || "http://localhost:3000",
      "X-Title": process.env.OPENROUTER_APP_NAME?.trim() || "Stream Clipper",
    },
    body: JSON.stringify({
      ...baseBody,
      response_format: "verbose_json",
      timestamp_granularities: ["word", "segment"],
    }),
  });

  if (timed.ok) {
    const data = (await timed.json()) as OpenRouterSttResponse;
    return {
      text: data.text,
      segments: data.segments,
      words: data.words,
    };
  }

  const timedBody = await timed.text();
  const verboseUnsupported =
    timed.status === 400 &&
    /verbose_json|timestamp_granularit|response_format/i.test(timedBody);

  if (!verboseUnsupported) {
    throw new Error(
      `OpenRouter transcription failed (${timed.status}): ${timedBody.slice(0, 500)}`
    );
  }

  console.warn(
    `[whisper] ${model} rejected verbose timestamps; falling back to text-only`
  );

  const plain = await fetch(OPENROUTER_TRANSCRIBE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer":
        process.env.OPENROUTER_SITE_URL?.trim() || "http://localhost:3000",
      "X-Title": process.env.OPENROUTER_APP_NAME?.trim() || "Stream Clipper",
    },
    body: JSON.stringify(baseBody),
  });

  if (!plain.ok) {
    const body = await plain.text();
    throw new Error(
      `OpenRouter transcription failed (${plain.status}): ${body.slice(0, 500)}`
    );
  }

  const data = (await plain.json()) as OpenRouterSttResponse;
  return { text: data.text };
}

async function transcribeViaOpenAiDirect(
  audioPath: string,
  options: WhisperTranscriptionOptions
): Promise<WhisperVerboseResponse> {
  const client = getOpenAiDirectClient();
  const audioBuffer = await fs.promises.readFile(audioPath);
  const language = options.language ?? getTranscriptionLanguage();
  const prompt = options.prompt?.trim().slice(-800) || undefined;

  const timingFile = await toFile(audioBuffer, path.basename(audioPath), {
    type: "audio/wav",
  });
  const timing = (await client.audio.transcriptions.create({
    file: timingFile,
    model: getOpenAiWhisperModel(),
    response_format: "verbose_json",
    timestamp_granularities: ["word", "segment"],
    temperature: 0,
    ...(language ? { language } : {}),
    ...(prompt ? { prompt } : {}),
  })) as WhisperVerboseResponse;

  // GPT-4o Transcribe can improve text accuracy. Run only after the timing pass
  // succeeds so a failed timing request does not leave a stray quality rejection.
  const qualityModel = getOpenAiTranscriptionQualityModel();
  if (!qualityModel) return timing;

  try {
    const qualityFile = await toFile(audioBuffer, path.basename(audioPath), {
      type: "audio/wav",
    });
    const quality = (await client.audio.transcriptions.create({
      file: qualityFile,
      model: qualityModel,
      response_format: "json",
      temperature: 0,
      ...(language ? { language } : {}),
      ...(prompt ? { prompt } : {}),
    })) as { text?: string };
    return reconcileAccurateTextWithTimings(timing, quality.text);
  } catch (error) {
    console.warn(
      "[whisper] quality text pass failed; using timestamped Whisper output:",
      error
    );
    return timing;
  }
}

function normalizeAlignmentToken(token: string): string {
  return token
    .toLocaleLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[^\p{L}\p{N}']/gu, "");
}

function tokenSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  if (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a))) {
    return 0.72;
  }
  return 0;
}

/** Map corrected GPT text onto Whisper's timestamped words with sequence alignment. */
function alignCorrectedWords(
  original: WhisperWord[],
  correctedTokens: string[]
): { words: WhisperWord[]; confidence: number } {
  const m = original.length;
  const n = correctedTokens.length;
  if (m === 0 || n === 0) return { words: [], confidence: 0 };

  const source = original.map((w) => normalizeAlignmentToken(w.word));
  const target = correctedTokens.map(normalizeAlignmentToken);
  const gapCost = 0.85;
  const dp = Array.from({ length: m + 1 }, () => new Float64Array(n + 1));
  const op = Array.from({ length: m + 1 }, () => new Uint8Array(n + 1));

  for (let i = 1; i <= m; i++) {
    dp[i]![0] = i * gapCost;
    op[i]![0] = 1; // delete source
  }
  for (let j = 1; j <= n; j++) {
    dp[0]![j] = j * gapCost;
    op[0]![j] = 2; // insert target
  }

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const similarity = tokenSimilarity(source[i - 1]!, target[j - 1]!);
      const diagonal = dp[i - 1]![j - 1]! + (1 - similarity);
      const deletion = dp[i - 1]![j]! + gapCost;
      const insertion = dp[i]![j - 1]! + gapCost;
      if (diagonal <= deletion && diagonal <= insertion) {
        dp[i]![j] = diagonal;
        op[i]![j] = 0;
      } else if (deletion <= insertion) {
        dp[i]![j] = deletion;
        op[i]![j] = 1;
      } else {
        dp[i]![j] = insertion;
        op[i]![j] = 2;
      }
    }
  }

  const targetToSource = new Array<number | null>(n).fill(null);
  let exactOrFuzzy = 0;
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    const operation = op[i]![j]!;
    if (i > 0 && j > 0 && operation === 0) {
      targetToSource[j - 1] = i - 1;
      if (tokenSimilarity(source[i - 1]!, target[j - 1]!) >= 0.7) {
        exactOrFuzzy++;
      }
      i--;
      j--;
    } else if (i > 0 && (j === 0 || operation === 1)) {
      i--;
    } else {
      j--;
    }
  }

  const firstStart = original[0]!.start;
  const lastEnd = original[m - 1]!.end;
  const totalSpan = Math.max(0.01, lastEnd - firstStart);
  const words = correctedTokens.map((word, index) => {
    const mapped = targetToSource[index];
    if (mapped != null) {
      return { ...original[mapped]!, word };
    }

    // Inserted/corrected words inherit an interpolated position. Neighbouring
    // matched words remain exact anchors, so local corrections do not create
    // cumulative drift across the chunk.
    let prev = index - 1;
    while (prev >= 0 && targetToSource[prev] == null) prev--;
    let next = index + 1;
    while (next < n && targetToSource[next] == null) next++;

    const left =
      prev >= 0
        ? original[targetToSource[prev]!]!.end
        : firstStart;
    const right =
      next < n
        ? original[targetToSource[next]!]!.start
        : lastEnd;
    const runStart = prev + 1;
    const runLength = Math.max(1, next - runStart);
    const slot = index - runStart;
    const available = right - left;

    if (available > 0.02) {
      return {
        word,
        start: left + (available * slot) / runLength,
        end: left + (available * (slot + 1)) / runLength,
      };
    }

    const start = firstStart + (totalSpan * index) / n;
    return { word, start, end: firstStart + (totalSpan * (index + 1)) / n };
  });

  return {
    words: words.sort((a, b) => a.start - b.start),
    confidence: exactOrFuzzy / Math.max(m, n),
  };
}

function joinWordTokens(tokens: string[]): string {
  return tokens
    .join(" ")
    .replace(/\s+([,.;:!?%\]\)])/g, "$1")
    .replace(/([\[\(])\s+/g, "$1")
    .trim();
}

function reconcileAccurateTextWithTimings(
  timing: WhisperVerboseResponse,
  accurateText: string | undefined
): WhisperVerboseResponse {
  const text = accurateText?.trim();
  const originalWords = timing.words ?? [];
  if (!text || originalWords.length === 0) return timing;

  const correctedTokens = text.split(/\s+/).filter(Boolean);
  const countRatio = correctedTokens.length / originalWords.length;
  if (countRatio < 0.65 || countRatio > 1.5) return timing;

  const aligned = alignCorrectedWords(originalWords, correctedTokens);
  if (aligned.confidence < 0.42) return timing;

  const sourceSegments = timing.segments ?? [];
  const segments = sourceSegments.flatMap((segment) => {
    const words = aligned.words.filter((word) => {
      const midpoint = (word.start + word.end) / 2;
      return midpoint >= segment.start && midpoint < segment.end;
    });
    if (words.length === 0) return [];
    return [
      {
        start: words[0]!.start,
        end: words[words.length - 1]!.end,
        text: joinWordTokens(words.map((word) => word.word)),
      },
    ];
  });

  return {
    text,
    words: aligned.words,
    segments: segments.length > 0 ? segments : timing.segments,
  };
}

/** Transcribe a local audio file; segment times are offset by `timeOffsetSeconds`. */
export async function transcribeWhisperAudio(
  audioPath: string,
  timeOffsetSeconds: number,
  options: WhisperTranscriptionOptions = {}
): Promise<TranscriptSegmentWithMeta[]> {
  const providers = getWhisperProviderOrder();
  if (providers.length === 0) {
    throw new Error("Set OPENROUTER_API_KEY or OPENAI_API_KEY for Whisper");
  }

  let response: WhisperVerboseResponse | null = null;
  let lastError: unknown;

  providerLoop: for (let p = 0; p < providers.length; p++) {
    const provider = providers[p]!;
    for (let attempt = 1; attempt <= WHISPER_RETRIES; attempt++) {
      try {
        response = await transcribeWithProvider(provider, audioPath, options);
        break providerLoop;
      } catch (err) {
        lastError = err;
        const message = err instanceof Error ? err.message : String(err);
        const transient = isProviderUnavailableError(err);
        const hasFallback = p < providers.length - 1;

        if (transient && hasFallback && provider === "openai") {
          console.warn(
            `[whisper] ${provider} unavailable, trying ${providers[p + 1]}:`,
            message
          );
          break;
        }

        if (transient && attempt < WHISPER_RETRIES) {
          console.warn(
            `[whisper] ${provider} transient error (attempt ${attempt}/${WHISPER_RETRIES}), retrying:`,
            message
          );
          await new Promise((r) => setTimeout(r, 2000 * attempt));
          continue;
        }

        if (hasFallback) {
          console.warn(
            `[whisper] ${provider} failed, trying ${providers[p + 1]}:`,
            message
          );
        }
        break;
      }
    }
  }

  if (!response) {
    throw lastError instanceof Error
      ? lastError
      : new Error("Whisper transcription failed");
  }

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
    const silenceGap = seg.startTimeSeconds - current.endTimeSeconds;
    if (span <= maxSpanSeconds && silenceGap <= 0.75) {
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
  return getWhisperProviderOrder().length > 0;
}

export function isAiConfigured(): boolean {
  return hasAnyAiKey();
}
