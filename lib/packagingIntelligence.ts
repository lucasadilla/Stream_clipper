import { z } from "zod";
import type { PlatformCopy, PlatformKey } from "@/lib/platforms/types";
import {
  containsInternalClipSignalLanguage,
  hasIncompleteClipThoughtEnding,
} from "@/lib/clipTitleQuality";

export const PACKAGING_POLICY_VERSION = "packaging-policy-v1";

const scoreSchema = z.number().min(0).max(100);

export const metadataStrategySchema = z.enum([
  "specific_fact",
  "curiosity",
  "result",
  "conflict",
  "quote",
  "unexpected_outcome",
  "challenge",
  "explanation",
  "reaction",
]);
export type MetadataStrategy = z.infer<typeof metadataStrategySchema>;

export const platformPackagingCandidateSchema = z.object({
  candidateId: z.string().min(1),
  strategy: metadataStrategySchema,
  title: z.string().nullable().optional(),
  caption: z.string().nullable().optional(),
  postText: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  hashtags: z.array(z.string()).max(12).optional(),
  tags: z.array(z.string()).max(16).optional(),
  quoteText: z.string().nullable().optional(),
  thumbnailText: z.string().nullable().optional(),
  pinnedComment: z.string().nullable().optional(),
  evidence: z.array(z.string().min(2).max(220)).min(1).max(8),
  specificity: scoreSchema,
  curiosity: scoreSchema,
  accuracy: scoreSchema,
  brevity: scoreSchema,
  naturalness: scoreSchema,
  keywordRelevance: scoreSchema,
  platformSuitability: scoreSchema,
  spoilerRisk: scoreSchema,
  clickbaitRisk: scoreSchema,
});
export type PlatformPackagingCandidate = z.infer<
  typeof platformPackagingCandidateSchema
>;

export const packagingDnaSchema = z.object({
  version: z.literal(PACKAGING_POLICY_VERSION),
  platform: z.string(),
  selectedCandidateId: z.string(),
  selectedStrategy: metadataStrategySchema,
  titleStrategy: metadataStrategySchema,
  descriptionStrategy: metadataStrategySchema,
  hashtagCount: z.number().int().min(0),
  keywordCount: z.number().int().min(0),
  alternatives: z.array(
    z.object({
      candidateId: z.string(),
      strategy: metadataStrategySchema,
      rankScore: scoreSchema,
      title: z.string().nullable(),
      caption: z.string().nullable(),
      postText: z.string().nullable(),
      evidence: z.array(z.string()),
      warnings: z.array(z.string()),
    })
  ),
  modelVersion: z.string(),
  policyVersion: z.string(),
  creatorOverrides: z.array(z.string()),
  generatedAt: z.string(),
});
export type PackagingDNA = z.infer<typeof packagingDnaSchema>;

export interface RankedPlatformPackage {
  copy: PlatformCopy;
  packagingDNA: PackagingDNA;
  warnings: string[];
  reasoningEvidence: string[];
}

