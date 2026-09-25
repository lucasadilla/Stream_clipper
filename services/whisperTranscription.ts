import fs from "fs";
import path from "path";
import { toFile } from "openai";
import type {
  TranscriptSegment,
  TranscriptSegmentWithMeta,
  TranscriptWord,
} from "@/lib/transcriptionTypes";
import { TRANSCRIPT_MERGE_MAX_SECONDS } from "@/lib/aiCostConstants";
import { distributeTextAcrossSpan, repairCollapsedWordTimings } from "@/lib/transcriptTiming";
import {
  isValidCaptionText,
  sanitizeCaptionText,
} from "@/lib/captionStyles";
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
  confidence?: number;
}

interface WhisperVerboseResponse {
  text?: string;
  segments?: Array<{ start: number; end: number; text: string }>;
  words?: WhisperWord[];
  rawText?: string;
  provider?: "openai" | "openrouter";
  model?: string;
  timingModel?: string;
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
  /** Exact names and terminology expected in this audio. */
  keyterms?: string[];
  /** Internal provider override used by selected-clip refinement. */
  providerOrder?: WhisperProvider[];
  /** Override the optional text-quality model; null explicitly disables it. */
  qualityModel?: string | null;
  /** Recording context for the correction model, separate from Whisper's prompt. */
  qualityPrompt?: string;
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
      "X-Title": process.env.OPENROUTER_APP_NAME?.trim() || "Clipper",
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
      rawText: data.text,
      provider: "openrouter",
      model,
      timingModel: model,
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
      "X-Title": process.env.OPENROUTER_APP_NAME?.trim() || "Clipper",
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
  return {
    text: data.text,
    rawText: data.text,
    provider: "openrouter",
    model,
    timingModel: model,
  };
}

