import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/social/tokenCrypto";
import type { SocialPlatform } from "@/lib/social/types";

export async function storeAccountTokens(options: {
  accountId: string;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  scopes?: string | null;
}) {
  await prisma.connectedSocialAccount.update({
    where: { id: options.accountId },
    data: {
      encryptedAccessToken: encryptSecret(options.accessToken),
      encryptedRefreshToken: options.refreshToken
        ? encryptSecret(options.refreshToken)
        : undefined,
      tokenExpiresAt: options.expiresAt ?? undefined,
      grantedScopes: options.scopes ?? undefined,
      connectionError: null,
      lastValidatedAt: new Date(),
    },
  });
}

export async function getDecryptedTokens(accountId: string): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  platform: SocialPlatform;
  accountMetadata: Record<string, unknown> | null;
} | null> {
  const account = await prisma.connectedSocialAccount.findUnique({
    where: { id: accountId },
    select: {
      encryptedAccessToken: true,
      encryptedRefreshToken: true,
      tokenExpiresAt: true,
      platform: true,
      accountMetadata: true,
      isActive: true,
    },
  });
  if (!account || !account.isActive) return null;

  return {
    accessToken: decryptSecret(account.encryptedAccessToken),
    refreshToken: account.encryptedRefreshToken
      ? decryptSecret(account.encryptedRefreshToken)
      : null,
    expiresAt: account.tokenExpiresAt,
    platform: account.platform as SocialPlatform,
    accountMetadata:
      account.accountMetadata && typeof account.accountMetadata === "object"
        ? (account.accountMetadata as Record<string, unknown>)
        : null,
  };
}

export async function clearAccountTokens(accountId: string) {
  await prisma.connectedSocialAccount.update({
    where: { id: accountId },
    data: {
      encryptedAccessToken: encryptSecret(""),
      encryptedRefreshToken: null,
      tokenExpiresAt: null,
      isActive: false,
      connectionError: "Disconnected",
    },
  });
}

export function tokensExpireSoon(expiresAt: Date | null | undefined, skewMs = 120_000) {
  if (!expiresAt) return false;
  return expiresAt.getTime() <= Date.now() + skewMs;
}
