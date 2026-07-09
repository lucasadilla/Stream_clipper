import { prisma } from "@/lib/db";
import {
  getAccessInviteCodes,
  getUnlimitedAccessEmails,
  isUnlimitedAccessEmail,
  isValidAccessInviteCode,
  normalizeLoginEmail,
} from "@/lib/accessConfig";
import {
  serializeBillingAccount,
  type BillingAccountSummary,
} from "@/services/billingService";

export interface LoginResult {
  account: BillingAccountSummary;
  unlimitedAccess: boolean;
}

function compStripeCustomerId(email: string): string {
  const slug = normalizeLoginEmail(email).replace(/[^a-z0-9]+/g, "_");
  return `comp_${slug}`;
}

export async function loginWithEmail(params: {
  email: string;
  inviteCode?: string;
}): Promise<LoginResult> {
  const email = normalizeLoginEmail(params.email);
  if (!email || !email.includes("@")) {
    throw new Error("Enter a valid email address");
  }

  const allowlisted = isUnlimitedAccessEmail(email);
  const inviteOk = params.inviteCode
    ? isValidAccessInviteCode(params.inviteCode)
    : false;

  if (!allowlisted && !inviteOk) {
    const hasInvitesConfigured = getAccessInviteCodes().size > 0;
    const hasAllowlist = getUnlimitedAccessEmails().size > 0;
    if (!hasAllowlist && !hasInvitesConfigured) {
      throw new Error(
        "Comp access is not configured. Set UNLIMITED_ACCESS_EMAILS or ACCESS_INVITE_CODES in .env."
      );
    }
    throw new Error(
      hasInvitesConfigured
        ? "This email is not allowlisted. Enter a valid invite code or subscribe on the pricing page."
        : "This email is not on the unlimited access list."
    );
  }

  const stripeCustomerId = compStripeCustomerId(email);
  const account = await prisma.billingAccount.upsert({
    where: { stripeCustomerId },
    create: {
      email,
      stripeCustomerId,
      plan: "studio",
      status: "active",
      unlimitedAccess: true,
    },
    update: {
      email,
      plan: "studio",
      status: "active",
      unlimitedAccess: true,
    },
  });

  return {
    account: serializeBillingAccount(account),
    unlimitedAccess: true,
  };
}

export async function getLoggedInAccount(
  billingAccountId: string | null | undefined
): Promise<BillingAccountSummary | null> {
  if (!billingAccountId) return null;
  const account = await prisma.billingAccount.findUnique({
    where: { id: billingAccountId },
  });
  return account ? serializeBillingAccount(account) : null;
}
