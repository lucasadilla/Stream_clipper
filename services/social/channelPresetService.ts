import { createHash } from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { channelPresetSchema, type ChannelPreset } from "@/lib/social/channelPreset";

export async function getChannelPreset(userId: string, accountId: string): Promise<ChannelPreset | null> {
  const row = await prisma.socialPublishingPreference.findFirst({
    where: { userId, connectedSocialAccountId: accountId }, orderBy: { updatedAt: "desc" }, select: { platformSettings: true },
  });
  const settings = row?.platformSettings as Record<string, unknown> | null;
  const parsed = channelPresetSchema.safeParse(settings?.channelPreset);
  return parsed.success ? parsed.data : null;
}

export async function listChannelPresets(userId: string) {
  const accounts = await prisma.connectedSocialAccount.findMany({ where: { userId, isActive: true },
    select: { id: true, displayName: true, username: true, platform: true }, orderBy: [{ platform: "asc" }, { createdAt: "asc" }] });
  return Promise.all(accounts.map(async (account) => ({ account, preset: await getChannelPreset(userId, account.id) })));
}

export async function saveChannelPreset(userId: string, accountId: string, input: unknown) {
  const account = await prisma.connectedSocialAccount.findFirst({ where: { id: accountId, userId, isActive: true }, select: { platform: true } });
  if (!account) throw new Error("Connected account not found");
  const preset = channelPresetSchema.parse(input);
  const id = `style_${createHash("sha256").update(JSON.stringify([userId, accountId])).digest("hex").slice(0, 40)}`;
  await prisma.socialPublishingPreference.upsert({ where: { id },
    create: { id, userId, platform: account.platform, connectedSocialAccountId: accountId, platformSettings: { channelPreset: preset } as unknown as Prisma.InputJsonValue },
    update: { platformSettings: { channelPreset: preset } as unknown as Prisma.InputJsonValue },
  });
  return preset;
}
