import type { Prisma } from "@prisma/client";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import {
  allPlatformCapabilities,
  canConnectPlatform,
  capabilityBanner,
  capabilityLabel,
  getPlatformCapability,
} from "@/lib/social/capabilities";
import type { SocialPlatform } from "@/lib/social/types";
import { SOCIAL_PLATFORMS, isSocialPlatform } from "@/lib/social/types";
import { encryptSecret } from "@/lib/social/tokenCrypto";
import {
  clearAccountTokens,
  getDecryptedTokens,
  storeAccountTokens,
  tokensExpireSoon,
} from "@/services/socialTokenService";
import { getSocialPublisher } from "@/services/social/publishers";
import {
  buildYouTubeAuthUrl,
  createPkcePair,
  exchangeYouTubeCode,
  fetchYouTubeChannel,
  refreshYouTubeAccessToken,
  youtubeOAuthConfigured,
} from "@/services/social/publishers/youtubePublisher";
import {
  buildXAuthUrl,
  exchangeXCode,
  fetchXUser,
  refreshXAccessToken,
  xOAuthConfigured,
} from "@/services/social/publishers/xPublisher";
import {
  buildTikTokAuthUrl,
  exchangeTikTokCode,
  fetchTikTokUser,
  refreshTikTokAccessToken,
  tiktokOAuthConfigured,
} from "@/services/social/publishers/tiktokPublisher";
import {
  buildMetaAuthUrl,
  exchangeMetaCode,
  fetchInstagramProfile,
  fetchMetaPages,
  metaOAuthConfigured,
} from "@/services/social/publishers/metaOAuth";
import { hashOAuthState } from "@/lib/social/oauth";

function hashState(state: string) {
  return hashOAuthState(state);
}

function oauthConfigured(platform: SocialPlatform): boolean {
  if (platform === "youtube") return youtubeOAuthConfigured();
  if (platform === "x") return xOAuthConfigured();
  if (platform === "tiktok") return tiktokOAuthConfigured();
  if (platform === "instagram" || platform === "facebook") {
    return metaOAuthConfigured();
  }
  return false;
}

export function serializeConnectedAccount(account: {
  id: string;
  platform: string;
  platformAccountId: string;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  isActive: boolean;
  isDefault: boolean;
  lastValidatedAt: Date | null;
  connectionError: string | null;
  createdAt: Date;
  tokenExpiresAt: Date | null;
  grantedScopes: string | null;
}) {
  const platform = account.platform as SocialPlatform;
  const capability = getPlatformCapability(platform);
  return {
    id: account.id,
    platform,
    platformAccountId: account.platformAccountId,
    displayName: account.displayName,
    username: account.username,
    avatarUrl: account.avatarUrl,
    isActive: account.isActive,
    isDefault: account.isDefault,
    lastValidatedAt: account.lastValidatedAt?.toISOString() ?? null,
    connectionError: account.connectionError,
    connectedAt: account.createdAt.toISOString(),
    tokenExpiresAt: account.tokenExpiresAt?.toISOString() ?? null,
    health:
      !account.isActive
        ? "disconnected"
        : account.connectionError
          ? "error"
          : tokensExpireSoon(account.tokenExpiresAt)
            ? "expiring"
            : "healthy",
    capability,
    capabilityLabel: capabilityLabel(capability),
    capabilityBanner: capabilityBanner(platform),
    scopesConfigured: Boolean(account.grantedScopes),
  };
}

export async function listConnectedAccounts(userId: string) {
  const accounts = await prisma.connectedSocialAccount.findMany({
    where: { userId },
    orderBy: [{ platform: "asc" }, { isDefault: "desc" }, { createdAt: "asc" }],
  });
  return accounts.map(serializeConnectedAccount);
}

export async function getConnectedAccountsOverview(userId: string) {
  const accounts = await listConnectedAccounts(userId);
  const capabilities = allPlatformCapabilities();
  return {
    platforms: SOCIAL_PLATFORMS.map((platform) => ({
      platform,
      capability: capabilities[platform],
      capabilityLabel: capabilityLabel(capabilities[platform]),
      capabilityBanner: capabilityBanner(platform),
      canConnect: canConnectPlatform(platform) && oauthConfigured(platform),
      accounts: accounts.filter((a) => a.platform === platform && a.isActive),
    })),
  };
}

