import { z } from "zod";
import { getAiClient, hasAnyAiKey } from "@/lib/aiProvider";
import { getHookEnginePolicy } from "@/lib/aiModelPolicy";
import { prisma } from "@/lib/db";
import {
  buildFallbackPlatformCopy,
  stripInternalClipCopy,
} from "@/lib/platformCopyDefaults";
import { PLATFORM_PRESETS } from "@/lib/platforms/presets";
import type { PlatformCopy, PlatformKey } from "@/lib/platforms/types";
import {
  buildPackagingDNA,
  platformPackagingCandidateSchema,
  rankPlatformPackagingCandidate,
  type PlatformPackagingCandidate,
  type RankedPlatformPackage,
} from "@/lib/packagingIntelligence";
import { getTranscriptChunksForRange } from "@/services/transcriptService";

const platformPackagingResponseSchema = z.object({
  candidates: z.array(platformPackagingCandidateSchema).min(3).max(20),
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

function cleanKeyword(value: string): string {
  return value
    .trim()
    .replace(/^#+/, "")
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 60);
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
  raw: PlatformPackagingCandidate,
  fallback: PlatformCopy,
  platform: PlatformKey
): PlatformCopy {
  const preset = PLATFORM_PRESETS[platform];
  const cleanText = (value: string | null | undefined, fallbackValue: string | null) => {
    const cleaned = value ? stripInternalClipCopy(value) : "";
    return cleaned || fallbackValue;
  };
  const isYouTube = platform.startsWith("youtube");
  const isX = platform === "x";
  const isMergedCaption =
    platform === "tiktok" ||
    platform.startsWith("instagram") ||
    platform.startsWith("facebook");

  const rawHashtags = [...new Set([...(raw.hashtags ?? []), ...fallback.hashtags]
    .map(cleanHashtag)
    .filter(Boolean))]
    .slice(0, preset.hashtagRange?.hardMax ?? preset.hashtagRange?.max ?? 8);
  const rawTags = [...new Set([...(raw.tags ?? []), ...fallback.tags]
    .map(cleanKeyword)
    .filter(Boolean))]
    .slice(0, 10);

  let caption =
    isX || isYouTube
      ? null
      : cleanText(raw.caption, fallback.caption)?.slice(0, preset.captionLimit ?? 2200) ?? null;
  if (isMergedCaption && caption) {
    const tags = rawHashtags.join(" ").trim();
    if (tags && !caption.toLocaleLowerCase().includes(tags.toLocaleLowerCase())) {
      caption = `${caption} ${tags}`.replace(/\s+/g, " ").trim().slice(0, preset.captionLimit ?? 2200);
    }
  }

  let postText = isX
    ? cleanText(raw.postText, fallback.postText)?.slice(0, preset.postTextLimit ?? 280) ?? null
    : null;
  if (isX && postText) {
    const tags = rawHashtags.join(" ").trim();
    if (tags && !postText.toLocaleLowerCase().includes(tags.toLocaleLowerCase())) {
      postText = `${postText} ${tags}`.replace(/\s+/g, " ").trim().slice(0, preset.postTextLimit ?? 280);
    }
  }

  return {
    title: isYouTube
      ? cleanText(raw.title, fallback.title)?.slice(0, preset.titleLimit ?? 100) ?? null
      : null,
    caption,
    postText,
    description: isYouTube
      ? cleanText(raw.description, fallback.description)?.slice(0, 5000) ?? null
      : null,
    hashtags: rawHashtags,
    tags: isYouTube ? rawTags : [],
    quoteText: cleanText(raw.quoteText, fallback.quoteText)?.slice(0, 180) ?? null,
    thumbnailText: null,
    pinnedComment: isYouTube
      ? cleanText(raw.pinnedComment, fallback.pinnedComment)?.slice(0, 500) ?? null
      : null,
  };
}

function sourceContext(input: GeneratePlatformCopyInput): string {
  return [
    input.clipTitle,
    stripInternalClipCopy(input.clipReason),
    input.transcriptText,
    input.chatSignals,
    input.streamTitle,
    input.streamerName,
  ]
    .filter(Boolean)
    .join(" ");
}

function fallbackCandidate(
  input: GeneratePlatformCopyInput,
  fallback: PlatformCopy
): PlatformPackagingCandidate {
  const evidence =
    input.transcriptText.trim().split(/\s+/).slice(0, 10).join(" ") ||
    input.clipTitle;
  return platformPackagingCandidateSchema.parse({
    candidateId: "local-specific-fact",
    strategy: "specific_fact",
    ...fallback,
    evidence: [evidence],
    specificity: 72,
    curiosity: 55,
    accuracy: 94,
    brevity: 82,
    naturalness: 82,
    keywordRelevance: 76,
    platformSuitability: 78,
    spoilerRisk: 12,
    clickbaitRisk: 4,
  });
}

export async function generatePlatformCopyPackage(
  input: GeneratePlatformCopyInput
): Promise<RankedPlatformPackage> {
  const fallback = fallbackCopy(input);
  const localCandidate = fallbackCandidate(input, fallback);
  const context = sourceContext(input);
  const localRank = rankPlatformPackagingCandidate(
    localCandidate,
    fallback,
    context
  );
  const localPackage = (): RankedPlatformPackage => ({
    copy: fallback,
    packagingDNA: buildPackagingDNA({
      platform: input.platform,
      selected: localCandidate,
      copy: fallback,
      alternatives: [
        {
          candidate: localCandidate,
          copy: fallback,
          rankScore: localRank.rankScore,
          warnings: localRank.warnings,
        },
      ],
      modelVersion: "local-packaging-v1",
    }),
    warnings: localRank.warnings,
    reasoningEvidence: localCandidate.evidence,
  });
  if (!hasAnyAiKey()) return localPackage();

  const preset = PLATFORM_PRESETS[input.platform];
  const prompt = `Generate 8-12 distinct, ready-to-publish packages for ${preset.name}, then let application code rank them. Each option must sound native to the platform, specific to this exact clip, and human.

Limits:
- title: ${preset.titleLimit ?? 100} characters maximum when used
- caption: ${preset.captionLimit ?? 2200} characters maximum when used
- postText: ${preset.postTextLimit ?? 280} characters maximum when used
- quoteText: one punchy quote under 120 characters

Editorial requirements:
- Lead with the strongest truthful hook or payoff; never expose producer notes, timestamps, scoring, or phrases such as "Short candidate".
- Use searchable proper names, people, games, shows, products, teams, events, or pop-culture topics when they are supported by the transcript or source metadata.
- Never invent a name, keyword, quote, outcome, or controversy.
- Make the title/caption worth clicking without vague clickbait.
- Vary strategies across specific_fact, curiosity, result, conflict, quote, unexpected_outcome, challenge, explanation, and reaction.
- Fill every field that ${preset.name} actually uses. Keep irrelevant fields null.
- For TikTok, Instagram, Facebook, and X: write platform-native caption/postText and include only a few relevant hashtags.
- For YouTube: provide a specific title, a non-redundant description, up to 3 relevant hashtags, up to 8 search keywords, and a grounded pinned comment.
- Description should explain what happens and why it matters without discussing the clipping process.
- Pinned comments should ask a specific conversation-starting question about this clip.
- EVIDENCE must be an exact 2-12 word phrase copied from the transcript below.
- Score each option honestly from 0-100. Accuracy is factual support, never predicted virality.

Grounded working title: ${fallback.title}
Why it matters: ${stripInternalClipCopy(input.clipReason) || fallback.description || fallback.caption || "Use the transcript context"}
Stream: ${input.streamTitle ?? "Unknown"}
Creator: ${input.streamerName ?? "Unknown"}
Duration: ${Math.round(input.durationSeconds)} seconds
Transcript: ${input.transcriptText.slice(0, 7000) || "Unavailable"}
Chat signals: ${(input.chatSignals ?? "Unavailable").slice(0, 1200)}

Return only JSON in this structure:
{"candidates":[{"candidateId":"stable-id","strategy":"specific_fact","title":"...","caption":null,"postText":null,"description":"...","hashtags":["#Relevant"],"tags":["relevant keyword"],"quoteText":"...","thumbnailText":null,"pinnedComment":"...","evidence":["exact source phrase"],"specificity":90,"curiosity":75,"accuracy":98,"brevity":88,"naturalness":92,"keywordRelevance":85,"platformSuitability":94,"spoilerRisk":12,"clickbaitRisk":3}]}
Use null when a field is irrelevant.`;

  try {
    const policy = getHookEnginePolicy();
    const response = await getAiClient().chat.completions.create(
      {
        model: policy.strong.model,
        temperature: policy.strong.temperature,
        max_tokens: policy.strong.maxTokens,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are a skeptical short-form packaging editor. Accuracy and specificity outrank hype. Return valid JSON only.",
          },
          { role: "user", content: prompt },
        ],
      },
      { timeout: policy.strong.timeoutMs }
    );
    const content = response.choices[0]?.message?.content;
    if (!content) return localPackage();
    const parsed = platformPackagingResponseSchema.parse(parseJson(content));
    const ranked = [
      ...parsed.candidates.map((candidate) => {
        const copy = normalizeCopy(candidate, fallback, input.platform);
        const quality = rankPlatformPackagingCandidate(
          candidate,
          copy,
          context
        );
        return { candidate, copy, ...quality };
      }),
      {
        candidate: localCandidate,
        copy: fallback,
        rankScore: localRank.rankScore,
        warnings: localRank.warnings,
      },
    ]
      .filter(
        (item, index, all) =>
          all.findIndex(
            (other) =>
              (other.copy.title ?? other.copy.caption ?? other.copy.postText ?? "")
                .toLocaleLowerCase() ===
              (item.copy.title ?? item.copy.caption ?? item.copy.postText ?? "")
                .toLocaleLowerCase()
          ) === index
      )
      .sort((a, b) => b.rankScore - a.rankScore);
    const selected = ranked[0];
    if (!selected) return localPackage();
    return {
      copy: selected.copy,
      packagingDNA: buildPackagingDNA({
        platform: input.platform,
        selected: selected.candidate,
        copy: selected.copy,
        alternatives: ranked,
        modelVersion: `${policy.strong.provider}:${policy.strong.model}`,
      }),
      warnings: selected.warnings,
      reasoningEvidence: selected.candidate.evidence,
    };
  } catch (error) {
    console.warn("[platform-copy] using fallback:", error);
    return localPackage();
  }
}

export async function generatePlatformCopy(
  input: GeneratePlatformCopyInput
): Promise<PlatformCopy> {
  return (await generatePlatformCopyPackage(input)).copy;
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
