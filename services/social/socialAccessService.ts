import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import {
  ensureSessionBillingAccess,
  SessionAccessError,
} from "@/services/sessionAccessService";
import { getBillingAccountIdFromRequest } from "@/services/billingService";

export { SessionAccessError };

export async function requireAuthUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new SessionAccessError("Sign in required", 401);
  }
  return session.user.id;
}

export async function requireClipAccessForUser(
  request: Request,
  clipSuggestionId: string
) {
  const userId = await requireAuthUserId();
  const clip = await prisma.clipSuggestion.findUnique({
    where: { id: clipSuggestionId },
    select: {
      id: true,
      title: true,
      streamSessionId: true,
      status: true,
      startTimeSeconds: true,
      endTimeSeconds: true,
      suggestedFormat: true,
      streamSession: {
        select: {
          title: true,
          channelTitle: true,
          youtubeUrl: true,
          billingAccountId: true,
        },
      },
      renderJobs: {
        where: { status: "completed" },
        orderBy: { completedAt: "desc" },
        take: 1,
        select: { id: true, outputPath: true, status: true },
      },
    },
  });
  if (!clip) throw new SessionAccessError("Clip not found", 404);

  await ensureSessionBillingAccess(
    clip.streamSessionId,
    getBillingAccountIdFromRequest(request)
  );

  // Also allow if the billing account is linked to this user
  const billing = await prisma.billingAccount.findFirst({
    where: { userId },
    select: { id: true },
  });
  if (
    billing &&
    clip.streamSession.billingAccountId &&
    clip.streamSession.billingAccountId !== billing.id
  ) {
    // ensureSessionBillingAccess already checked cookie/account — keep as secondary guard
  }

  return { userId, clip };
}
