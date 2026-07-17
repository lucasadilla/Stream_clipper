import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { SocialPlatform } from "@/lib/social/types";
import { isSocialPlatform } from "@/lib/social/types";
import {
  defaultPublishingPreferences,
  type PublishingPreferencesView,
} from "@/lib/social/preferences";

export type { PublishingPreferencesView } from "@/lib/social/preferences";

const TONES = [
  "natural",
  "funny",
  "hype",
  "informative",
  "professional",
  "minimal",
] as const;
const EMOJI = ["none", "low", "normal"] as const;
const HASHTAG = ["none", "minimal", "normal"] as const;
const PRIVACY = ["private", "unlisted", "public"] as const;

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function parsePlatformSettings(value: unknown): {
  defaultAccountIds: string[];
  youtubeFormat: "shorts" | "standard";
  facebookFormat: "reel" | "page_video";
  tiktokMode: "direct" | "inbox";
} {
  const obj =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const youtubeFormat =
    obj.youtubeFormat === "standard" ? "standard" : "shorts";
  const facebookFormat =
    obj.facebookFormat === "page_video" ? "page_video" : "reel";
  const tiktokMode = obj.tiktokMode === "inbox" ? "inbox" : "direct";
  return {
    defaultAccountIds: asStringArray(obj.defaultAccountIds),
    youtubeFormat,
    facebookFormat,
    tiktokMode,
  };
}

function serializePreference(row: {
  id: string;
  autoPublishEnabled: boolean;
  defaultPrivacy: string | null;
  tone: string;
  emojiLevel: string;
  hashtagLevel: string;
  includeSourceUrl: boolean;
  useTranscriptQuotes: boolean;
  defaultHashtags: unknown;
  platformSettings: unknown;
}): PublishingPreferencesView {
  const platform = parsePlatformSettings(row.platformSettings);
  const privacy = PRIVACY.includes(
    row.defaultPrivacy as (typeof PRIVACY)[number]
  )
    ? (row.defaultPrivacy as (typeof PRIVACY)[number])
    : "private";
  return {
    id: row.id,
    autoCreateReviewDraft: row.autoPublishEnabled,
    defaultPrivacy: privacy,
    tone: (TONES as readonly string[]).includes(row.tone)
      ? (row.tone as PublishingPreferencesView["tone"])
      : "natural",
    emojiLevel: (EMOJI as readonly string[]).includes(row.emojiLevel)
      ? (row.emojiLevel as PublishingPreferencesView["emojiLevel"])
      : "low",
    hashtagLevel: (HASHTAG as readonly string[]).includes(row.hashtagLevel)
      ? (row.hashtagLevel as PublishingPreferencesView["hashtagLevel"])
      : "minimal",
    includeSourceUrl: row.includeSourceUrl,
    useTranscriptQuotes: row.useTranscriptQuotes,
    defaultHashtags: asStringArray(row.defaultHashtags),
    ...platform,
  };
}

/** Global (platform-null) publishing preferences for a user. */
export async function getPublishingPreferences(
  userId: string
): Promise<PublishingPreferencesView> {
  const row = await prisma.socialPublishingPreference.findFirst({
    where: { userId, platform: null },
    orderBy: { updatedAt: "desc" },
  });
  if (!row) return defaultPublishingPreferences();
  return serializePreference(row);
}

export async function upsertPublishingPreferences(
  userId: string,
  patch: Partial<PublishingPreferencesView>
): Promise<PublishingPreferencesView> {
  const current = await getPublishingPreferences(userId);
  const next: PublishingPreferencesView = {
    ...current,
    ...patch,
    defaultHashtags: patch.defaultHashtags ?? current.defaultHashtags,
    defaultAccountIds: patch.defaultAccountIds ?? current.defaultAccountIds,
  };

  if (patch.tone && !(TONES as readonly string[]).includes(patch.tone)) {
    throw new Error("Invalid tone");
  }
  if (
    patch.emojiLevel &&
    !(EMOJI as readonly string[]).includes(patch.emojiLevel)
  ) {
    throw new Error("Invalid emoji level");
  }
  if (
    patch.hashtagLevel &&
    !(HASHTAG as readonly string[]).includes(patch.hashtagLevel)
  ) {
    throw new Error("Invalid hashtag level");
  }
  if (
    patch.defaultPrivacy &&
    !(PRIVACY as readonly string[]).includes(patch.defaultPrivacy)
  ) {
    throw new Error("Invalid privacy");
  }

  if (next.defaultAccountIds.length) {
    const accounts = await prisma.connectedSocialAccount.findMany({
      where: {
        userId,
        isActive: true,
        id: { in: next.defaultAccountIds },
      },
      select: { id: true },
    });
    const allowed = new Set(accounts.map((a) => a.id));
    next.defaultAccountIds = next.defaultAccountIds.filter((id) =>
      allowed.has(id)
    );
  }

  const platformSettings = {
    defaultAccountIds: next.defaultAccountIds,
    youtubeFormat: next.youtubeFormat,
    facebookFormat: next.facebookFormat,
    tiktokMode: next.tiktokMode,
  } satisfies Prisma.InputJsonValue;

  const data = {
    autoPublishEnabled: next.autoCreateReviewDraft,
    defaultPrivacy: next.defaultPrivacy,
    tone: next.tone,
    emojiLevel: next.emojiLevel,
    hashtagLevel: next.hashtagLevel,
    includeSourceUrl: next.includeSourceUrl,
    useTranscriptQuotes: next.useTranscriptQuotes,
    defaultHashtags: next.defaultHashtags as Prisma.InputJsonValue,
    platformSettings,
    platform: null as string | null,
    connectedSocialAccountId: null as string | null,
  };

  if (current.id) {
    const updated = await prisma.socialPublishingPreference.update({
      where: { id: current.id },
      data,
    });
    return serializePreference(updated);
  }

  const created = await prisma.socialPublishingPreference.create({
    data: {
      userId,
      ...data,
    },
  });
  return serializePreference(created);
}

export async function resolvePreferredDestinations(userId: string): Promise<
  Array<{
    connectedSocialAccountId: string;
    platform: SocialPlatform;
  }>
> {
  const prefs = await getPublishingPreferences(userId);
  if (prefs.defaultAccountIds.length) {
    const accounts = await prisma.connectedSocialAccount.findMany({
      where: {
        userId,
        isActive: true,
        id: { in: prefs.defaultAccountIds },
      },
      select: { id: true, platform: true },
    });
    const byId = new Map(accounts.map((a) => [a.id, a]));
    return prefs.defaultAccountIds
      .map((id) => byId.get(id))
      .filter((a): a is { id: string; platform: string } => Boolean(a))
      .filter((a) => isSocialPlatform(a.platform))
      .map((a) => ({
        connectedSocialAccountId: a.id,
        platform: a.platform as SocialPlatform,
      }));
  }

  const defaults = await prisma.connectedSocialAccount.findMany({
    where: { userId, isActive: true, isDefault: true },
    select: { id: true, platform: true },
  });
  return defaults
    .filter((a) => isSocialPlatform(a.platform))
    .map((a) => ({
      connectedSocialAccountId: a.id,
      platform: a.platform as SocialPlatform,
    }));
}
