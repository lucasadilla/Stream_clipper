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

/** Higher-accuracy text pass; Whisper remains the timing/alignment pass. */
export function getOpenAiTranscriptionQualityModel(): string | null {
  const configured = process.env.OPENAI_TRANSCRIPTION_QUALITY_MODEL?.trim();
  if (configured && /^(off|none|false|0)$/i.test(configured)) return null;
  return configured || "gpt-4o-transcribe";
}

export function getTranscriptionLanguage(): string | undefined {
  const language = process.env.TRANSCRIPTION_LANGUAGE?.trim();
  if (language && /^(auto|detect)$/i.test(language)) return undefined;
  return language || "en";
}

export function getOpenRouterWhisperModel(): string {
  // Prefer a Whisper model that supports verbose_json word/segment clocks.
  // turbo is faster but some OpenRouter routes only return plain text.
  return (
    process.env.OPENROUTER_WHISPER_MODEL?.trim() || "openai/whisper-large-v3"
  );
}

export type WhisperProvider = "openai" | "openrouter";

/**
 * Prefer direct OpenAI when available because it exposes verbose word-level
 * timestamps. OpenRouter is retained as a resilient text-only fallback.
 */
export function shouldUseOpenRouterForWhisper(): boolean {
  const pref = process.env.WHISPER_PROVIDER?.trim().toLowerCase();
  if (pref === "openai") return false;
  if (pref === "openrouter") return isOpenRouterEnabled();
  return isOpenRouterEnabled() && !process.env.OPENAI_API_KEY?.trim();
}

/**
 * Preferred Whisper backends in order (primary first, then fallbacks).
 * Default: OpenRouter when configured (stable for most dev setups), then direct
 * OpenAI for verbose word timestamps. Set WHISPER_PROVIDER=openai to force direct OpenAI.
 */
export function getWhisperProviderOrder(): WhisperProvider[] {
  const pref = process.env.WHISPER_PROVIDER?.trim().toLowerCase();
  const hasOpenRouter = isOpenRouterEnabled();
  const hasOpenAi = Boolean(process.env.OPENAI_API_KEY?.trim());

  if (pref === "openrouter") {
    return hasOpenRouter ? ["openrouter"] : hasOpenAi ? ["openai"] : [];
  }
  if (pref === "openai") {
    return hasOpenAi ? ["openai"] : hasOpenRouter ? ["openrouter"] : [];
  }

  const order: WhisperProvider[] = [];
  if (hasOpenRouter) order.push("openrouter");
  if (hasOpenAi) order.push("openai");
  return order;
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
          "X-Title": process.env.OPENROUTER_APP_NAME?.trim() || "Clipper",
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
