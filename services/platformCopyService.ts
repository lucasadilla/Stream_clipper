import { z } from "zod";
import { getAiClient, getChatModel, hasAnyAiKey } from "@/lib/aiProvider";
import { prisma } from "@/lib/db";
import {
  buildFallbackPlatformCopy,
  stripInternalClipCopy,
} from "@/lib/platformCopyDefaults";
import { PLATFORM_PRESETS } from "@/lib/platforms/presets";
import type { PlatformCopy, PlatformKey } from "@/lib/platforms/types";
import { getTranscriptChunksForRange } from "@/services/transcriptService";

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

function fallbackCopy(input: GeneratePlatformCopyInput): PlatformCopy {
  return buildFallbackPlatformCopy(input);
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
  fallback: PlatformCopy,
  platform: PlatformKey
): PlatformCopy {
  const preset = PLATFORM_PRESETS[platform];
  const cleanText = (value: string | null | undefined, fallbackValue: string | null) => {
    const cleaned = value ? stripInternalClipCopy(value) : "";
    return cleaned || fallbackValue;
  };
  const hashtags = [...new Set([...(raw.hashtags ?? []), ...fallback.hashtags]
    .map(cleanHashtag)
    .filter(Boolean))]
    .slice(0, preset.hashtagRange?.hardMax ?? preset.hashtagRange?.max ?? 8);
  const isYouTube = platform.startsWith("youtube");
  const isX = platform === "x";
  return {
    title: cleanText(raw.title, fallback.title)?.slice(0, preset.titleLimit ?? 100) ?? null,
    caption: isX || isYouTube
      ? null
      : cleanText(raw.caption, fallback.caption)?.slice(0, preset.captionLimit ?? 2200) ?? null,
    postText: isX
      ? cleanText(raw.postText, fallback.postText)?.slice(0, preset.postTextLimit ?? 280) ?? null
      : null,
    description: isYouTube
      ? cleanText(raw.description, fallback.description)?.slice(0, 5000) ?? null
      : null,
    hashtags: hashtags.length > 0 ? hashtags : fallback.hashtags,
    tags: isYouTube
      ? [...new Set([...(raw.tags ?? []), ...fallback.tags].map((tag) => tag.trim()).filter(Boolean))].slice(0, 15)
      : [],
    quoteText: cleanText(raw.quoteText, fallback.quoteText)?.slice(0, 180) ?? null,
    thumbnailText: isYouTube
      ? cleanText(raw.thumbnailText, fallback.thumbnailText)?.slice(0, 80) ?? null
      : null,
    pinnedComment: isYouTube
      ? cleanText(raw.pinnedComment, fallback.pinnedComment)?.slice(0, 500) ?? null
      : null,
  };
}

export async function generatePlatformCopy(
  input: GeneratePlatformCopyInput
): Promise<PlatformCopy> {
  const fallback = fallbackCopy(input);
  if (!hasAnyAiKey()) return fallback;

  const preset = PLATFORM_PRESETS[input.platform];
  const prompt = `Create a complete, ready-to-publish post package for ${preset.name}. Sound native to the platform, specific to the clip, and human. Avoid corporate language and fake claims.

Limits:
- title: ${preset.titleLimit ?? 100} characters maximum when used
- caption: ${preset.captionLimit ?? 2200} characters maximum when used
- postText: ${preset.postTextLimit ?? 280} characters maximum when used
- hashtags: ${preset.hashtagRange ? `${preset.hashtagRange.min}-${preset.hashtagRange.max}` : "0-8"}
- quoteText: one punchy quote under 120 characters

Editorial requirements:
- Lead with the strongest truthful hook or payoff; never expose producer notes, timestamps, scoring, or phrases such as "Short candidate".
- Use searchable proper names, people, games, shows, products, teams, events, or pop-culture topics when they are supported by the transcript or source metadata.
- Never invent a name, keyword, quote, outcome, or controversy.
- Make the title/caption worth clicking without vague clickbait.
- Fill every field that ${preset.name} actually uses. Keep irrelevant fields null.
- Hashtags and search tags must be specific and discoverable, not generic filler.
- Description should explain what happens and why it matters without discussing the clipping process.
- Pinned comments should ask a specific conversation-starting question about this clip.

Grounded working title: ${fallback.title}
Why it matters: ${stripInternalClipCopy(input.clipReason) || fallback.description || fallback.caption || "Use the transcript context"}
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
    return normalizeCopy(parsed, fallback, input.platform);
  } catch (error) {
    console.warn("[platform-copy] using fallback:", error);
    return fallback;
  }
}

/** Generate preview-ready copy from the same context used by export workers. */
export async function generatePlatformCopiesForClip(
  clipSuggestionId: string,
  platforms: PlatformKey[]
): Promise<Partial<Record<PlatformKey, PlatformCopy>>> {
  const clip = await prisma.clipSuggestion.findUnique({
    where: { id: clipSuggestionId },
    include: {
      streamSession: {
        select: { title: true, channelTitle: true },
      },
    },
  });
  if (!clip) throw new Error("Clip not found");

  const [transcriptChunks, chatWindows] = await Promise.all([
    getTranscriptChunksForRange(
      clip.streamSessionId,
      clip.startTimeSeconds,
      clip.endTimeSeconds
    ),
    prisma.eventWindow.findMany({
      where: {
        streamSessionId: clip.streamSessionId,
        type: "chat_window",
        startTimeSeconds: { lte: clip.endTimeSeconds },
        endTimeSeconds: { gte: clip.startTimeSeconds },
      },
      orderBy: { score: "desc" },
      take: 5,
      select: { summary: true },
    }),
  ]);
  const transcriptText = transcriptChunks
    .filter((chunk) => !/^\[(silence|processing error)\]$/i.test(chunk.text.trim()))
    .map((chunk) => chunk.text.trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, 8000);
  const base = {
    clipTitle: clip.title,
    clipReason: clip.reason,
    transcriptText,
    chatSignals: chatWindows.map((item) => item.summary).filter(Boolean).join(" | "),
    streamTitle: clip.streamSession.title,
    streamerName: clip.streamSession.channelTitle,
    durationSeconds: clip.endTimeSeconds - clip.startTimeSeconds,
  };
  const uniquePlatforms = [...new Set(platforms)];
  const copies = await Promise.all(
    uniquePlatforms.map(async (platform) => [
      platform,
      await generatePlatformCopy({ platform, ...base }),
    ] as const)
  );
  return Object.fromEntries(copies) as Partial<Record<PlatformKey, PlatformCopy>>;
}
