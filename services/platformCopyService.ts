import { z } from "zod";
import { getAiClient, hasAnyAiKey } from "@/lib/aiProvider";
import { getHookEnginePolicy } from "@/lib/aiModelPolicy";
import { prisma } from "@/lib/db";
import {
  buildFallbackPlatformCopy,
  extractPublishingKeywords,
  stripInternalClipCopy,
  truncatePlatformText,
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
import { readSpeakerContext } from "@/services/speakerContextService";
import { isSpecificClickableClipTitle } from "@/lib/clipTitleQuality";

const platformPackagingResponseSchema = z.object({
  candidates: z.array(platformPackagingCandidateSchema.omit({
    specificity: true, curiosity: true, accuracy: true, brevity: true,
    naturalness: true, keywordRelevance: true, platformSuitability: true,
    spoilerRisk: true, clickbaitRisk: true,
  })).length(1),
});

export interface GeneratePlatformCopyInput {
  platform: PlatformKey;
  clipTitle: string;
  clipReason: string;
  transcriptText: string;
  chatSignals?: string;
  streamTitle?: string | null;
  streamDescription?: string | null;
  streamerName?: string | null;
  visualContext?: string | null;
  /** Verified from creator metadata or an explicitly named speaker identity. */
  people?: string[];
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

function normalizedWords(value: string): string[] {
  return value
    .toLocaleLowerCase()
    .replace(/^#+/, "")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => word.length >= 2);
}

function groundedHashtags(
  values: string[],
  input: GeneratePlatformCopyInput,
  maximum: number
): string[] {
  const source = [
    input.clipTitle,
    input.clipReason,
    input.transcriptText,
    input.streamTitle,
    input.streamDescription,
    input.streamerName,
    input.visualContext,
    ...(input.people ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
  const compactSource = source.replace(/[^\p{L}\p{N}]+/gu, "");
  const accepted: string[] = [];

  for (const value of values) {
    const tag = cleanHashtag(value);
    if (!tag) continue;
    const compact = tag.slice(1).toLocaleLowerCase();
    const words = normalizedWords(tag);
    const supported =
      compact.length >= 3 &&
      (compactSource.includes(compact) ||
        (words.length > 0 && words.every((word) => source.includes(word))));
    if (!supported) continue;
    const nearDuplicate = accepted.some((existing) => {
      const left = existing.slice(1).toLocaleLowerCase();
      return left === compact || left.includes(compact) || compact.includes(left);
    });
    if (!nearDuplicate) accepted.push(tag);
    if (accepted.length >= maximum) break;
  }
  return accepted;
}

function verifiedEntities(input: GeneratePlatformCopyInput): string[] {
  return [...new Set([
    ...(input.people ?? []),
    ...(input.streamerName?.trim() ? [input.streamerName.trim()] : []),
    ...extractPublishingKeywords(input).slice(0, 8),
  ].map((value) => value.trim()).filter((value) => value.length >= 2))];
}

function normalizeCopy(
  raw: PlatformPackagingCandidate,
  fallback: PlatformCopy,
  input: GeneratePlatformCopyInput
): PlatformCopy {
  const platform = input.platform;
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
  const proposedTitle = cleanText(raw.title, null);
  const safeTitle =
    proposedTitle && isSpecificClickableClipTitle(proposedTitle)
      ? proposedTitle
      : fallback.title;
  let proposedDescription = cleanText(raw.description, null);
  for (const title of [proposedTitle, safeTitle]) {
    if (!title || !proposedDescription) continue;
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    proposedDescription = proposedDescription
      .replace(new RegExp(`^${escaped}[.!?:;\\s-]*`, "i"), "")
      .trim();
  }
  const safeDescription =
    proposedDescription &&
    proposedDescription.split(/\s+/).length >= 8 &&
    !/^From\s+.+[.!?]?$/i.test(proposedDescription)
      ? proposedDescription
      : fallback.description;

  const hashtagMaximum = preset.hashtagRange?.max ?? 5;
  const rawHashtags = groundedHashtags(
    // Canonical entities come first so a vague or compound AI tag cannot
    // crowd out the verified person/game/topic tags.
    [...fallback.hashtags, ...(raw.hashtags ?? [])],
    input,
    hashtagMaximum
  );
  const rawTags = [...new Set([...(raw.tags ?? []), ...fallback.tags]
    .map(cleanKeyword)
    .filter(Boolean))]
    .slice(0, 10);

  let caption =
    isX || isYouTube
      ? null
      : truncatePlatformText(
          cleanText(raw.caption, fallback.caption) ?? "",
          preset.captionLimit ?? 2200
        ) || null;
  if (isMergedCaption && caption) {
    const tags = rawHashtags.join(" ").trim();
    if (tags && !caption.toLocaleLowerCase().includes(tags.toLocaleLowerCase())) {
      const limit = preset.captionLimit ?? 2200;
      caption = `${truncatePlatformText(caption, Math.max(1, limit - tags.length - 1))} ${tags}`.trim();
    }
  }

  let postText = isX
    ? truncatePlatformText(
        cleanText(raw.postText, fallback.postText) ?? "",
        preset.postTextLimit ?? 280
      ) || null
    : null;
  if (isX && postText) {
    const tags = rawHashtags.join(" ").trim();
    if (tags && !postText.toLocaleLowerCase().includes(tags.toLocaleLowerCase())) {
      const limit = preset.postTextLimit ?? 280;
      postText = `${truncatePlatformText(postText, Math.max(1, limit - tags.length - 1))} ${tags}`.trim();
    }
  }

  return {
    title: isYouTube
      ? truncatePlatformText(
          safeTitle ?? "",
          preset.titleLimit ?? 100
        ) || null
      : null,
    caption,
    postText,
    description: isYouTube
      ? truncatePlatformText(
          safeDescription ?? "",
          5000
        ) || null
      : null,
    hashtags: rawHashtags,
    tags: isYouTube ? rawTags : [],
    quoteText: truncatePlatformText(
      cleanText(raw.quoteText, fallback.quoteText) ?? "",
      180
    ) || null,
    thumbnailText: null,
    pinnedComment: isYouTube
      ? truncatePlatformText(
          cleanText(raw.pinnedComment, fallback.pinnedComment) ?? "",
          500
        ) || null
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
    input.streamDescription,
    input.streamerName,
    input.visualContext,
    ...(input.people ?? []),
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
  input: GeneratePlatformCopyInput,
  options: { generate?: boolean } = {}
): Promise<RankedPlatformPackage> {
  const fallback = fallbackCopy(input);
  const localCandidate = fallbackCandidate(input, fallback);
  const context = sourceContext(input);
  const localRank = rankPlatformPackagingCandidate(
    localCandidate,
    fallback,
    context,
    { importantEntities: verifiedEntities(input) }
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
  // Adapt already-written clip copy locally by default. Only an explicit
  // regenerate action spends on new platform wording.
  if (!options.generate || !hasAnyAiKey()) return localPackage();

  const preset = PLATFORM_PRESETS[input.platform];
  const entities = verifiedEntities(input);
  const prompt = `Write exactly ONE ready-to-publish package for ${preset.name}. Make it specific to this exact clip and human. Do not generate alternatives, scores, ratings, or critiques.

Limits:
- title: ${preset.titleLimit ?? 100} characters maximum when used
- caption: ${preset.captionLimit ?? 2200} characters maximum when used
- postText: ${preset.postTextLimit ?? 280} characters maximum when used
- quoteText: one punchy quote under 120 characters

Editorial requirements:
- Lead with the strongest truthful hook or payoff; never expose producer notes, timestamps, scoring, or phrases such as "Short candidate".
- Use searchable proper names, people, games, shows, products, teams, events, or pop-culture topics when they are supported by the transcript or source metadata.
- The verified people/entities below are identity evidence from creator metadata, explicit speaker labels, titles, or transcript text. Use the central name early when it makes the clip clearer or more searchable. Never identify a person from appearance.
- Every title and first caption line must be a complete thought. Never end on an article, conjunction, preposition, or visibly cut-off word.
- Treat transcript text as evidence, not ready-made copy. Never title-case a raw spoken fragment. A stranger must understand the subject and action without the previous sentence.
- Reject greetings, politeness, acknowledgements, clause collisions, missing objects, and vague "this" or "that" references. "This Thank You Very Much The Last Time I Saw" is an invalid transcript fragment, not a title.
- Never end a title or first caption line with a backward-looking fragment such as "that's why," "that's how," "on an ongoing basis," "or whatever," or "for some reason."
- Visual-analysis labels are private evidence. Never publish or paraphrase phrases such as scene change detected, burst of visual motion, interface changed, event window, or narrative arc.
- Never invent a name, keyword, quote, outcome, or controversy.
- Make the title/caption worth clicking without vague clickbait.
- Choose one suitable strategy: specific_fact, curiosity, result, conflict, quote, unexpected_outcome, challenge, explanation, or reaction.
- Fill every field that ${preset.name} actually uses. Keep irrelevant fields null.
- For TikTok, Instagram, Facebook, and X: write platform-native caption/postText and include only a few relevant hashtags.
- For YouTube: provide a specific title, a non-redundant description, up to 3 relevant hashtags, up to 8 search keywords, and a grounded pinned comment.
- Description should explain what happens and why it matters without discussing the clipping process.
- Description must add concrete context beyond the title. Do not repeat the title as its opening sentence and do not describe the detector, edit, framing, transcript, or narrative structure.
- Pinned comments should ask a specific conversation-starting question about this clip.
- EVIDENCE must be an exact 2-12 word phrase copied from the transcript below.

Grounded working title: ${fallback.title}
Why it matters: ${stripInternalClipCopy(input.clipReason) || fallback.description || fallback.caption || "Use the transcript context"}
Stream: ${input.streamTitle ?? "Unknown"}
Stream context: ${(input.streamDescription ?? "Unknown").slice(0, 1000)}
Creator: ${input.streamerName ?? "Unknown"}
Verified people/entities: ${entities.length ? entities.join(" | ") : "None"}
Verified visual context: ${(input.visualContext ?? "Unavailable").slice(0, 2200)}
Duration: ${Math.round(input.durationSeconds)} seconds
Transcript: ${input.transcriptText.slice(0, 7000) || "Unavailable"}
Chat signals: ${(input.chatSignals ?? "Unavailable").slice(0, 1200)}

Return only JSON in this structure:
{"candidates":[{"candidateId":"single-package","strategy":"specific_fact","title":"...","caption":null,"postText":null,"description":"...","hashtags":["#Relevant"],"tags":["relevant keyword"],"quoteText":"...","thumbnailText":null,"pinnedComment":"...","evidence":["exact source phrase"]}]}
Use null when a field is irrelevant.`;

  try {
    const policy = getHookEnginePolicy();
    const response = await getAiClient().chat.completions.create(
      {
        model: policy.cheap.model,
        temperature: policy.cheap.temperature,
        max_tokens: 1200,
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
      { timeout: Math.min(30_000, policy.cheap.timeoutMs), maxRetries: 0 }
    );
    const content = response.choices[0]?.message?.content;
    if (!content) return localPackage();
    const parsed = platformPackagingResponseSchema.parse(parseJson(content));
    // Legacy packaging metadata retains local metrics, but the model produces
    // no scores and there is no alternatives/reranking pass.
    const candidate = { ...localCandidate, ...parsed.candidates[0]! };
    const normalizedSource = input.transcriptText.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ");
    if (!candidate.evidence.every((phrase) => normalizedSource.includes(
      phrase.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")
    ))) return localPackage();
    const copy = normalizeCopy(candidate, fallback, input);
    const quality = rankPlatformPackagingCandidate(candidate, copy, context, { importantEntities: entities });
    const selected = { candidate, copy, ...quality };
    return {
      copy: selected.copy,
      packagingDNA: buildPackagingDNA({
        platform: input.platform,
        selected: selected.candidate,
        copy: selected.copy,
        alternatives: [selected],
        modelVersion: `${policy.cheap.provider}:${policy.cheap.model}`,
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
        select: { title: true, description: true, channelTitle: true },
      },
    },
  });
  if (!clip) throw new Error("Clip not found");

  const [transcriptChunks, chatWindows, speakerContext] = await Promise.all([
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
    readSpeakerContext(clip.streamSessionId).catch(() => null),
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
    streamDescription: clip.streamSession.description,
    streamerName: clip.streamSession.channelTitle,
    visualContext:
      clip.rawAiJson && typeof clip.rawAiJson === "object"
        ? JSON.stringify(
            (clip.rawAiJson as Record<string, unknown>).visualContext ??
              (clip.rawAiJson as Record<string, unknown>).hookDNA ??
              ""
          ).slice(0, 2400)
        : null,
    people: speakerContext
      ? speakerContext.speakers
          .filter(
            (speaker) =>
              Boolean(speaker.displayName?.trim()) &&
              speaker.confidence >= 0.7 &&
              speakerContext.intervals.some(
                (interval) =>
                  interval.speakerIds.includes(speaker.id) &&
                  interval.endTimeSeconds >= clip.startTimeSeconds &&
                  interval.startTimeSeconds <= clip.endTimeSeconds
              )
          )
          .map((speaker) => speaker.displayName!.trim())
      : [],
    durationSeconds: clip.endTimeSeconds - clip.startTimeSeconds,
  };
  const uniquePlatforms = [...new Set(platforms)];
  const copies = await Promise.all(
    uniquePlatforms.map(async (platform) => [
      platform,
      // Studio reuses the clip's written title/description and adapts limits
      // locally. Opening eight platform tabs must not trigger eight AI jobs.
      buildFallbackPlatformCopy({ platform, ...base }),
    ] as const)
  );
  return Object.fromEntries(copies) as Partial<Record<PlatformKey, PlatformCopy>>;
}
