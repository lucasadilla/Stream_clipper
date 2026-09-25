import { createHmac, timingSafeEqual } from "crypto";
import type { NextResponse } from "next/server";
import {
  isOnboardingIntent,
  type OnboardingIntent,
} from "@/lib/onboardingIntent";

export const ONBOARDING_INTENT_COOKIE = "clipper_onboarding_intent";

function signingSecret(): string {
  const secret =
    process.env.AUTH_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET is required to protect onboarding state");
  }
  return "clipper-local-onboarding-secret";
}

function signature(payload: string): string {
  return createHmac("sha256", signingSecret()).update(payload).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function serializeOnboardingIntent(intent: OnboardingIntent): string {
  const payload = Buffer.from(JSON.stringify(intent)).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function parseOnboardingIntentCookie(
  value: string | null | undefined
): OnboardingIntent | null {
  if (!value) return null;
  const [payload, suppliedSignature, extra] = value.split(".");
  if (!payload || !suppliedSignature || extra) return null;
  if (!safeEqual(signature(payload), suppliedSignature)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return isOnboardingIntent(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function readOnboardingIntent(request: Request): OnboardingIntent | null {
  const cookie = request.headers.get("cookie") ?? "";
  const raw = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${ONBOARDING_INTENT_COOKIE}=`))
    ?.slice(ONBOARDING_INTENT_COOKIE.length + 1);
  return parseOnboardingIntentCookie(raw ? decodeURIComponent(raw) : null);
}

export function setOnboardingIntentCookie(
  response: NextResponse,
  intent: OnboardingIntent
): void {
  response.cookies.set(ONBOARDING_INTENT_COOKIE, serializeOnboardingIntent(intent), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });
}

export function clearOnboardingIntentCookie(response: NextResponse): void {
  response.cookies.set(ONBOARDING_INTENT_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}
