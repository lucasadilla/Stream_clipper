import type { OAuthConfig, OAuthUserConfig } from "next-auth/providers";

export interface KickProfile {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
}

/**
 * Kick OAuth 2 provider (https://docs.kick.com).
 * Requires AUTH_KICK_ID + AUTH_KICK_SECRET.
 */
export function KickProvider(
  options: OAuthUserConfig<KickProfile>
): OAuthConfig<KickProfile> {
  const { checks: _ignoredChecks, ...rest } = options;
  return {
    id: "kick",
    name: "Kick",
    type: "oauth",
    authorization: {
      url: "https://id.kick.com/oauth/authorize",
      params: {
        scope: "user:read",
        response_type: "code",
      },
    },
    token: "https://id.kick.com/oauth/token",
    userinfo: {
      url: "https://api.kick.com/public/v1/users",
      async request({
        tokens,
      }: {
        tokens: { access_token?: string };
      }) {
        const response = await fetch("https://api.kick.com/public/v1/users", {
          headers: {
            Authorization: `Bearer ${tokens.access_token}`,
            Accept: "application/json",
          },
        });
        if (!response.ok) {
          throw new Error(`Kick userinfo failed (${response.status})`);
        }
        const payload = (await response.json()) as {
          data?: Array<{
            user_id?: number | string;
            name?: string;
            email?: string;
            profile_picture?: string;
          }>;
        };
        const user = payload.data?.[0];
        if (!user?.user_id) {
          throw new Error("Kick userinfo returned no user");
        }
        return {
          id: String(user.user_id),
          name: user.name ?? null,
          email: user.email ?? null,
          image: user.profile_picture ?? null,
        } satisfies KickProfile;
      },
    },
    profile(profile) {
      return {
        id: profile.id,
        name: profile.name,
        email: profile.email,
        image: profile.image,
      };
    },
    style: { brandColor: "#53fc18" },
    ...rest,
    checks: ["pkce", "state"],
  };
}
