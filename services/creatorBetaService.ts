import { randomBytes, randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import {
  hashCreatorBetaCode,
  isCreatorBetaEnabled,
  normalizeCreatorBetaCode,
} from "@/lib/creatorBeta";
import { normalizeLoginEmail } from "@/lib/accessConfig";
import { serializeBillingAccount } from "@/services/billingService";
import { getUsageSnapshot } from "@/services/usageService";

export type CreatorBetaUnlockErrorCode =
  | "invalid_or_expired"
  | "already_used"
  | "terms_required"
  | "email_required"
  | "beta_paused";

export class CreatorBetaUnlockError extends Error {
  code: CreatorBetaUnlockErrorCode;
  status: number;

  constructor(code: CreatorBetaUnlockErrorCode, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function betaCustomerId(): string {
  return `beta_${randomUUID()}`;
}

export async function unlockCreatorBeta(params: {
  accountId?: string | null;
  email?: string;
  code: string;
  termsAccepted: boolean;
}) {
  if (!isCreatorBetaEnabled()) {
    throw new CreatorBetaUnlockError(
      "beta_paused",
      "Creator Beta access is temporarily paused.",
      503
    );
  }
  if (!params.termsAccepted) {
    throw new CreatorBetaUnlockError(
      "terms_required",
      "Accept the Creator Beta terms before unlocking access."
    );
  }

  const normalizedCode = normalizeCreatorBetaCode(params.code);
  if (!normalizedCode) {
    throw new CreatorBetaUnlockError(
      "invalid_or_expired",
      "That code is invalid or expired."
    );
  }

  const normalizedEmail = params.email
    ? normalizeLoginEmail(params.email)
    : null;
  if (!params.accountId && (!normalizedEmail || !normalizedEmail.includes("@"))) {
    throw new CreatorBetaUnlockError(
      "email_required",
      "Enter your email so this beta access can be attached to your account."
    );
  }

  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const code = await tx.creatorBetaCode.findUnique({
      where: { codeHash: hashCreatorBetaCode(normalizedCode) },
    });
    if (!code || !code.active || (code.expiresAt && code.expiresAt <= now)) {
      throw new CreatorBetaUnlockError(
        "invalid_or_expired",
        "That code is invalid or expired."
      );
    }
    if (code.usedAt || code.usedByAccountId) {
      throw new CreatorBetaUnlockError(
        "already_used",
        "That code has already been used."
      );
    }

    const existing = params.accountId
      ? await tx.billingAccount.findUnique({ where: { id: params.accountId } })
      : await tx.billingAccount.findFirst({
          where: { email: { equals: normalizedEmail!, mode: "insensitive" } },
          orderBy: { createdAt: "asc" },
        });

    const account = existing
      ? await tx.billingAccount.update({
          where: { id: existing.id },
          data: {
            email: normalizedEmail ?? existing.email,
            betaAccess: true,
            betaGrantedAt: now,
            lastSignedInAt: now,
            ...(!existing.unlimitedAccess && existing.status !== "active" && existing.status !== "trialing"
              ? { status: "beta", plan: "creator" }
              : {}),
          },
        })
      : await tx.billingAccount.create({
          data: {
            email: normalizedEmail,
            stripeCustomerId: betaCustomerId(),
            plan: "creator",
            status: "beta",
            betaAccess: true,
            betaGrantedAt: now,
            lastSignedInAt: now,
          },
        });

    const claimed = await tx.creatorBetaCode.updateMany({
      where: {
        id: code.id,
        active: true,
        usedAt: null,
        usedByAccountId: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      data: { usedAt: now, usedByAccountId: account.id },
    });
    if (claimed.count !== 1) {
      throw new CreatorBetaUnlockError(
        "already_used",
        "That code has already been used."
      );
    }

    return serializeBillingAccount(account);
  });
}

export async function getCreatorBetaStatus(accountId: string | null | undefined) {
  if (!accountId) return { active: false, account: null, usage: null };
  const account = await prisma.billingAccount.findUnique({ where: { id: accountId } });
  if (!account) return { active: false, account: null, usage: null };
  const active = account.betaAccess && isCreatorBetaEnabled();
  return {
    active,
    account: serializeBillingAccount(account),
    usage: active ? await getUsageSnapshot(account.id) : null,
  };
}

function generatePrivateCode(): string {
  const value = randomBytes(9).toString("base64url").toUpperCase();
  return `SCB-${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}`;
}

export async function createCreatorBetaCode(input: {
  name: string;
  expiresAt?: Date | null;
  notes?: string | null;
}) {
  const plainCode = generatePrivateCode();
  const item = await prisma.creatorBetaCode.create({
    data: {
      name: input.name.trim().slice(0, 100),
      codeHash: hashCreatorBetaCode(plainCode),
      codeHint: `SCB-...-${plainCode.slice(-4)}`,
      expiresAt: input.expiresAt ?? null,
      notes: input.notes?.trim().slice(0, 2000) || null,
    },
  });
  return { item, plainCode };
}

export async function listCreatorBetaCodes() {
  return prisma.creatorBetaCode.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      usedByAccount: { select: { id: true, email: true, displayName: true } },
    },
  });
}

export async function updateCreatorBetaCode(
  codeId: string,
  patch: { active?: boolean; expiresAt?: Date | null; notes?: string | null }
) {
  return prisma.creatorBetaCode.update({
    where: { id: codeId },
    data: {
      ...(typeof patch.active === "boolean" ? { active: patch.active } : {}),
      ...(patch.expiresAt !== undefined ? { expiresAt: patch.expiresAt } : {}),
      ...(patch.notes !== undefined
        ? { notes: patch.notes?.trim().slice(0, 2000) || null }
        : {}),
    },
  });
}

export function serializeCreatorBetaCode(
  item: Awaited<ReturnType<typeof listCreatorBetaCodes>>[number]
) {
  return {
    id: item.id,
    name: item.name,
    codeHint: item.codeHint,
    active: item.active,
    used: Boolean(item.usedAt || item.usedByAccountId),
    usedBy: item.usedByAccount
      ? {
          id: item.usedByAccount.id,
          email: item.usedByAccount.email,
          displayName: item.usedByAccount.displayName,
        }
      : null,
    usedAt: item.usedAt?.toISOString() ?? null,
    expiresAt: item.expiresAt?.toISOString() ?? null,
    notes: item.notes,
    createdAt: item.createdAt.toISOString(),
  };
}