export async function beginOAuthConnect(options: {
  userId: string;
  platform: SocialPlatform;
  redirectAfter?: string | null;
}): Promise<{ url: string }> {
  if (!isSocialPlatform(options.platform)) {
    throw new Error("Unsupported platform");
  }
  if (!canConnectPlatform(options.platform)) {
    throw new Error(`${options.platform} publishing is not available`);
  }
  if (!oauthConfigured(options.platform)) {
    throw new Error(
      `${options.platform} OAuth is not configured (missing client credentials)`
    );
  }
  if (
    options.platform !== "youtube" &&
    options.platform !== "x" &&
    options.platform !== "tiktok" &&
    options.platform !== "instagram" &&
    options.platform !== "facebook"
  ) {
    throw new Error(`${options.platform} OAuth is not available yet`);
  }

  const state = randomBytes(24).toString("base64url");
  const { verifier, challenge } = createPkcePair();
  await prisma.socialOAuthState.create({
    data: {
      userId: options.userId,
      platform: options.platform,
      stateHash: hashState(state),
      codeVerifier:
        options.platform === "youtube" ||
        options.platform === "x" ||
        options.platform === "tiktok"
          ? verifier
          : null,
      redirectAfter: options.redirectAfter || "/settings/connected-accounts",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  if (options.platform === "youtube") {
    return { url: buildYouTubeAuthUrl({ state, codeChallenge: challenge }) };
  }
  if (options.platform === "x") {
    return { url: buildXAuthUrl({ state, codeChallenge: challenge }) };
  }
  if (options.platform === "tiktok") {
    return { url: buildTikTokAuthUrl({ state, codeChallenge: challenge }) };
  }
  return {
    url: buildMetaAuthUrl({
      state,
      platform: options.platform,
    }),
  };
}

export async function completeYouTubeOAuth(options: {
  state: string;
  code: string;
}): Promise<{ redirectAfter: string; accountId: string }> {
  const stateHash = hashState(options.state);
  const record = await prisma.socialOAuthState.findUnique({
    where: { stateHash },
  });
  if (!record || record.consumedAt || record.expiresAt < new Date()) {
    throw new Error("Invalid or expired OAuth state");
  }
  if (record.platform !== "youtube" || !record.codeVerifier) {
    throw new Error("Invalid OAuth session");
  }

  await prisma.socialOAuthState.update({
    where: { id: record.id },
    data: { consumedAt: new Date() },
  });

  const tokens = await exchangeYouTubeCode({
    code: options.code,
    codeVerifier: record.codeVerifier,
  });
  const channel = await fetchYouTubeChannel(tokens.accessToken);

  const existingDefault = await prisma.connectedSocialAccount.findFirst({
    where: {
      userId: record.userId,
      platform: "youtube",
      isActive: true,
      isDefault: true,
    },
  });

  const account = await prisma.connectedSocialAccount.upsert({
    where: {
      userId_platform_platformAccountId: {
        userId: record.userId,
        platform: "youtube",
        platformAccountId: channel.platformAccountId,
      },
    },
    create: {
      userId: record.userId,
      platform: "youtube",
      platformAccountId: channel.platformAccountId,
      displayName: channel.displayName,
      username: channel.username,
      avatarUrl: channel.avatarUrl,
      encryptedAccessToken: encryptSecret(tokens.accessToken),
      encryptedRefreshToken: tokens.refreshToken
        ? encryptSecret(tokens.refreshToken)
        : null,
      tokenExpiresAt: tokens.expiresAt,
      grantedScopes: tokens.scope,
      accountMetadata: channel.metadata as Prisma.InputJsonValue,
      isActive: true,
      isDefault: !existingDefault,
      lastValidatedAt: new Date(),
      connectionError: null,
    },
    update: {
      displayName: channel.displayName,
      username: channel.username,
      avatarUrl: channel.avatarUrl,
      encryptedAccessToken: encryptSecret(tokens.accessToken),
      encryptedRefreshToken: tokens.refreshToken
        ? encryptSecret(tokens.refreshToken)
        : undefined,
      tokenExpiresAt: tokens.expiresAt,
      grantedScopes: tokens.scope,
      accountMetadata: channel.metadata as Prisma.InputJsonValue,
      isActive: true,
      lastValidatedAt: new Date(),
      connectionError: null,
    },
  });

  return {
    redirectAfter: record.redirectAfter || "/settings/connected-accounts",
    accountId: account.id,
  };
}

export async function completeXOauth(options: {
  state: string;
  code: string;
}): Promise<{ redirectAfter: string; accountId: string }> {
  const stateHash = hashState(options.state);
  const record = await prisma.socialOAuthState.findUnique({
    where: { stateHash },
  });
  if (!record || record.consumedAt || record.expiresAt < new Date()) {
    throw new Error("Invalid or expired OAuth state");
  }
  if (record.platform !== "x" || !record.codeVerifier) {
    throw new Error("Invalid OAuth session");
  }
  await prisma.socialOAuthState.update({
    where: { id: record.id },
    data: { consumedAt: new Date() },
  });

  const tokens = await exchangeXCode({
    code: options.code,
    codeVerifier: record.codeVerifier,
  });
  const user = await fetchXUser(tokens.accessToken);

  const existingDefault = await prisma.connectedSocialAccount.findFirst({
    where: {
      userId: record.userId,
      platform: "x",
      isActive: true,
      isDefault: true,
    },
  });

  const account = await prisma.connectedSocialAccount.upsert({
    where: {
      userId_platform_platformAccountId: {
        userId: record.userId,
        platform: "x",
        platformAccountId: user.platformAccountId,
      },
    },
    create: {
      userId: record.userId,
      platform: "x",
      platformAccountId: user.platformAccountId,
      displayName: user.displayName,
      username: user.username,
      avatarUrl: user.avatarUrl,
      encryptedAccessToken: encryptSecret(tokens.accessToken),
      encryptedRefreshToken: tokens.refreshToken
        ? encryptSecret(tokens.refreshToken)
        : null,
      tokenExpiresAt: tokens.expiresAt,
      grantedScopes: tokens.scope,
      accountMetadata: {
        ...user.metadata,
        username: user.username,
      } as Prisma.InputJsonValue,
      isActive: true,
      isDefault: !existingDefault,
      lastValidatedAt: new Date(),
      connectionError: null,
    },
    update: {
      displayName: user.displayName,
      username: user.username,
      avatarUrl: user.avatarUrl,
      encryptedAccessToken: encryptSecret(tokens.accessToken),
      encryptedRefreshToken: tokens.refreshToken
        ? encryptSecret(tokens.refreshToken)
        : undefined,
      tokenExpiresAt: tokens.expiresAt,
      grantedScopes: tokens.scope,
      accountMetadata: {
        ...user.metadata,
        username: user.username,
      } as Prisma.InputJsonValue,
      isActive: true,
      lastValidatedAt: new Date(),
      connectionError: null,
    },
  });

  return {
    redirectAfter: record.redirectAfter || "/settings/connected-accounts",
    accountId: account.id,
  };
}

export async function completeTikTokOAuth(options: {
  state: string;
  code: string;
}): Promise<{ redirectAfter: string; accountId: string }> {
  const stateHash = hashState(options.state);
  const record = await prisma.socialOAuthState.findUnique({
    where: { stateHash },
  });
  if (!record || record.consumedAt || record.expiresAt < new Date()) {
    throw new Error("Invalid or expired OAuth state");
  }
  if (record.platform !== "tiktok" || !record.codeVerifier) {
    throw new Error("Invalid OAuth session");
  }
  await prisma.socialOAuthState.update({
    where: { id: record.id },
    data: { consumedAt: new Date() },
  });

  const tokens = await exchangeTikTokCode({
    code: options.code,
    codeVerifier: record.codeVerifier,
  });
  let user: Awaited<ReturnType<typeof fetchTikTokUser>>;
  try {
    user = await fetchTikTokUser(tokens.accessToken);
  } catch {
    user = {
      platformAccountId: tokens.openId,
      displayName: "TikTok",
      username: null,
      avatarUrl: null,
      metadata: { openId: tokens.openId },
    };
  }
  if (user.platformAccountId !== tokens.openId) {
    user = {
      ...user,
      platformAccountId: tokens.openId,
      metadata: { ...user.metadata, openId: tokens.openId },
    };
  }

  const existingDefault = await prisma.connectedSocialAccount.findFirst({
    where: {
      userId: record.userId,
      platform: "tiktok",
      isActive: true,
      isDefault: true,
    },
  });

  const account = await prisma.connectedSocialAccount.upsert({
    where: {
      userId_platform_platformAccountId: {
        userId: record.userId,
        platform: "tiktok",
        platformAccountId: tokens.openId,
      },
    },
    create: {
      userId: record.userId,
      platform: "tiktok",
      platformAccountId: tokens.openId,
      displayName: user.displayName,
      username: user.username,
      avatarUrl: user.avatarUrl,
      encryptedAccessToken: encryptSecret(tokens.accessToken),
      encryptedRefreshToken: tokens.refreshToken
        ? encryptSecret(tokens.refreshToken)
        : null,
      tokenExpiresAt: tokens.expiresAt,
      grantedScopes: tokens.scope,
      accountMetadata: {
        ...user.metadata,
        username: user.username,
        openId: tokens.openId,
      } as Prisma.InputJsonValue,
      isActive: true,
      isDefault: !existingDefault,
      lastValidatedAt: new Date(),
      connectionError: null,
    },
    update: {
      displayName: user.displayName,
      username: user.username,
      avatarUrl: user.avatarUrl,
      encryptedAccessToken: encryptSecret(tokens.accessToken),
      encryptedRefreshToken: tokens.refreshToken
        ? encryptSecret(tokens.refreshToken)
        : undefined,
      tokenExpiresAt: tokens.expiresAt,
      grantedScopes: tokens.scope,
      accountMetadata: {
        ...user.metadata,
        username: user.username,
        openId: tokens.openId,
      } as Prisma.InputJsonValue,
      isActive: true,
      lastValidatedAt: new Date(),
      connectionError: null,
    },
  });

  return {
    redirectAfter: record.redirectAfter || "/settings/connected-accounts",
    accountId: account.id,
  };
}

export async function completeMetaOAuth(options: {
  state: string;
  code: string;
  platform: "facebook" | "instagram";
}): Promise<{ redirectAfter: string; accountIds: string[] }> {
  const stateHash = hashState(options.state);
  const record = await prisma.socialOAuthState.findUnique({
    where: { stateHash },
  });
  if (!record || record.consumedAt || record.expiresAt < new Date()) {
    throw new Error("Invalid or expired OAuth state");
  }
  if (record.platform !== options.platform) {
    throw new Error("Invalid OAuth session");
  }
  await prisma.socialOAuthState.update({
    where: { id: record.id },
    data: { consumedAt: new Date() },
  });

  const tokens = await exchangeMetaCode({
    code: options.code,
    platform: options.platform,
  });
  const pages = await fetchMetaPages(tokens.accessToken);
  if (!pages.length) {
    throw new Error(
      "No Facebook Pages found. Create or get access to a Page, then reconnect."
    );
  }

  const accountIds: string[] = [];

  if (options.platform === "facebook") {
    const existingDefault = await prisma.connectedSocialAccount.findFirst({
      where: {
        userId: record.userId,
        platform: "facebook",
        isActive: true,
        isDefault: true,
      },
    });
    let madeDefault = Boolean(existingDefault);

    for (const page of pages) {
      const account = await prisma.connectedSocialAccount.upsert({
        where: {
          userId_platform_platformAccountId: {
            userId: record.userId,
            platform: "facebook",
            platformAccountId: page.id,
          },
        },
        create: {
          userId: record.userId,
          platform: "facebook",
          platformAccountId: page.id,
          displayName: page.name,
          username: page.name,
          avatarUrl: null,
          encryptedAccessToken: encryptSecret(page.access_token),
          encryptedRefreshToken: encryptSecret(tokens.accessToken),
          tokenExpiresAt: tokens.expiresAt,
          grantedScopes: null,
          accountMetadata: {
            pageId: page.id,
            pageName: page.name,
          } as Prisma.InputJsonValue,
          isActive: true,
          isDefault: !madeDefault,
          lastValidatedAt: new Date(),
          connectionError: null,
        },
        update: {
          displayName: page.name,
          username: page.name,
          encryptedAccessToken: encryptSecret(page.access_token),
          encryptedRefreshToken: encryptSecret(tokens.accessToken),
          tokenExpiresAt: tokens.expiresAt,
          accountMetadata: {
            pageId: page.id,
            pageName: page.name,
          } as Prisma.InputJsonValue,
          isActive: true,
          lastValidatedAt: new Date(),
          connectionError: null,
        },
      });
      if (!madeDefault) madeDefault = true;
      accountIds.push(account.id);
    }
  } else {
    const igPages = pages.filter((page) => page.instagram_business_account?.id);
    if (!igPages.length) {
      throw new Error(
        "No Instagram professional accounts linked to your Pages were found."
      );
    }
    const existingDefault = await prisma.connectedSocialAccount.findFirst({
      where: {
        userId: record.userId,
        platform: "instagram",
        isActive: true,
        isDefault: true,
      },
    });
    let madeDefault = Boolean(existingDefault);

    for (const page of igPages) {
      const igId = page.instagram_business_account!.id;
      const profile = await fetchInstagramProfile(igId, page.access_token);
      const account = await prisma.connectedSocialAccount.upsert({
        where: {
          userId_platform_platformAccountId: {
            userId: record.userId,
            platform: "instagram",
            platformAccountId: igId,
          },
        },
        create: {
          userId: record.userId,
          platform: "instagram",
          platformAccountId: igId,
          displayName: profile.name || profile.username || "Instagram",
          username: profile.username ? `@${profile.username}` : null,
          avatarUrl: profile.profilePictureUrl,
          encryptedAccessToken: encryptSecret(page.access_token),
          encryptedRefreshToken: encryptSecret(tokens.accessToken),
          tokenExpiresAt: tokens.expiresAt,
          grantedScopes: null,
          accountMetadata: {
            igUserId: igId,
            pageId: page.id,
            pageName: page.name,
            username: profile.username,
          } as Prisma.InputJsonValue,
          isActive: true,
          isDefault: !madeDefault,
          lastValidatedAt: new Date(),
          connectionError: null,
        },
        update: {
          displayName: profile.name || profile.username || "Instagram",
          username: profile.username ? `@${profile.username}` : null,
          avatarUrl: profile.profilePictureUrl,
          encryptedAccessToken: encryptSecret(page.access_token),
          encryptedRefreshToken: encryptSecret(tokens.accessToken),
          tokenExpiresAt: tokens.expiresAt,
          accountMetadata: {
            igUserId: igId,
            pageId: page.id,
            pageName: page.name,
            username: profile.username,
          } as Prisma.InputJsonValue,
          isActive: true,
          lastValidatedAt: new Date(),
          connectionError: null,
        },
      });
      if (!madeDefault) madeDefault = true;
      accountIds.push(account.id);
    }
  }

  return {
    redirectAfter: record.redirectAfter || "/settings/connected-accounts",
    accountIds,
  };
}

export async function disconnectAccount(userId: string, accountId: string) {
  const account = await prisma.connectedSocialAccount.findFirst({
    where: { id: accountId, userId },
  });
  if (!account) throw new Error("Account not found");
  await clearAccountTokens(account.id);
  await prisma.connectedSocialAccount.update({
    where: { id: account.id },
    data: { isActive: false, isDefault: false, connectionError: "Disconnected" },
  });
}

export async function setDefaultAccount(userId: string, accountId: string) {
  const account = await prisma.connectedSocialAccount.findFirst({
    where: { id: accountId, userId, isActive: true },
  });
  if (!account) throw new Error("Account not found");
  await prisma.$transaction([
    prisma.connectedSocialAccount.updateMany({
      where: { userId, platform: account.platform, isDefault: true },
      data: { isDefault: false },
    }),
    prisma.connectedSocialAccount.update({
      where: { id: account.id },
      data: { isDefault: true },
    }),
  ]);
}

export async function getPublisherContext(accountId: string) {
  const tokens = await getDecryptedTokens(accountId);
  if (!tokens) {
    throw Object.assign(new Error("Social account is disconnected"), {
      code: "needs_reauth",
    });
  }

  let accessToken = tokens.accessToken;
  if (tokensExpireSoon(tokens.expiresAt) && tokens.refreshToken) {
    if (tokens.platform === "youtube") {
      try {
        const refreshed = await refreshYouTubeAccessToken(tokens.refreshToken);
        await storeAccountTokens({
          accountId,
          accessToken: refreshed.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: refreshed.expiresAt,
          scopes: refreshed.scope,
        });
        accessToken = refreshed.accessToken;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Token refresh failed";
        await prisma.connectedSocialAccount.update({
          where: { id: accountId },
          data: { connectionError: message },
        });
        throw Object.assign(new Error("Your YouTube connection needs to be renewed."), {
          code: "needs_reauth",
        });
      }
    } else if (tokens.platform === "x") {
      try {
        const refreshed = await refreshXAccessToken(tokens.refreshToken);
        await storeAccountTokens({
          accountId,
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          expiresAt: refreshed.expiresAt,
          scopes: refreshed.scope,
        });
        accessToken = refreshed.accessToken;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Token refresh failed";
        await prisma.connectedSocialAccount.update({
          where: { id: accountId },
          data: { connectionError: message },
        });
        throw Object.assign(new Error("Your X connection needs to be renewed."), {
          code: "needs_reauth",
        });
      }
    } else if (tokens.platform === "tiktok") {
      try {
        const refreshed = await refreshTikTokAccessToken(tokens.refreshToken);
        await storeAccountTokens({
          accountId,
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          expiresAt: refreshed.expiresAt,
          scopes: refreshed.scope,
        });
        accessToken = refreshed.accessToken;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Token refresh failed";
        await prisma.connectedSocialAccount.update({
          where: { id: accountId },
          data: { connectionError: message },
        });
        throw Object.assign(
          new Error("Your TikTok connection needs to be renewed."),
          { code: "needs_reauth" }
        );
      }
    }
  }

  return {
    accessToken,
    refreshToken: tokens.refreshToken,
    accountMetadata: tokens.accountMetadata,
    platform: tokens.platform,
  };
}

export async function validateConnectedAccount(userId: string, accountId: string) {
  const account = await prisma.connectedSocialAccount.findFirst({
    where: { id: accountId, userId, isActive: true },
  });
  if (!account) throw new Error("Account not found");
  const ctx = await getPublisherContext(accountId);
  const publisher = getSocialPublisher(account.platform as SocialPlatform);
  const result = await publisher.validateConnection(ctx);
  await prisma.connectedSocialAccount.update({
    where: { id: accountId },
    data: {
      lastValidatedAt: new Date(),
      connectionError: result.ok ? null : result.error || "Validation failed",
      displayName: result.displayName || undefined,
      username: result.username || undefined,
      avatarUrl: result.avatarUrl || undefined,
    },
  });
  return result;
}

export async function listDestinations(userId: string, accountId: string) {
  const account = await prisma.connectedSocialAccount.findFirst({
    where: { id: accountId, userId, isActive: true },
  });
  if (!account) throw new Error("Account not found");
  const ctx = await getPublisherContext(accountId);
  return getSocialPublisher(account.platform as SocialPlatform).getDestinations(ctx);
}
