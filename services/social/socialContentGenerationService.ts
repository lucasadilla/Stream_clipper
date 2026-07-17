import { z } from "zod";
import { getAiClient, getChatModel, hasAnyAiKey } from "@/lib/aiProvider";
import type {
  EmojiLevel,
  HashtagLevel,
  SocialContentTone,
  SocialGeneratedContent,
  SocialPlatform,
} from "@/lib/social/types";
import { emptySocialContent } from "@/lib/social/types";
import {
  generatePlatformCopy,
  type GeneratePlatformCopyInput,
} from "@/services/platformCopyService";

const contentSchema = z.object({
  platform: z.string(),
  title: z.string().optional().default(""),
  caption: z.string().optional().default(""),
  description: z.string().optional().default(""),
  postText: z.string().optional().default(""),
  hashtags: z.array(z.string()).optional().default([]),
  tags: z.array(z.string()).optional().default([]),
  thumbnailText: z.string().optional().default(""),
  pinnedComment: z.string().optional().default(""),
  redditTitle: z.string().optional().default(""),
  redditBody: z.string().optional().default(""),
  contentWarning: z.boolean().optional().default(false),
  reasoningSummary: z.string().optional().default(""),
});

export interface SocialContentContext {
  platform: SocialPlatform;
  clipTitle: string;
  clipReason: string;
  transcriptText: string;
  chatSignals?: string;
  streamTitle?: string | null;
  streamerName?: string | null;
  durationSeconds: number;
  sourceUrl?: string | null;
  tone?: SocialContentTone;
  emojiLevel?: EmojiLevel;
  hashtagLevel?: HashtagLevel;
  includeSourceUrl?: boolean;
  useTranscriptQuotes?: boolean;
  youtubeFormat?: "shorts" | "standard";
}

function cleanHashtag(value: string): string {
  const cleaned = value.trim().replace(/^#+/, "").replace(/[^a-zA-Z0-9_]/g, "");
  return cleaned ? `#${cleaned}` : "";
}

function applyHashtagLevel(tags: string[], level: HashtagLevel): string[] {
  if (level === "none") return [];
  if (level === "minimal") return tags.slice(0, 3);
  return tags.slice(0, 8);
}

function applyEmojiLevel(text: string, level: EmojiLevel): string {
  if (level === "none") {
    return text.replace(/\p{Extended_Pictographic}/gu, "").replace(/\s{2,}/g, " ").trim();
  }
  return text;
}

function fallbackForPlatform(input: SocialContentContext): SocialGeneratedContent {
  const base = emptySocialContent(input.platform);
  const quote = (input.transcriptText || input.clipReason || input.clipTitle)
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/)[0]
    ?.slice(0, 120) || input.clipTitle;

  if (input.platform === "youtube") {
    const isShorts = input.youtubeFormat !== "standard";
    const hashtags = applyHashtagLevel(
      ["#livestream", "#highlights", isShorts ? "#Shorts" : ""].filter(Boolean),
      input.hashtagLevel ?? "minimal"
    );
    return {
      ...base,
      title: input.clipTitle.slice(0, 100),
      caption: quote,
      description: [
        input.clipReason,
        input.includeSourceUrl && input.sourceUrl ? `Source: ${input.sourceUrl}` : "",
        hashtags.join(" "),
      ]
        .filter(Boolean)
        .join("\n\n"),
      hashtags,
      tags: ["livestream", "highlights", input.streamerName || "creator"].filter(Boolean),
      thumbnailText: input.clipTitle.split(/\s+/).slice(0, 6).join(" ").toUpperCase(),
      pinnedComment: "What would you have done here?",
      reasoningSummary: isShorts
        ? "Used a concise Shorts-friendly title focused on the moment."
        : "Used a searchable title and put the reaction context in the description.",
    };
  }

  return {
    ...base,
    title: input.clipTitle.slice(0, 100),
    caption: quote,
    postText: quote.slice(0, 280),
    reasoningSummary: "Generated a conservative fallback caption from clip context.",
  };
}

function mapToExportKey(
  platform: SocialPlatform,
  youtubeFormat?: "shorts" | "standard"
): GeneratePlatformCopyInput["platform"] {
  if (platform === "youtube") {
    return youtubeFormat === "standard" ? "youtube_landscape" : "youtube_shorts";
  }
  if (platform === "tiktok") return "tiktok";
  if (platform === "instagram") return "instagram_reels";
  if (platform === "facebook") return "facebook_reels";
  if (platform === "x") return "x";
  return "youtube_shorts";
}

