import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db";
import { authConfig } from "@/auth.config";
import { ensureBillingAccountForAuthUser } from "@/services/authAccountService";
import { verifyUserPassword } from "@/services/passwordAuthService";

class PasswordSignInError extends CredentialsSignin {
  constructor(message: string) {
    super(message);
    this.code = message;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    ...authConfig.providers,
    Credentials({
      id: "credentials",
      name: "Email",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = String(credentials?.email ?? "").trim();
        const password = String(credentials?.password ?? "");
        if (!email || !password) {
          throw new PasswordSignInError("Enter your email and password");
        }
        try {
          const user = await verifyUserPassword(email, password);
          if (!user) {
            throw new PasswordSignInError("Incorrect email or password");
          }
          return user;
        } catch (err) {
          if (err instanceof PasswordSignInError) throw err;
          throw new PasswordSignInError(
            err instanceof Error ? err.message : "Sign-in failed"
          );
        }
      },
    }),
  ],
  adapter: PrismaAdapter(prisma),
  // Credentials requires JWT sessions (Auth.js). OAuth still uses the adapter
  // for account linking; session rows are no longer the source of truth.
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },
  events: {
    async signIn({ user, account }) {
      if (!user.id) return;
      await ensureBillingAccountForAuthUser({
        userId: user.id,
        email: user.email,
        name: user.name,
        provider: account?.provider ?? "credentials",
        providerAccountId: account?.providerAccountId ?? user.id,
      });
    },
  },
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user }) {
      if (user?.id) {
        token.sub = user.id;
        if (user.email) token.email = user.email;
        if (user.name) token.name = user.name;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
        if (typeof token.email === "string") {
          session.user.email = token.email;
        }
        if (typeof token.name === "string") {
          session.user.name = token.name;
        }
      }
      return session;
    },
  },
});
