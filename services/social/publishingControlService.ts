import { createHash } from "crypto";
import { prisma } from "@/lib/db";
export const PUBLISHING_CONTROL_PLATFORM = "_publishing_control";
export function publishingControlId(userId: string) {
  return `control_${createHash("sha256").update(userId).digest("hex").slice(0, 40)}`;
}
export async function publishingIsPaused(userId: string) {
  const row = await prisma.socialPublishingPreference.findUnique({ where: { id: publishingControlId(userId) }, select: { autoPublishEnabled: true } });
  return row?.autoPublishEnabled === true;
}
export async function setPublishingPaused(userId: string, paused: boolean) {
  // A dedicated deterministic row prevents stale preference forms from resuming
  // publishing, and concurrent first-time saves cannot create conflicting flags.
  await prisma.socialPublishingPreference.upsert({ where: { id: publishingControlId(userId) },
    create: { id: publishingControlId(userId), userId, platform: PUBLISHING_CONTROL_PLATFORM, autoPublishEnabled: paused },
    update: { autoPublishEnabled: paused },
  });
}
