import OpenAI from "openai";
import { z } from "zod";
import type { RagSearchResult } from "@/lib/rag";
import { formatSeconds } from "@/lib/time";
import { isPlaceholderTranscript } from "@/services/transcriptionSyncService";
import { estimateTimestampInChunk } from "@/services/transcriptSearchService";
import { clipMetadataSchema, normalizeHashtag, type ClipMetadata } from "@/lib/clipMetadata";
import { getAiClient, getChatModel } from "@/lib/aiProvider";

export const clipSuggestionSchema = z.object({
  title: z.string(),
  startTimeSeconds: z.number(),
  endTimeSeconds: z.number(),
  reason: z.string(),
  confidence: z.number().min(0).max(1),
  suggestedLayout: z.enum([
    "facecam_top_gameplay_bottom",
    "center_crop",
    "gameplay_full",
    "facecam_overlay",
  ]),
});

export const timestampReferenceSchema = z.object({
  timeSeconds: z.number(),
  label: z.string(),
  quote: z.string().optional(),
});

export const askResponseSchema = z.object({
  found: z.boolean(),
  answer: z.string(),
  timestamps: z.array(timestampReferenceSchema).optional(),
});

export const aiResponseSchema = z.object({
  answer: z.string(),
  clipSuggestions: z.array(clipSuggestionSchema).optional(),
  timestamps: z.array(timestampReferenceSchema).optional(),
  found: z.boolean().optional(),
});

export type AiResponse = z.infer<typeof aiResponseSchema>;
export type AskResponse = z.infer<typeof askResponseSchema>;
export type ClipSuggestionInput = z.infer<typeof clipSuggestionSchema>;
export type TimestampReference = z.infer<typeof timestampReferenceSchema>;

const TRANSCRIPT_SOURCES = new Set<RagSearchResult["sourceType"]>([
  "transcript",
  "chat_window",
]);

export function getTranscriptContext(results: RagSearchResult[]) {
  return results.filter(
    (r) =>
      TRANSCRIPT_SOURCES.has(r.sourceType) &&
      r.startTimeSeconds != null &&
      r.endTimeSeconds != null &&
      !isPlaceholderTranscript(r.text) &&
      r.text !== "[silence]" &&
      r.text !== "[processing error]"
  );
}

export function bestTranscriptSimilarity(results: RagSearchResult[]) {
  const hits = results.filter((r) => TRANSCRIPT_SOURCES.has(r.sourceType));
  if (hits.length === 0) return 0;
  return Math.max(...hits.map((r) => r.similarity ?? 0));
}

function timestampInContext(timeSeconds: number, context: RagSearchResult[]) {
  return context.some(
    (r) =>
      r.startTimeSeconds != null &&
      r.endTimeSeconds != null &&
      timeSeconds >= r.startTimeSeconds - 3 &&
      timeSeconds <= r.endTimeSeconds + 3
  );
}

function quoteMatchesContext(quote: string, context: RagSearchResult[]) {
  const needle = quote.toLowerCase().trim();
  if (needle.length < 4) return true;
  const slice = needle.slice(0, Math.min(needle.length, 40));
  return context.some((r) => r.text.toLowerCase().includes(slice));
}

export function validateAskResponse(
  raw: AskResponse,
  context: RagSearchResult[]
): AskResponse {
  if (!raw.found) {
    return { found: false, answer: raw.answer, timestamps: [] };
  }

  const transcriptCtx = getTranscriptContext(context);
  const timestamps = (raw.timestamps ?? []).filter(
    (ts) =>
      timestampInContext(ts.timeSeconds, transcriptCtx) &&
      (!ts.quote || quoteMatchesContext(ts.quote, transcriptCtx))
  );

  if ((raw.timestamps?.length ?? 0) > 0 && timestamps.length === 0) {
    return {
      found: false,
      answer:
        "I couldn't find that in the transcript. It may not have happened in this stream, or that part hasn't been transcribed yet.",
      timestamps: [],
    };
  }

  return { found: true, answer: raw.answer, timestamps };
}

