import OpenAI from "openai";
import { z } from "zod";
import type { RagSearchResult } from "@/lib/rag";
import { formatSeconds } from "@/lib/time";

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

export const aiResponseSchema = z.object({
  answer: z.string(),
  clipSuggestions: z.array(clipSuggestionSchema).optional(),
});

export type AiResponse = z.infer<typeof aiResponseSchema>;
export type ClipSuggestionInput = z.infer<typeof clipSuggestionSchema>;

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
  streamTitle?: string
): Promise<AiResponse> {
  const client = getOpenAI();
  const context = buildContextBlock(contextResults);

  const systemPrompt = `You help creators clip specific moments from YouTube livestreams.

Stream title: ${streamTitle ?? "Unknown"}

Return JSON:
{
  "answer": "Brief helpful response",
  "clipSuggestions": [{
    "title": "Use REAL chat quotes or transcript words (max 60 chars)",
    "startTimeSeconds": 840,
    "endTimeSeconds": 870,
    "reason": "Quote exact chat messages from context. Explain WHAT happened in plain language.",
    "confidence": 0.85,
    "suggestedLayout": "center_crop"
  }]
}

RULES:
- NEVER use generic titles like "Chat hype" or "Loud moment" — use actual quotes
- reason MUST include quoted chat/transcript from the context provided
- Clips 20-45 seconds, centered on the action
- Include clipSuggestions when user asks for clips/moments/shorts
- suggestedLayout: center_crop unless facecam mentioned`;

  const response = await client.chat.completions.create({
    model: CHAT_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Context from stream analysis:\n${context}\n\nUser question: ${userMessage}`,
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.5,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("No AI response");

  const parsed = JSON.parse(content) as unknown;
  return aiResponseSchema.parse(parsed);
}

export async function generateChatWindowSummary(
  summaryTemplate: string
): Promise<string> {
  // For MVP, the scoring module builds summaries; this can enhance with LLM later
  return summaryTemplate;
}
