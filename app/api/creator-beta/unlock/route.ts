import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { BILLING_ACCOUNT_COOKIE } from "@/lib/stripe";
import { ensureBillingAccountForAuthUser } from "@/services/authAccountService";
import {
  CreatorBetaUnlockError,
  unlockCreatorBeta,
} from "@/services/creatorBetaService";
import { errorResponse } from "@/lib/utils";

const unlockSchema = z.object({
  code: z.string().min(1),
  termsAccepted: z.literal(true),
});

export async function POST(request: NextRequest) {
  try {
    const input = unlockSchema.parse(await request.json());
    const session = await auth();
    if (!session?.user?.id) {
      return errorResponse("Sign in before unlocking Creator Beta access.", 401);
    }
    const signedInAccount = await ensureBillingAccountForAuthUser({
      userId: session.user.id,
      email: session.user.email,
      name: session.user.name,
      provider: "session",
      providerAccountId: session.user.id,
    });
    const account = await unlockCreatorBeta({
      accountId: signedInAccount.id,
      code: input.code,
      termsAccepted: input.termsAccepted,
    });
    const response = NextResponse.json({
      account,
      success: true,
      message:
        "Creator Beta unlocked. You have 25 free videos for the next 30 days.",
    });
    response.cookies.set(BILLING_ACCOUNT_COOKIE, account.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
    return response;
  } catch (error) {
    if (error instanceof CreatorBetaUnlockError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }
    if (error instanceof z.ZodError) {
      const termsError = error.errors.some((item) => item.path[0] === "termsAccepted");
      return errorResponse(
        termsError
          ? "Accept the Creator Beta terms before unlocking access."
          : error.errors[0]?.message ?? "Invalid request",
        400
      );
    }
    return errorResponse(
      error instanceof Error ? error.message : "Could not unlock Creator Beta",
      500
    );
  }
}
