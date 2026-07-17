import { prisma } from "@/lib/db";
import { hasAppAccess, getBillingAccount } from "@/services/billingService";
import { REPLACED_SESSION_STATUS } from "@/services/sessionCleanupService";

export class SessionAccessError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Ensures the signed-in billing account can use this session.
 * Unclaimed sessions (billingAccountId null) are attached to the caller.
 */
export async function ensureSessionBillingAccess(
  sessionId: string,
  billingAccountId: string | null
) {
  if (!billingAccountId) {
    throw new SessionAccessError(
      "Creator Beta access is required right now. Enter your access code to unlock beta features.",
      401
    );
  }

  const account = await getBillingAccount(billingAccountId);
  if (!account || !hasAppAccess(account)) {
    throw new SessionAccessError(
      "Creator Beta access is required right now. Enter your access code to unlock beta features.",
      402
    );
  }

  const session = await prisma.streamSession.findUnique({
    where: { id: sessionId },
    select: { id: true, billingAccountId: true, liveStatus: true },
  });
  if (!session || session.liveStatus === REPLACED_SESSION_STATUS) {
    throw new SessionAccessError("Session not found", 404);
  }

  if (!session.billingAccountId) {
    await prisma.streamSession.update({
      where: { id: sessionId },
      data: { billingAccountId },
    });
    return { ...session, billingAccountId };
  }

  if (session.billingAccountId !== billingAccountId) {
    throw new SessionAccessError(
      "This session belongs to another account. Open it while signed in as the same user.",
      403
    );
  }

  return session;
}
