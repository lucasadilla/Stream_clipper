import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db";
import { authConfig } from "@/auth.config";
import { ensureBillingAccountForAuthUser } from "@/services/authAccountService";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  events: {
    async signIn({ user, account }) {
      if (!user.id) return;
      await ensureBillingAccountForAuthUser({
        userId: user.id,
        email: user.email,
        name: user.name,
        provider: account?.provider ?? null,
        providerAccountId: account?.providerAccountId ?? null,
      });
    },
  },
  callbacks: {
    ...authConfig.callbacks,
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
      }
      return session;
    },
  },
});