function sanitizeContextText(text: string): string {
  return text.replace(/"/g, "'").replace(/\r?\n/g, " ").trim();
}

function parseModelJson(content: string): unknown {
  let text = content.trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  if (fenced) text = fenced[1].trim();

  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw new Error("AI returned invalid JSON — try asking again.");
  }
}

const askModelResponseSchema = z.object({
  found: z.boolean(),
  answer: z.string(),
  /** Index into the numbered transcript excerpts (0 = best match). */
  sourceIndex: z.union([z.number().int().min(0), z.null()]).optional(),
  timestamps: z.array(timestampReferenceSchema).optional(),
});

function buildContextBlock(results: RagSearchResult[]): string {
  return results
    .map((r, index) => {
      const time =
        r.startTimeSeconds != null
          ? `[${formatSeconds(r.startTimeSeconds)}${r.endTimeSeconds != null ? ` - ${formatSeconds(r.endTimeSeconds)}` : ""}]`
          : "[metadata]";
      return `[${index}] ${time} (${r.sourceType}, score=${(r.score ?? 0).toFixed(1)}): ${sanitizeContextText(r.text)}`;
    })
    .join("\n");
}

function timestampsFromSourceIndex(
  sourceIndex: number | undefined,
  contextResults: RagSearchResult[],
  userMessage: string
): TimestampReference[] {
  const transcriptCtx = getTranscriptContext(contextResults);
  if (sourceIndex == null || sourceIndex < 0 || sourceIndex >= transcriptCtx.length) {
    return [];
  }

  const hit = transcriptCtx[sourceIndex]!;
  const start = hit.startTimeSeconds ?? 0;
  const end = hit.endTimeSeconds ?? start;
  const timeSeconds = estimateTimestampInChunk(hit.text, start, end, userMessage);
  const quote = hit.text.trim().slice(0, 120);

  return [
    {
      timeSeconds,
      label: "Transcript match",
      quote,
    },
  ];
}

function normalizeAskModelResponse(
  raw: z.infer<typeof askModelResponseSchema>,
  contextResults: RagSearchResult[],
  userMessage: string
): AskResponse {
  if (!raw.found) {
    return { found: false, answer: raw.answer, timestamps: [] };
  }

  if (raw.timestamps && raw.timestamps.length > 0) {
    return {
      found: true,
      answer: raw.answer,
      timestamps: raw.timestamps,
    };
  }

  const timestamps = timestampsFromSourceIndex(
    raw.sourceIndex ?? undefined,
    contextResults,
    userMessage
  );

  return {
    found: true,
    answer: raw.answer,
    timestamps: timestamps.length > 0 ? timestamps : undefined,
  };
}

export function buildKeywordAnswer(
  query: string,
  hits: RagSearchResult[]
): AskResponse {
  if (hits.length === 0) {
    return {
      found: false,
      answer:
        "I couldn't find that in the transcript so far. Try different wording or wait for more audio to be transcribed.",
      timestamps: [],
    };
  }

  const best = hits[0]!;
  const start = best.startTimeSeconds ?? 0;
  const end = best.endTimeSeconds ?? start;
  const timeSeconds = estimateTimestampInChunk(best.text, start, end, query);
  const excerpt = best.text.trim();
  const short =
    excerpt.length > 220 ? `${excerpt.slice(0, 217).trim()}…` : excerpt;

  return {
    found: true,
    answer: `Around ${formatSeconds(timeSeconds)}: "${short}"`,
    timestamps: [
      {
        timeSeconds,
        label: "Transcript match",
        quote: excerpt.slice(0, 120),
      },
    ],
  };
}

