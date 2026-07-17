import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import {
  ensureSessionBillingAccess,
  SessionAccessError,
} from "@/services/sessionAccessService";
import { getBillingAccountIdFromRequest } from "@/services/billingService";

export { SessionAccessError };

/**
 * Resolve the signed-in Auth.js user id.
 * Prefers the Auth.js session; falls back to the billing-account cookie
 * (same signal the site header uses) so email/password logins that set the
 * cookie but briefly miss a JWT still work for social settings.
 */
export async function requireAuthUserId(
  request?: Request
): Promise<string> {
  const session = await auth();
  if (session?.user?.id) {
    return session.user.id;
  }

  if (request) {
    const billingAccountId = getBillingAccountIdFromRequest(request);
    if (billingAccountId) {
      const billing = await prisma.billingAccount.findUnique({
        where: { id: billingAccountId },
        select: { userId: true },
      });
      if (billing?.userId) {
        return billing.userId;
      }
    }
  }

  throw new SessionAccessError("Sign in required", 401);
}

export async function requireClipAccessForUser(
  request: Request,
  clipSuggestionId: string
) {
  const userId = await requireAuthUserId(request);
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

  const billing = await prisma.billingAccount.findFirst({
    where: { userId },
    select: { id: true },
  });
  if (
    billing &&
    clip.streamSession.billingAccountId &&
    clip.streamSession.billingAccountId !== billing.id
  ) {
    // ensureSessionBillingAccess already checked cookie/account
  }

  return { userId, clip };
}
