import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { normalizeLoginEmail, isUnlimitedAccessEmail } from "@/lib/accessConfig";
import { BILLING_ACCOUNT_COOKIE } from "@/lib/stripe";
import {
  hasAppAccess,
  serializeBillingAccount,
  type BillingAccountSummary,
} from "@/services/billingService";
import { unlockCreatorBeta } from "@/services/creatorBetaService";
import { isCreatorBetaEnabled } from "@/lib/creatorBeta";

export const PENDING_CREATOR_CODE_COOKIE = "clipper_pending_creator_code";

function authStripeCustomerId(provider: string, providerAccountId?: string) {
  const slug = (providerAccountId || randomUUID()).replace(/[^a-zA-Z0-9_-]/g, "");
  return `auth_${provider}_${slug}`.slice(0, 200);
}

export async function setBillingAccountCookie(accountId: string) {
  const jar = await cookies();
  jar.set(BILLING_ACCOUNT_COOKIE, accountId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

export async function readPendingCreatorCode(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(PENDING_CREATOR_CODE_COOKIE)?.value ?? null;
}

export async function clearPendingCreatorCode() {
  const jar = await cookies();
  jar.delete(PENDING_CREATOR_CODE_COOKIE);
}

/**
 * Ensure a BillingAccount exists for an Auth.js user and sync cookie access.
 */
export async function ensureBillingAccountForAuthUser(params: {
  userId: string;
  email?: string | null;
  name?: string | null;
  provider?: string | null;
  providerAccountId?: string | null;
}): Promise<BillingAccountSummary> {
  const email = params.email ? normalizeLoginEmail(params.email) : null;
  const provider = params.provider?.trim() || "oauth";

  let account = await prisma.billingAccount.findFirst({
    where: { userId: params.userId },
  });

  if (!account && email) {
    account = await prisma.billingAccount.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      orderBy: { createdAt: "asc" },
    });
  }

  const unlimited = email ? isUnlimitedAccessEmail(email) : false;

  if (!account) {
    account = await prisma.billingAccount.create({
      data: {
        userId: params.userId,
        email,
        displayName: params.name?.trim().slice(0, 80) || null,
        authProvider: provider,
        stripeCustomerId: authStripeCustomerId(
          provider,
          params.providerAccountId ?? params.userId
        ),
        plan: unlimited ? "studio" : "creator",
        status: unlimited ? "active" : "incomplete",
        unlimitedAccess: unlimited,
        lastSignedInAt: new Date(),
      },
    });
  } else {
    account = await prisma.billingAccount.update({
      where: { id: account.id },
      data: {
        userId: params.userId,
        email: email ?? account.email,
        displayName:
          params.name?.trim().slice(0, 80) || account.displayName || null,
        authProvider: provider,
        unlimitedAccess: unlimited || account.unlimitedAccess,
        status:
          unlimited || account.unlimitedAccess || account.betaAccess
            ? account.status === "incomplete"
              ? unlimited
                ? "active"
                : account.betaAccess
                  ? "beta"
                  : account.status
              : account.status
            : account.status,
        plan: unlimited ? "studio" : account.plan,
        lastSignedInAt: new Date(),
      },
    });
  }

  // Redeem pending creator program code once after OAuth / email sign-in
  const pendingCode = await readPendingCreatorCode();
  if (pendingCode && isCreatorBetaEnabled() && !account.betaAccess) {
    try {
      const unlocked = await unlockCreatorBeta({
        accountId: account.id,
        email: account.email ?? email ?? undefined,
        code: pendingCode,
        termsAccepted: true,
      });
      account = await prisma.billingAccount.findUniqueOrThrow({
        where: { id: unlocked.account.id },
      });
    } catch {
      // leave pending code; user can retry on welcome page
    } finally {
      await clearPendingCreatorCode();
    }
  }

  await setBillingAccountCookie(account.id);
  return serializeBillingAccount(account);
}

export function postAuthRedirectPath(account: BillingAccountSummary): string {
  if (hasAppAccess(account)) return "/#analyze";
  return "/welcome";
}
