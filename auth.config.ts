import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import Twitch from "next-auth/providers/twitch";
import Resend from "next-auth/providers/resend";
import { KickProvider } from "@/lib/auth/kickProvider";

/**
 * Edge-safe Auth.js config (providers + pages).
 * DB adapter + events live in auth.ts (Node runtime).
 */
export const authConfig = {
  pages: {
    signIn: "/login",
    error: "/login",
    verifyRequest: "/login/verify",
  },
  providers: [
    ...(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET
      ? [
          Google({
            clientId: process.env.AUTH_GOOGLE_ID,
            clientSecret: process.env.AUTH_GOOGLE_SECRET,
            allowDangerousEmailAccountLinking: true,
          }),
        ]
      : []),
    ...(process.env.AUTH_TWITCH_ID && process.env.AUTH_TWITCH_SECRET
      ? [
          Twitch({
            clientId: process.env.AUTH_TWITCH_ID,
            clientSecret: process.env.AUTH_TWITCH_SECRET,
            allowDangerousEmailAccountLinking: true,
          }),
        ]
      : []),
    ...(process.env.AUTH_KICK_ID && process.env.AUTH_KICK_SECRET
      ? [
          KickProvider({
            clientId: process.env.AUTH_KICK_ID,
            clientSecret: process.env.AUTH_KICK_SECRET,
            allowDangerousEmailAccountLinking: true,
          }),
        ]
      : []),
    ...(process.env.AUTH_RESEND_KEY
      ? [
          Resend({
            apiKey: process.env.AUTH_RESEND_KEY,
            from:
              process.env.AUTH_EMAIL_FROM?.trim() ||
              "Clipper <login@streamclipper.stream>",
          }),
        ]
      : []),
  ],
  callbacks: {
    authorized() {
      return true;
    },
  },
  trustHost: true,
} satisfies NextAuthConfig;

export function listConfiguredAuthProviders(): Array<{
  id: string;
  name: string;
}> {
  const providers: Array<{ id: string; name: string }> = [];
  if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
    providers.push({ id: "google", name: "Google" });
  }
  if (process.env.AUTH_TWITCH_ID && process.env.AUTH_TWITCH_SECRET) {
    providers.push({ id: "twitch", name: "Twitch" });
  }
  if (process.env.AUTH_KICK_ID && process.env.AUTH_KICK_SECRET) {
    providers.push({ id: "kick", name: "Kick" });
  }
  if (process.env.AUTH_RESEND_KEY) {
    providers.push({ id: "resend", name: "Email" });
  }
  return providers;
}