const GENERIC = /\b(?:insane|crazy|epic|unbelievable|must watch|you won'?t believe|viral|stream clip|gaming moment|check out this clip)\b/i;
const FILLER_DESCRIPTION = /\b(?:don'?t forget to (?:like|follow|subscribe)|smash the|check out this crazy)\b/i;
const INCOMPLETE_ENDING = /\b(?:a|an|and|as|at|because|but|by|for|from|if|in|into|of|on|or|so|than|that|the|then|to|when|while|with|without)[.!?]?$/i;

function normalize(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function meaningfulWords(value: string): string[] {
  const stop = new Set([
    "the", "and", "for", "that", "this", "with", "from", "into", "what",
    "when", "where", "have", "has", "had", "was", "were", "you", "your",
    "his", "her", "their", "they", "them", "but", "not", "are", "our",
  ]);
  return normalize(value)
    .split(" ")
    .filter((word) => word.length >= 3 && !stop.has(word));
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function evidenceIsGrounded(
  evidence: string[],
  sourceContext: string
): boolean {
  const source = normalize(sourceContext);
  return evidence.some((item) => {
    const needle = normalize(item);
    return needle.split(" ").length >= 2 && source.includes(needle);
  });
}

export function packagingWarnings(
  candidate: PlatformPackagingCandidate,
  copy: PlatformCopy,
  sourceContext: string,
  options: { importantEntities?: string[] } = {}
): string[] {
  const primary = copy.title ?? copy.caption ?? copy.postText ?? "";
  const sourceWords = new Set(meaningfulWords(sourceContext));
  const warnings: string[] = [];
  if (!evidenceIsGrounded(candidate.evidence, sourceContext)) {
    warnings.push("No exact source evidence supports this package.");
  }
  if (GENERIC.test(primary)) warnings.push("Primary copy uses generic hype language.");
  if (containsInternalClipSignalLanguage(primary)) {
    warnings.push("Primary copy exposes an internal analysis label.");
  }
  if (copy.description && FILLER_DESCRIPTION.test(copy.description)) {
    warnings.push("Description contains generic engagement filler.");
  }
  const unrelatedHashtags = copy.hashtags.filter((tag) => {
    const tagWords = meaningfulWords(tag.replace(/^#/, ""));
    return tagWords.length > 0 && !tagWords.some((word) => sourceWords.has(word));
  });
  if (unrelatedHashtags.length > Math.max(1, Math.floor(copy.hashtags.length / 2))) {
    warnings.push("Most hashtags are not supported by the clip context.");
  }
  if (copy.hashtags.length > 8) warnings.push("Package contains too many hashtags.");
  if (/^[A-Z\d\W]+$/.test(primary) && /[A-Z]/.test(primary)) {
    warnings.push("Primary copy uses excessive capitalization.");
  }
  if (INCOMPLETE_ENDING.test(primary.trim()) || /(?:^|\s)\p{L}$/u.test(primary.trim())) {
    warnings.push("Primary copy appears cut off or grammatically incomplete.");
  }
  if (hasIncompleteClipThoughtEnding(primary)) {
    warnings.push("Primary copy ends with a context-dependent fragment.");
  }
  const important = (options.importantEntities ?? []).slice(0, 3)
    .map((entity) => normalize(entity))
    .filter((entity) => entity.length >= 3);
  if (
    important.length > 0 &&
    !important.some((entity) => normalize(primary).includes(entity))
  ) {
    warnings.push("Primary copy omits the strongest verified person or topic.");
  }
  return warnings;
}

export function rankPlatformPackagingCandidate(
  candidate: PlatformPackagingCandidate,
  copy: PlatformCopy,
  sourceContext: string,
  options: { importantEntities?: string[] } = {}
): { rankScore: number; warnings: string[] } {
  const warnings = packagingWarnings(candidate, copy, sourceContext, options);
  const groundingPenalty = warnings.some((warning) => warning.startsWith("No exact"))
    ? 45
    : 0;
  const incompletePenalty = warnings.some((warning) => warning.includes("cut off"))
    ? 30
    : 0;
  const internalCopyPenalty = warnings.some(
    (warning) =>
      warning.includes("internal analysis") ||
      warning.includes("context-dependent fragment")
  )
    ? 55
    : 0;
  const entityPenalty = warnings.some((warning) => warning.includes("verified person"))
    ? 10
    : 0;
  const spamPenalty = warnings.length * 4;
  const rankScore = clampScore(
    candidate.specificity * 0.2 +
      candidate.curiosity * 0.12 +
      candidate.accuracy * 0.26 +
      candidate.brevity * 0.08 +
      candidate.naturalness * 0.12 +
      candidate.keywordRelevance * 0.08 +
      candidate.platformSuitability * 0.14 -
      candidate.spoilerRisk * 0.05 -
      candidate.clickbaitRisk * 0.14 -
      groundingPenalty -
      incompletePenalty -
      internalCopyPenalty -
      entityPenalty -
      spamPenalty +
      12
  );
  return { rankScore, warnings };
}

export function buildPackagingDNA(input: {
  platform: PlatformKey;
  selected: PlatformPackagingCandidate;
  copy: PlatformCopy;
  alternatives: Array<{
    candidate: PlatformPackagingCandidate;
    copy: PlatformCopy;
    rankScore: number;
    warnings: string[];
  }>;
  modelVersion: string;
}): PackagingDNA {
  return packagingDnaSchema.parse({
    version: PACKAGING_POLICY_VERSION,
    platform: input.platform,
    selectedCandidateId: input.selected.candidateId,
    selectedStrategy: input.selected.strategy,
    titleStrategy: input.selected.strategy,
    descriptionStrategy: input.selected.strategy,
    hashtagCount: input.copy.hashtags.length,
    keywordCount: input.copy.tags.length,
    alternatives: input.alternatives.slice(0, 20).map((item) => ({
      candidateId: item.candidate.candidateId,
      strategy: item.candidate.strategy,
      rankScore: item.rankScore,
      title: item.copy.title,
      caption: item.copy.caption,
      postText: item.copy.postText,
      evidence: item.candidate.evidence,
      warnings: item.warnings,
    })),
    modelVersion: input.modelVersion,
    policyVersion: PACKAGING_POLICY_VERSION,
    creatorOverrides: [],
    generatedAt: new Date().toISOString(),
  });
}

export const performanceSnapshotSchema = z.object({
  platform: z.string(),
  capturedAt: z.string(),
  ageHours: z.number().min(0),
  impressions: z.number().min(0).nullable(),
  views: z.number().min(0).nullable(),
  viewedVsSwiped: z.number().min(0).max(1).nullable(),
  oneSecondRetention: z.number().min(0).max(1).nullable(),
  threeSecondRetention: z.number().min(0).max(1).nullable(),
  fiveSecondRetention: z.number().min(0).max(1).nullable(),
  averageWatchTimeSeconds: z.number().min(0).nullable(),
  averagePercentageViewed: z.number().min(0).nullable(),
  completionRate: z.number().min(0).max(1).nullable(),
  rewatchRate: z.number().min(0).nullable(),
  likes: z.number().min(0).nullable(),
  comments: z.number().min(0).nullable(),
  shares: z.number().min(0).nullable(),
  saves: z.number().min(0).nullable(),
  profileVisits: z.number().min(0).nullable(),
  linkClicks: z.number().min(0).nullable(),
  signups: z.number().min(0).nullable(),
  paidConversions: z.number().min(0).nullable(),
});

export function normalizedRetentionLabel(input: {
  observed: number | null;
  creatorBaseline: number | null;
  platformBaseline: number | null;
  categoryBaseline: number | null;
}): number | null {
  if (input.observed == null) return null;
  const baselines = [
    input.creatorBaseline,
    input.platformBaseline,
    input.categoryBaseline,
  ].filter((value): value is number => value != null && value > 0);
  if (baselines.length === 0) return null;
  const baseline = baselines.reduce((sum, value) => sum + value, 0) / baselines.length;
  return Math.round(((input.observed - baseline) / baseline) * 10_000) / 10_000;
}

