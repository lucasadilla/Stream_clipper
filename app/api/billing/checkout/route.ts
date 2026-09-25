import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import {
  createCheckoutSession,
} from "@/services/billingService";
import { ensureBillingAccountForAuthUser } from "@/services/authAccountService";
import { resolvePublicOrigin } from "@/lib/publicOrigin";
import { errorResponse, parseRequestJson } from "@/lib/utils";
import { mergeOnboardingIntent } from "@/lib/onboardingIntent";
import {
  readOnboardingIntent,
  setOnboardingIntentCookie,
} from "@/services/onboardingIntentService";

const checkoutSchema = z.object({
  planId: z.string().min(1),
  interval: z.enum(["monthly", "yearly"]).default("monthly"),
});

export async function POST(request: NextRequest) {
  try {
    const body = await parseRequestJson(request);
    if (!body) return errorResponse("Request body required", 400);
    const { planId, interval } = checkoutSchema.parse(body);
    const authSession = await auth();
    if (!authSession?.user?.id) {
      return NextResponse.json(
        { error: "Sign in before choosing a plan", loginUrl: "/login" },
        { status: 401 }
      );
    }
    const account = await ensureBillingAccountForAuthUser({
      userId: authSession.user.id,
      email: authSession.user.email,
      name: authSession.user.name,
      provider: "session",
      providerAccountId: authSession.user.id,
    });
    const intent = mergeOnboardingIntent(readOnboardingIntent(request), {
      planId,
      interval,
    });
    const session = await createCheckoutSession({
      planId,
      interval,
      origin: resolvePublicOrigin(request),
      customerEmail: account.email,
      billingAccountId: account.id,
      workflow: intent.workflow,
      attribution: intent.attribution,
    });
    const response = NextResponse.json({ url: session.url });
    setOnboardingIntentCookie(response, intent);
    return response;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        error.errors[0]?.message ?? "Invalid checkout request",
        400
      );
    }
    const message =
      error instanceof Error ? error.message : "Failed to start checkout";
    return errorResponse(message, 500);
  }
}
