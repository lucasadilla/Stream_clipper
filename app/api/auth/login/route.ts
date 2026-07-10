import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { BILLING_ACCOUNT_COOKIE } from "@/lib/stripe";
import { loginWithEmail } from "@/services/accessService";
import { errorResponse, parseRequestJson } from "@/lib/utils";
import { getPostHogClient } from "@/lib/posthog-server";

const loginSchema = z.object({
  email: z.string().email(),
  inviteCode: z.string().optional(),
});

function setBillingCookie(response: NextResponse, accountId: string) {
  response.cookies.set(BILLING_ACCOUNT_COOKIE, accountId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await parseRequestJson(request);
    if (!body) return errorResponse("Request body required", 400);
    const { email, inviteCode } = loginSchema.parse(body);
    const result = await loginWithEmail({ email, inviteCode });

    const posthog = getPostHogClient();
    posthog.identify({
      distinctId: result.account.id,
      properties: {
        email: result.account.email,
        unlimited_access: result.unlimitedAccess,
      },
    });

    const response = NextResponse.json({
      account: result.account,
      unlimitedAccess: result.unlimitedAccess,
    });
    setBillingCookie(response, result.account.id);
    return response;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(error.errors[0]?.message ?? "Invalid login", 400);
    }
    const message = error instanceof Error ? error.message : "Login failed";
    return errorResponse(message, 400);
  }
}
