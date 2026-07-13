import { z } from "zod";
import { getAiClient, getChatModel, hasAnyAiKey } from "@/lib/aiProvider";
import { PLATFORM_PRESETS } from "@/lib/platforms/presets";
import type { PlatformCopy, PlatformKey } from "@/lib/platforms/types";

const platformCopySchema = z.object({
  title: z.string().nullable().optional(),
  caption: z.string().nullable().optional(),
  postText: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  hashtags: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  quoteText: z.string().nullable().optional(),
  thumbnailText: z.string().nullable().optional(),
  pinnedComment: z.string().nullable().optional(),
});

export interface GeneratePlatformCopyInput {
  platform: PlatformKey;
  clipTitle: string;
  clipReason: string;
  transcriptText: string;
  chatSignals?: string;
  streamTitle?: string | null;
  streamerName?: string | null;
  durationSeconds: number;
}

function cleanHashtag(value: string): string {
  const cleaned = value.trim().replace(/^#+/, "").replace(/[^a-zA-Z0-9_]/g, "");
  return cleaned ? `#${cleaned}` : "";
}

function shortQuote(input: GeneratePlatformCopyInput): string {
  const transcript = input.transcriptText.replace(/\s+/g, " ").trim();
  const source = transcript || input.clipReason || input.clipTitle;
  const sentence = source.split(/(?<=[.!?])\s+/)[0] ?? source;
  return sentence.slice(0, 120).trim();
}

function fallbackCopy(input: GeneratePlatformCopyInput): PlatformCopy {
  const preset = PLATFORM_PRESETS[input.platform];
  const titleLimit = preset.titleLimit ?? 100;
  const title = input.clipTitle.slice(0, titleLimit);
  const quote = shortQuote(input);
  const genericTags = ["#livestream", "#highlights", "#creator"];
  const hashtags = genericTags.slice(0, preset.hashtagRange?.max ?? 3);
  const baseCaption = `${quote}${quote && !/[.!?]$/.test(quote) ? "." : ""}`;

  return {
    title,
    caption: input.platform === "x" ? null : baseCaption,
    postText:
      input.platform === "x"
        ? `${quote}${quote ? " " : ""}${hashtags[0] ?? ""}`.trim().slice(0, 280)
        : null,
    description:
      input.platform.startsWith("youtube")
        ? `${input.clipReason}\n\n${hashtags.join(" ")}`.trim()
        : null,
    hashtags,
    tags: ["livestream", "highlights", input.streamerName ?? "creator"].filter(Boolean),
    quoteText: quote || null,
    thumbnailText: title.split(/\s+/).slice(0, 6).join(" ").toUpperCase(),
    pinnedComment: input.platform === "youtube_shorts" ? "What would you have done here?" : null,
  };
}

function parseJson(content: string): unknown {
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "")
    .trim();
  return JSON.parse(cleaned);
}

function normalizeCopy(
  raw: z.infer<typeof platformCopySchema>,
  fallback: PlatformCopy
): PlatformCopy {
  return {
    title: raw.title?.trim() || fallback.title,
    caption: raw.caption?.trim() || fallback.caption,
    postText: raw.postText?.trim() || fallback.postText,
    description: raw.description?.trim() || fallback.description,
    hashtags: (raw.hashtags ?? fallback.hashtags)
      .map(cleanHashtag)
      .filter(Boolean),
    tags: (raw.tags ?? fallback.tags).map((tag) => tag.trim()).filter(Boolean),
    quoteText: raw.quoteText?.trim().slice(0, 180) || fallback.quoteText,
    thumbnailText: raw.thumbnailText?.trim().slice(0, 80) || fallback.thumbnailText,
    pinnedComment: raw.pinnedComment?.trim() || fallback.pinnedComment,
  };
}

export async function generatePlatformCopy(
  input: GeneratePlatformCopyInput
): Promise<PlatformCopy> {
  const fallback = fallbackCopy(input);
  if (!hasAnyAiKey()) return fallback;

  const preset = PLATFORM_PRESETS[input.platform];
  const prompt = `Create publishing copy for ${preset.name}. Sound native to the platform, specific to the clip, and human. Avoid corporate language and fake claims.

Limits:
- title: ${preset.titleLimit ?? 100} characters maximum when used
- caption: ${preset.captionLimit ?? 2200} characters maximum when used
- postText: ${preset.postTextLimit ?? 280} characters maximum when used
- hashtags: ${preset.hashtagRange ? `${preset.hashtagRange.min}-${preset.hashtagRange.max}` : "0-8"}
- quoteText: one punchy quote under 120 characters

Clip title: ${input.clipTitle}
Why it matters: ${input.clipReason}
Stream: ${input.streamTitle ?? "Unknown"}
Creator: ${input.streamerName ?? "Unknown"}
Duration: ${Math.round(input.durationSeconds)} seconds
Transcript: ${input.transcriptText.slice(0, 7000) || "Unavailable"}
Chat signals: ${(input.chatSignals ?? "Unavailable").slice(0, 1200)}

Return only JSON with keys: title, caption, postText, description, hashtags, tags, quoteText, thumbnailText, pinnedComment. Use null when a field is irrelevant.`;

  try {
    const response = await getAiClient().chat.completions.create({
      model: getChatModel(),
      temperature: 0.65,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You are a sharp social video producer. Return valid JSON only.",
        },
        { role: "user", content: prompt },
      ],
    });
    const content = response.choices[0]?.message?.content;
    if (!content) return fallback;
    const parsed = platformCopySchema.parse(parseJson(content));
    return normalizeCopy(parsed, fallback);
  } catch (error) {
    console.warn("[platform-copy] using fallback:", error);
    return fallback;
  }
}