async function transcribeViaOpenAiDirect(
  audioPath: string,
  options: WhisperTranscriptionOptions
): Promise<WhisperVerboseResponse> {
  const client = getOpenAiDirectClient();
  const audioBuffer = await fs.promises.readFile(audioPath);
  const language = options.language ?? getTranscriptionLanguage();
  const prompt = options.prompt?.trim().slice(-1_500) || undefined;
  const timingModel = getOpenAiWhisperModel();

  const timingFile = await toFile(audioBuffer, path.basename(audioPath), {
    type: "audio/wav",
  });
  const timing = (await client.audio.transcriptions.create({
    file: timingFile,
    model: timingModel,
    response_format: "verbose_json",
    timestamp_granularities: ["word", "segment"],
    temperature: 0,
    ...(language ? { language } : {}),
    ...(prompt ? { prompt } : {}),
  })) as WhisperVerboseResponse;
  timing.rawText = timing.text;
  timing.provider = "openai";
  timing.model = timingModel;
  timing.timingModel = timingModel;

  // GPT-4o Transcribe can improve text accuracy. Run only after the timing pass
  // succeeds so a failed timing request does not leave a stray quality rejection.
  const qualityModel =
    options.qualityModel === undefined
      ? getOpenAiTranscriptionQualityModel()
      : options.qualityModel;
  if (!qualityModel) return timing;

  try {
    const qualityFile = await toFile(audioBuffer, path.basename(audioPath), {
      type: "audio/wav",
    });
    const latestContextModel = /^gpt-transcribe(?:$|-)/i.test(qualityModel);
    const keywords = (options.keyterms ?? [])
      .map((term) => term.replace(/[<>\r\n]/g, " ").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 100);
    const qualityParams = {
      file: qualityFile,
      model: qualityModel,
      response_format: "json",
      temperature: 0,
      ...(language && !latestContextModel ? { language } : {}),
      ...((options.qualityPrompt ?? prompt)?.trim()
        ? { prompt: (options.qualityPrompt ?? prompt)!.trim().slice(-1_500) } : {}),
    };
    const extraContext = latestContextModel
      ? {
          ...(language ? { languages: [language] } : {}),
          ...(keywords.length > 0 ? { keywords } : {}),
        }
      : null;
    const quality = (await client.audio.transcriptions.create(
      qualityParams as Parameters<typeof client.audio.transcriptions.create>[0],
      extraContext
        ? ({
            body: { ...qualityParams, ...extraContext },
          } as Parameters<typeof client.audio.transcriptions.create>[1])
        : undefined
    )) as { text?: string };
    return reconcileAccurateTextWithTimings(timing, quality.text, qualityModel);
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

    // No silence exists between these anchors. Keep the insertion local;
    // distributing it across the whole recording reorders the sentence.
    return { word, start: left, end: left };
  });

  // Share an adjacent anchor's duration with insertions that have no gap.
  // The transcript stays in lexical order and keeps distant anchors intact.
  for (let index = 0; index < n; index++) {
    if (targetToSource[index] != null || words[index]!.end > words[index]!.start) continue;
    const runStart = index;
    while (index + 1 < n && targetToSource[index + 1] == null) index++;
    const previous = runStart > 0 ? runStart - 1 : null;
    const next = index + 1 < n ? index + 1 : null;
    const startIndex = previous ?? runStart;
    const endIndex = previous != null ? index : next ?? index;
    const start = words[startIndex]!.start;
    const end = previous != null ? words[previous]!.end : words[endIndex]!.end;
    const span = Math.max(0.01, end - start);
    const count = endIndex - startIndex + 1;
    for (let slot = 0; slot < count; slot++) {
      words[startIndex + slot] = { ...words[startIndex + slot]!,
        start: start + span * slot / count,
        end: start + span * (slot + 1) / count };
    }
  }

  return {
    words,
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

export function reconcileAccurateTextWithTimings(
  timing: WhisperVerboseResponse,
  accurateText: string | undefined,
  qualityModel: string
): WhisperVerboseResponse {
  const text = accurateText?.trim();
  const originalWords = repairCollapsedWordTimings(timing.words ?? []);
  if (!text || originalWords.length === 0) return timing;

  const correctedTokens = text.split(/\s+/).filter(Boolean);
  const countRatio = correctedTokens.length / originalWords.length;
  if (countRatio < 0.65 || countRatio > 1.5) return timing;

  const aligned = alignCorrectedWords(originalWords, correctedTokens);
  if (aligned.confidence < 0.42) return timing;

  // Corrected speech can land in gaps Whisper omitted. Rebuild the segment
  // windows from ALL corrected words instead of filtering through old spans.
  const segments = segmentsFromTimedWords(aligned.words);

  return {
    text,
    words: aligned.words,
    segments: segments.length > 0 ? segments : timing.segments,
    rawText: timing.text,
    provider: "openai",
    model: qualityModel,
    timingModel: timing.timingModel ?? getOpenAiWhisperModel(),
  };
}

export function segmentsFromTimedWords(words: WhisperWord[]) {
  const groups: WhisperWord[][] = [];
  for (const word of words) {
    const group = groups[groups.length - 1];
    if (!group || word.start - group[group.length - 1]!.end > 0.8 ||
      word.end - group[0]!.start > 8) {
      groups.push([word]);
    } else {
      group.push(word);
    }
  }
  return groups.map((group) => ({
    start: group[0]!.start,
    end: Math.max(...group.map((word) => word.end)),
    text: joinWordTokens(group.map((word) => word.word)),
  }));
}

/** Transcribe a local audio file; segment times are offset by `timeOffsetSeconds`. */
export async function transcribeWhisperAudio(
  audioPath: string,
  timeOffsetSeconds: number,
  options: WhisperTranscriptionOptions = {}
): Promise<TranscriptSegmentWithMeta[]> {
  const providers = options.providerOrder ?? getWhisperProviderOrder();
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
  const rawWords = repairCollapsedWordTimings(response.words ?? []);

  if (rawSegments.length > 0) {
    const segments = mergeAdjacentSegments(
      rawSegments
        .map((s) => ({
          startTimeSeconds: timeOffsetSeconds + s.start,
          endTimeSeconds: timeOffsetSeconds + s.end,
          text: sanitizeCaptionText(s.text),
        }))
        .filter((s) => isValidCaptionText(s.text))
    );

    return attachWordsToSegments(
      segments,
      rawWords.filter((word) => isValidCaptionText(word.word)),
      timeOffsetSeconds,
      response
    );
  }

  const text = sanitizeCaptionText(response.text ?? "");
  if (!isValidCaptionText(text)) return [];

  const { probeMedia } = await import("@/lib/ffmpeg");
  const probe = await probeMedia(audioPath);
  const duration = Math.max(probe.durationSeconds, 1);

  return distributePlaintextAcrossChunk(
    text,
    timeOffsetSeconds,
    duration,
    response
  );
}

function attachWordsToSegments(
  segments: TranscriptSegment[],
  words: WhisperWord[],
  timeOffsetSeconds: number,
  response: WhisperVerboseResponse
): TranscriptSegmentWithMeta[] {
  if (words.length === 0) {
    return segments.map((s) => ({
      ...s,
      estimatedTiming: false,
      rawText: response.rawText,
      provider: response.provider,
      model: response.model,
      timingModel: response.timingModel,
    }));
  }

  const absWords: TranscriptWord[] = words.map((w) => ({
    start: timeOffsetSeconds + w.start,
    end: timeOffsetSeconds + w.end,
    word: w.word,
    ...(typeof w.confidence === "number" ? { confidence: w.confidence } : {}),
  }));

  return segments.map((seg) => ({
    ...seg,
    estimatedTiming: false,
    rawText: response.rawText,
    provider: response.provider,
    model: response.model,
    timingModel: response.timingModel,
    words: absWords.filter(
      (w) => w.start >= seg.startTimeSeconds && w.start < seg.endTimeSeconds
    ),
  }));
}

function distributePlaintextAcrossChunk(
  text: string,
  timeOffsetSeconds: number,
  audioDurationSeconds: number,
  response: WhisperVerboseResponse
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
    rawText: response.rawText,
    provider: response.provider,
    model: response.model,
    timingModel: response.timingModel,
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
