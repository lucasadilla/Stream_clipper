import OpenAI from "openai";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

export function isOpenRouterEnabled(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim());
}

export function hasAnyAiKey(): boolean {
  return isOpenRouterEnabled() || Boolean(process.env.OPENAI_API_KEY?.trim());
}

/** Chat model slug (OpenRouter) or OpenAI model id. */
export function getChatModel(): string {
  if (isOpenRouterEnabled()) {
    return (
      process.env.OPENROUTER_CHAT_MODEL?.trim() ||
      "google/gemini-2.5-flash-lite"
    );
  }
  return process.env.OPENAI_CHAT_MODEL?.trim() || "gpt-4o-mini";
}

export function getEmbeddingModel(): string {
  if (isOpenRouterEnabled()) {
    return (
      process.env.OPENROUTER_EMBEDDING_MODEL?.trim() ||
      "openai/text-embedding-3-small"
    );
  }
  return "text-embedding-3-small";
}

export function getOpenAiWhisperModel(): string {
  return process.env.OPENAI_WHISPER_MODEL?.trim() || "whisper-1";
}

export function getOpenRouterWhisperModel(): string {
  return (
    process.env.OPENROUTER_WHISPER_MODEL?.trim() || "openai/whisper-large-v3-turbo"
  );
}

/** Use OpenRouter for STT when key is set unless WHISPER_PROVIDER=openai. */
export function useOpenRouterForWhisper(): boolean {
  const pref = process.env.WHISPER_PROVIDER?.trim().toLowerCase();
  if (pref === "openai") return false;
  if (pref === "openrouter") return isOpenRouterEnabled();
  return isOpenRouterEnabled();
}

let sharedClient: OpenAI | null = null;

/** OpenAI SDK client — OpenRouter base URL when OPENROUTER_API_KEY is set. */
export function getAiClient(): OpenAI {
  if (!sharedClient) {
    if (isOpenRouterEnabled()) {
      sharedClient = new OpenAI({
        baseURL: OPENROUTER_BASE,
        apiKey: process.env.OPENROUTER_API_KEY!,
        defaultHeaders: {
          "HTTP-Referer":
            process.env.OPENROUTER_SITE_URL?.trim() || "http://localhost:3000",
          "X-Title": process.env.OPENROUTER_APP_NAME?.trim() || "Stream Clipper",
        },
      });
    } else {
      const key = process.env.OPENAI_API_KEY?.trim();
      if (!key) {
        throw new Error(
          "Set OPENROUTER_API_KEY or OPENAI_API_KEY in .env"
        );
      }
      sharedClient = new OpenAI({ apiKey: key });
    }
  }
  return sharedClient;
}

let openAiDirect: OpenAI | null = null;

/** Direct OpenAI API (multipart Whisper). Requires OPENAI_API_KEY. */
export function getOpenAiDirectClient(): OpenAI {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error("OPENAI_API_KEY is required for direct Whisper transcription");
  }
  if (!openAiDirect) openAiDirect = new OpenAI({ apiKey: key });
  return openAiDirect;
}

export function getOpenRouterApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) throw new Error("OPENROUTER_API_KEY is not configured");
  return key;
}
