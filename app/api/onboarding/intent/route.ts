import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  mergeOnboardingIntent,
  onboardingIntentInputSchema,
} from "@/lib/onboardingIntent";
import {
  clearOnboardingIntentCookie,
  readOnboardingIntent,
  setOnboardingIntentCookie,
} from "@/services/onboardingIntentService";
import { errorResponse } from "@/lib/utils";

export async function GET(request: NextRequest) {
  return NextResponse.json({ intent: readOnboardingIntent(request) });
}

export async function POST(request: NextRequest) {
  try {
    const input = onboardingIntentInputSchema.parse(await request.json());
    const intent = mergeOnboardingIntent(readOnboardingIntent(request), input);
    const response = NextResponse.json({ intent });
    setOnboardingIntentCookie(response, intent);
    return response;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(error.errors[0]?.message ?? "Invalid onboarding details", 400);
    }
    return errorResponse(
      error instanceof Error ? error.message : "Could not save your progress",
      400
    );
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  clearOnboardingIntentCookie(response);
  return response;
}
