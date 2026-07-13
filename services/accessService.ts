import { prisma } from "@/lib/db";
import {
  getAccessInviteCodes,
  getUnlimitedAccessEmails,
  isUnlimitedAccessEmail,
  isValidAccessInviteCode,
  normalizeLoginEmail,
} from "@/lib/accessConfig";
import {
  canManageBillingForAccount,
  serializeBillingAccount,
  type BillingAccountSummary,
} from "@/services/billingService";
import { getStripe } from "@/lib/stripe";
import { isCreatorBetaEnabled } from "@/lib/creatorBeta";

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

  const betaAccount = await prisma.billingAccount.findFirst({
    where: {
      email: { equals: email, mode: "insensitive" },
      betaAccess: true,
    },
    orderBy: { createdAt: "asc" },
  });
  if (betaAccount && isCreatorBetaEnabled()) {
    const account = await prisma.billingAccount.update({
      where: { id: betaAccount.id },
      data: { lastSignedInAt: new Date() },
    });
    return {
      account: serializeBillingAccount(account),
      unlimitedAccess: account.unlimitedAccess,
    };
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
      lastSignedInAt: new Date(),
    },
    update: {
      email,
      plan: "studio",
      status: "active",
      unlimitedAccess: true,
      lastSignedInAt: new Date(),
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

const DISPLAY_NAME_MAX = 80;

export async function updateProfile(
  billingAccountId: string | null | undefined,
  patch: { displayName?: unknown; email?: unknown }
): Promise<BillingAccountSummary> {
  if (!billingAccountId) {
    throw new Error("Sign in to update your profile");
  }

  const existing = await prisma.billingAccount.findUnique({
    where: { id: billingAccountId },
  });
  if (!existing) throw new Error("Account not found");

  const data: { displayName?: string | null; email?: string } = {};

  if ("displayName" in patch) {
    if (typeof patch.displayName !== "string" && patch.displayName !== null) {
      throw new Error("Display name must be a string");
    }
    const trimmed =
      typeof patch.displayName === "string"
        ? patch.displayName.trim().slice(0, DISPLAY_NAME_MAX)
        : "";
    data.displayName = trimmed.length > 0 ? trimmed : null;
  }

  if ("email" in patch) {
    if (typeof patch.email !== "string") {
      throw new Error("Enter a valid email address");
    }
    const email = normalizeLoginEmail(patch.email);
    if (!email || !email.includes("@")) {
      throw new Error("Enter a valid email address");
    }
    data.email = email;

    if (
      canManageBillingForAccount(existing) &&
      email !== (existing.email ?? "").toLowerCase()
    ) {
      try {
        await getStripe().customers.update(existing.stripeCustomerId, {
          email,
        });
      } catch (err) {
        console.warn("[profile] failed to sync email to Stripe:", err);
      }
    }
  }

  const account = await prisma.billingAccount.update({
    where: { id: billingAccountId },
    data,
  });

  return serializeBillingAccount(account);
}

/** @deprecated Use updateProfile */
export async function updateDisplayName(
  billingAccountId: string | null | undefined,
  displayName: unknown
): Promise<BillingAccountSummary> {
  return updateProfile(billingAccountId, { displayName });
}
