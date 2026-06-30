import OpenAI from "openai";
import { z } from "zod";
import type { RagSearchResult } from "@/lib/rag";
import { formatSeconds } from "@/lib/time";
import { isPlaceholderTranscript } from "@/services/transcriptionSyncService";

const CHAT_MODEL = "gpt-4o-mini";

let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

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

function buildContextBlock(results: RagSearchResult[]): string {
  return results
    .map((r) => {
      const time =
        r.startTimeSeconds != null
          ? `[${formatSeconds(r.startTimeSeconds)}${r.endTimeSeconds != null ? ` - ${formatSeconds(r.endTimeSeconds)}` : ""}]`
          : "[metadata]";
      return `${time} (${r.sourceType}, score=${r.score.toFixed(1)}): ${r.text}`;
    })
    .join("\n");
}

export async function findClipAI(
  userMessage: string,
  contextResults: RagSearchResult[],
  streamTitle?: string
): Promise<AiResponse & { clipSuggestions: [ClipSuggestionInput] }> {
  const client = getOpenAI();
  const context = buildContextBlock(contextResults);

  const systemPrompt = `You find ONE specific clip moment from a livestream based on what the user describes.

Stream: ${streamTitle ?? "Unknown"}

Return JSON:
{
  "answer": "1 sentence confirming what you found",
  "clipSuggestions": [{
    "title": "Short catchy title using REAL quotes from chat/transcript (max 60 chars)",
    "startTimeSeconds": 840,
    "endTimeSeconds": 875,
    "reason": "2-3 sentences. MUST quote exact chat messages or transcript from context. Say WHAT happened specifically — never say 'high activity' or 'hype moment' without quoting chat.",
    "confidence": 0.9,
    "suggestedLayout": "center_crop"
  }]
}

STRICT RULES:
- Return exactly 1 clip in clipSuggestions
- title must use actual words from chat/transcript when available (e.g. "Chat: CLIP IT NO WAY")
- reason MUST include quoted chat lines like: Chat yelled "CLIP IT", "OMG NO WAY"
- Clip 20-45 seconds, tight around the moment
- Pick timestamps from context that match the user's description
- If user describes a specific event (goal, fail, joke), find the closest matching timestamp`;

  const response = await client.chat.completions.create({
    model: CHAT_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Stream context:\n${context}\n\nUser wants a clip of: ${userMessage}`,
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.4,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("No AI response");

  const parsed = JSON.parse(content) as unknown;
  const result = aiResponseSchema.parse(parsed);
  if (!result.clipSuggestions?.[0]) {
    throw new Error("Could not find a matching moment — try describing it differently.");
  }
  return { ...result, clipSuggestions: [result.clipSuggestions[0]] };
}

export async function askStreamAI(
  userMessage: string,
  contextResults: RagSearchResult[],
  streamTitle?: string,
  history: Array<{ role: "user" | "assistant"; content: string }> = []
): Promise<AskResponse> {
  const client = getOpenAI();
  const context = buildContextBlock(getTranscriptContext(contextResults));

  const systemPrompt = `You answer questions about a YouTube livestream using ONLY the transcript/chat excerpts provided.

Stream title: ${streamTitle ?? "Unknown"}

Return JSON:
{
  "found": true,
  "answer": "Conversational reply — like a helpful chat assistant",
  "timestamps": [
    {
      "timeSeconds": 872,
      "label": "Short label",
      "quote": "Exact words copied from the provided context"
    }
  ]
}

CRITICAL — when the user asks about something NOT in the context:
{
  "found": false,
  "answer": "I couldn't find that in the transcript so far. [brief suggestion: rephrase, wait for more transcript, or try a different description]",
  "timestamps": []
}

RULES:
- found MUST be false if the event/topic is not clearly supported by the context excerpts
- NEVER guess, infer, or fabricate moments — if unsure, set found: false
- When found is true, timestamps.timeSeconds MUST fall inside a context time range
- quote MUST be copied verbatim from context (short excerpt)
- Only include timestamps when the user wants a time/moment; general questions can omit them
- Keep answers short and conversational (1-3 sentences)
- Do NOT return clipSuggestions`;

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

  const response = await client.chat.completions.create({
    model: CHAT_MODEL,
    messages: chatMessages,
    response_format: { type: "json_object" },
    temperature: 0.1,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("No AI response");

  const parsed = JSON.parse(content) as unknown;
  return askResponseSchema.parse(parsed);
}

export async function generateChatWindowSummary(
  summaryTemplate: string
): Promise<string> {
  // For MVP, the scoring module builds summaries; this can enhance with LLM later
  return summaryTemplate;
}