export async function generateSocialContent(
  input: SocialContentContext
): Promise<SocialGeneratedContent> {
  const fallback = fallbackForPlatform(input);

  // Reuse platform export copy for platforms that already have presets.
  if (input.platform !== "reddit") {
    try {
      const copy = await generatePlatformCopy({
        platform: mapToExportKey(input.platform, input.youtubeFormat),
        clipTitle: input.clipTitle,
        clipReason: input.clipReason,
        transcriptText: input.transcriptText,
        chatSignals: input.chatSignals,
        streamTitle: input.streamTitle,
        streamerName: input.streamerName,
        durationSeconds: input.durationSeconds,
      });

      const merged: SocialGeneratedContent = {
        ...fallback,
        title: copy.title || fallback.title,
        caption: copy.caption || fallback.caption,
        description: copy.description || fallback.description,
        postText: copy.postText || fallback.postText,
        hashtags: applyHashtagLevel(
          copy.hashtags.length ? copy.hashtags : fallback.hashtags,
          input.hashtagLevel ?? "minimal"
        ),
        tags: copy.tags.length ? copy.tags : fallback.tags,
        thumbnailText: copy.thumbnailText || fallback.thumbnailText,
        pinnedComment: copy.pinnedComment || fallback.pinnedComment,
        reasoningSummary: fallback.reasoningSummary,
      };

      merged.title = applyEmojiLevel(merged.title, input.emojiLevel ?? "low");
      merged.caption = applyEmojiLevel(merged.caption, input.emojiLevel ?? "low");
      merged.description = applyEmojiLevel(merged.description, input.emojiLevel ?? "low");
      merged.postText = applyEmojiLevel(merged.postText, input.emojiLevel ?? "low");
      return merged;
    } catch {
      // fall through to AI / fallback
    }
  }

  if (!hasAnyAiKey()) return fallback;

  try {
    const client = getAiClient();
    const response = await client.chat.completions.create({
      model: getChatModel(),
      temperature: 0.5,
      messages: [
        {
          role: "system",
          content:
            "You write platform-native social post copy for livestream clips. Never invent facts, quotes, names, or events not supported by the transcript or metadata. Return JSON only.",
        },
        {
          role: "user",
          content: `Platform: ${input.platform}
Tone: ${input.tone ?? "natural"}
Emoji level: ${input.emojiLevel ?? "low"}
Hashtag level: ${input.hashtagLevel ?? "minimal"}
YouTube format: ${input.youtubeFormat ?? "shorts"}
Clip title: ${input.clipTitle}
Why it matters: ${input.clipReason}
Stream: ${input.streamTitle ?? "Unknown"}
Creator: ${input.streamerName ?? "Unknown"}
Duration: ${Math.round(input.durationSeconds)}s
Source URL: ${input.includeSourceUrl ? input.sourceUrl ?? "n/a" : "omit"}
Transcript: ${input.transcriptText.slice(0, 7000) || "Unavailable"}
Chat: ${(input.chatSignals ?? "").slice(0, 1200) || "Unavailable"}

Return JSON with keys: platform, title, caption, description, postText, hashtags, tags, thumbnailText, pinnedComment, redditTitle, redditBody, contentWarning, reasoningSummary.
reasoningSummary must be one short product-facing sentence, not private chain-of-thought.`,
        },
      ],
      response_format: { type: "json_object" },
    });

    const raw = response.choices[0]?.message?.content || "{}";
    const parsed = contentSchema.parse(JSON.parse(raw));
    return {
      platform: input.platform,
      title: applyEmojiLevel(parsed.title || fallback.title, input.emojiLevel ?? "low").slice(0, 100),
      caption: applyEmojiLevel(parsed.caption || fallback.caption, input.emojiLevel ?? "low"),
      description: applyEmojiLevel(
        parsed.description || fallback.description,
        input.emojiLevel ?? "low"
      ),
      postText: applyEmojiLevel(parsed.postText || fallback.postText, input.emojiLevel ?? "low"),
      hashtags: applyHashtagLevel(
        (parsed.hashtags.length ? parsed.hashtags : fallback.hashtags).map(cleanHashtag).filter(Boolean),
        input.hashtagLevel ?? "minimal"
      ),
      tags: (parsed.tags.length ? parsed.tags : fallback.tags).map((t) => t.trim()).filter(Boolean),
      thumbnailText: parsed.thumbnailText || fallback.thumbnailText,
      pinnedComment: parsed.pinnedComment || fallback.pinnedComment,
      redditTitle: parsed.redditTitle || fallback.redditTitle,
      redditBody: parsed.redditBody || fallback.redditBody,
      contentWarning: parsed.contentWarning,
      reasoningSummary: parsed.reasoningSummary || fallback.reasoningSummary,
    };
  } catch {
    return fallback;
  }
}
