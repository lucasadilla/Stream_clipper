import { prisma } from "@/lib/db";
import { normalizeLoginEmail } from "@/lib/accessConfig";
import {
  hashPassword,
  passwordsMatch,
  validatePasswordStrength,
} from "@/lib/password";

export type EmailAuthStatus = {
  exists: boolean;
  hasPassword: boolean;
  oauthProviders: string[];
};

export async function getEmailAuthStatus(
  rawEmail: string
): Promise<EmailAuthStatus> {
  const email = normalizeLoginEmail(rawEmail);
  if (!email.includes("@")) {
    return { exists: false, hasPassword: false, oauthProviders: [] };
  }

  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: {
      passwordHash: true,
      accounts: { select: { provider: true } },
    },
  });

  if (!user) {
    return { exists: false, hasPassword: false, oauthProviders: [] };
  }

  return {
    exists: true,
    hasPassword: Boolean(user.passwordHash),
    oauthProviders: user.accounts
      .map((a) => a.provider)
      .filter((p) => p !== "credentials"),
  };
}

export async function verifyUserPassword(
  rawEmail: string,
  password: string
): Promise<{ id: string; email: string; name?: string | null } | null> {
  const email = normalizeLoginEmail(rawEmail);
  if (!email.includes("@") || !password) return null;

  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: {
      id: true,
      email: true,
      name: true,
      passwordHash: true,
      accounts: { select: { provider: true } },
    },
  });

  if (!user?.email) return null;

  if (!user.passwordHash) {
    const providers = user.accounts
      .map((a) => a.provider)
      .filter((p) => p !== "resend" && p !== "credentials");
    if (providers.length > 0) {
      throw new Error(
        `This email uses ${providers.map(prettyProvider).join(" / ")}. Continue with that button instead — or create a password after signing in.`
      );
    }
    throw new Error(
      "This account has no password yet. Use “Email me a magic link” once, then you can set a password — or create a new password below by registering."
    );
  }

  const ok = await passwordsMatch(password, user.passwordHash);
  if (!ok) return null;

  return { id: user.id, email: user.email, name: user.name };
}

export async function registerWithPassword(params: {
  email: string;
  password: string;
  name?: string;
}): Promise<{ id: string; email: string; name?: string | null }> {
  const email = normalizeLoginEmail(params.email);
  if (!email.includes("@")) {
    throw new Error("Enter a valid email address");
  }

  const strengthError = validatePasswordStrength(params.password);
  if (strengthError) throw new Error(strengthError);

  const existing = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: {
      id: true,
      email: true,
      name: true,
      passwordHash: true,
      accounts: { select: { provider: true } },
    },
  });

  const passwordHash = await hashPassword(params.password);

  if (existing) {
    if (existing.passwordHash) {
      throw new Error("An account with this email already exists. Sign in instead.");
    }
    // OAuth / magic-link user adding a password
    const updated = await prisma.user.update({
      where: { id: existing.id },
      data: {
        passwordHash,
        emailVerified: existing.email ? new Date() : new Date(),
        name: params.name?.trim() || existing.name,
      },
      select: { id: true, email: true, name: true },
    });
    if (!updated.email) throw new Error("Account is missing an email");
    return {
      id: updated.id,
      email: updated.email,
      name: updated.name,
    };
  }

  const created = await prisma.user.create({
    data: {
      email,
      name: params.name?.trim() || null,
      passwordHash,
      emailVerified: new Date(),
    },
    select: { id: true, email: true, name: true },
  });

  if (!created.email) throw new Error("Failed to create account");
  return {
    id: created.id,
    email: created.email,
    name: created.name,
  };
}

function prettyProvider(provider: string): string {
  if (provider === "google") return "Google";
  if (provider === "twitch") return "Twitch";
  if (provider === "kick") return "Kick";
  return provider;
}
