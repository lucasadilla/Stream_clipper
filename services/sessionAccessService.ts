import { prisma } from "@/lib/db";
import { hasAppAccess, getBillingAccount } from "@/services/billingService";

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
      "Sign in or subscribe before using this session.",
      401
    );
  }

  const account = await getBillingAccount(billingAccountId);
  if (!account || !hasAppAccess(account)) {
    throw new SessionAccessError(
      "Sign in or choose a paid plan to transcribe and render.",
      402
    );
  }

  const session = await prisma.streamSession.findUnique({
    where: { id: sessionId },
    select: { id: true, billingAccountId: true, liveStatus: true },
  });
  if (!session) {
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