export async function findClipAI(
  userMessage: string,
  contextResults: RagSearchResult[],
  streamTitle?: string
): Promise<AiResponse> {
  const client = getAiClient();
  const transcriptCtx = getTranscriptContext(contextResults);
  const context = buildContextBlock(
    transcriptCtx.length > 0 ? transcriptCtx : contextResults
  );

  const systemPrompt = `You find ONE specific clip moment from a livestream using ONLY the numbered context excerpts.

Stream: ${streamTitle ?? "Unknown"}

Return valid JSON only (no markdown). Prefer apostrophes over double quotes inside strings.

When you CAN match the user's request to an excerpt:
{
  "found": true,
  "answer": "1 sentence confirming what you found",
  "clipSuggestions": [{
    "title": "Short catchy title (max 60 chars) using words from the excerpt",
    "startTimeSeconds": 840,
    "endTimeSeconds": 875,
    "reason": "2-3 sentences explaining why this matches. Quote transcript/chat text from context.",
    "confidence": 0.85,
    "suggestedLayout": "center_crop"
  }]
}

When you CANNOT match (nothing relevant in the excerpts):
{
  "found": false,
  "answer": "Brief reason — e.g. that moment is not in the available transcript yet, or no excerpt matches.",
  "clipSuggestions": []
}

STRICT RULES:
- Timestamps MUST come from the provided excerpts (use the bracketed times)
- Clip length 20-45 seconds, tight around the moment
- Prefer transcript/chat_window excerpts over metadata
- Do NOT invent dialogue that is not in the excerpts
- Chat quotes are nice-to-have, not required — transcript-only matches are fine
- If multiple excerpts fit, pick the strongest match to the user's wording`;

  const response = await client.chat.completions.create({
    model: getChatModel(),
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Stream context:\n${context}\n\nUser wants a clip of: ${userMessage}`,
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.3,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("No AI response");

  const parsed = parseModelJson(content);
  return aiResponseSchema.parse(parsed);
}

/** Ground AI clip timestamps in retrieved excerpts; soft-fail if ungrounded. */
export function validateFindClipResponse(
  raw: AiResponse,
  context: RagSearchResult[]
): { found: false; answer: string } | { found: true; answer: string; clip: ClipSuggestionInput } {
  if (raw.found === false || !raw.clipSuggestions?.[0]) {
    return {
      found: false,
      answer:
        raw.answer?.trim() ||
        "I couldn't find that moment in the transcript available so far. Try different wording, or wait for more audio to be transcribed.",
    };
  }

  const clip = raw.clipSuggestions[0];
  const transcriptCtx = getTranscriptContext(context);
  const mid = (clip.startTimeSeconds + clip.endTimeSeconds) / 2;

  const grounded =
    transcriptCtx.length === 0 ||
    timestampInContext(mid, transcriptCtx) ||
    timestampInContext(clip.startTimeSeconds, transcriptCtx);

  if (!grounded) {
    return {
      found: false,
      answer:
        "I couldn't confidently match that description to a timestamp in the transcript. Try more specific words from what was said.",
    };
  }

  const duration = clip.endTimeSeconds - clip.startTimeSeconds;
  const normalized = {
    ...clip,
    startTimeSeconds: Math.max(0, clip.startTimeSeconds),
    endTimeSeconds:
      duration < 15
        ? clip.startTimeSeconds + 25
        : duration > 60
          ? clip.startTimeSeconds + 45
          : clip.endTimeSeconds,
    suggestedLayout: clip.suggestedLayout ?? "center_crop",
  };

  return {
    found: true,
    answer: raw.answer,
    clip: normalized,
  };
}

export async function askStreamAI(
  userMessage: string,
  contextResults: RagSearchResult[],
  streamTitle?: string,
  history: Array<{ role: "user" | "assistant"; content: string }> = []
): Promise<AskResponse> {
  const client = getAiClient();
  const transcriptCtx = getTranscriptContext(contextResults);
  const context = buildContextBlock(transcriptCtx);

  const systemPrompt = `You answer questions about a YouTube livestream using ONLY the numbered transcript excerpts provided.

Stream title: ${streamTitle ?? "Unknown"}

Return valid JSON only (no markdown). Do NOT put double-quote characters inside string values — use apostrophes instead.

When the answer IS in the excerpts:
{
  "found": true,
  "answer": "Short conversational reply in 1-3 sentences",
  "sourceIndex": 0
}

When the answer is NOT in the excerpts:
{
  "found": false,
  "answer": "I couldn't find that in the transcript so far. Try different wording or wait for more audio.",
  "sourceIndex": null
}

RULES:
- sourceIndex is the [N] index of the excerpt that best answers the question (0 = first / most relevant)
- found MUST be false if the topic is not clearly in the excerpts
- NEVER guess or fabricate — if unsure, set found: false
- For when/where questions, pick the excerpt where the topic is actually discussed
- Keep answer brief; do not paste long transcript quotes into answer
- Omit timestamps — the server adds them from sourceIndex`;

  const chatMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...history.slice(-8).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    {
      role: "user",
      content: `Transcript excerpts:\n${context || "(empty — no transcript yet)"}\n\nQuestion: ${userMessage}`,
    },
  ];

  const request = () =>
    client.chat.completions.create({
      model: getChatModel(),
      messages: chatMessages,
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 512,
    });

  let content: string | null | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await request();
    content = response.choices[0]?.message?.content;
    if (!content) continue;

    try {
      const parsed = parseModelJson(content);
      const model = askModelResponseSchema.parse(parsed);
      return normalizeAskModelResponse(model, contextResults, userMessage);
    } catch (err) {
      if (attempt === 1) {
        if (err instanceof z.ZodError) {
          throw new Error("AI response was missing required fields — try again.");
        }
        throw err;
      }
      console.warn("[ask] invalid JSON from model, retrying:", content.slice(0, 200));
    }
  }

  throw new Error("No AI response");
}

export async function generateChatWindowSummary(
  summaryTemplate: string
): Promise<string> {
  // For MVP, the scoring module builds summaries; this can enhance with LLM later
  return summaryTemplate;
}

export async function generateClipMetadataAI(params: {
  streamTitle?: string;
  channelTitle?: string;
  transcript: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
}): Promise<ClipMetadata> {
  const client = getAiClient();
  const duration = Math.max(0, params.endTimeSeconds - params.startTimeSeconds);

  const systemPrompt = `You write YouTube Shorts upload copy from a stream clip transcript.

Return valid JSON only (no markdown). Do NOT use double-quote characters inside string values — use apostrophes instead.

{
  "title": "Catchy Short title (max 70 chars, hooks curiosity, no ALL CAPS spam)",
  "description": "One compelling sentence for the description (max 200 chars)",
  "hashtags": ["shorts", "gaming", "streamername"]
}

RULES:
- Base copy ONLY on the transcript — do not invent events
- Title should feel native to YouTube Shorts (punchy, specific moment)
- Description is ONE line — what happens + light CTA optional
- hashtags: 5-8 items, lowercase, no # prefix, no spaces, mix broad (#shorts) + topic-specific
- Prefer words/phrases that actually appear in the transcript when possible
- If transcript is thin, keep title generic but honest`;

  const response = await client.chat.completions.create({
    model: getChatModel(),
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          `Stream: ${params.streamTitle ?? "Live stream"}`,
          params.channelTitle ? `Channel: ${params.channelTitle}` : null,
          `Clip: ${formatSeconds(params.startTimeSeconds)} – ${formatSeconds(params.endTimeSeconds)} (${Math.round(duration)}s)`,
          "",
          "Transcript:",
          params.transcript.slice(0, 6000),
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.6,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("No AI response");

  const parsed = clipMetadataSchema.parse(parseModelJson(content));
  return {
    ...parsed,
    title: parsed.title.trim().slice(0, 100),
    description: parsed.description.trim().slice(0, 300),
    hashtags: parsed.hashtags.map(normalizeHashtag).filter(Boolean).slice(0, 10),
  };
}
