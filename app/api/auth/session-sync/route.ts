import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { ensureBillingAccountForAuthUser } from "@/services/authAccountService";
import { BILLING_ACCOUNT_COOKIE } from "@/lib/stripe";
import { errorResponse } from "@/lib/utils";

/**
 * After credentials/OAuth sign-in, confirm the Auth.js session and attach the
 * billing cookie on the HTTP response (more reliable than cookies() in events).
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return errorResponse(
        "No active session. If you're on localhost, set AUTH_URL=http://localhost:3000 in .env and restart.",
        401
      );
    }

    const account = await ensureBillingAccountForAuthUser({
      userId: session.user.id,
      email: session.user.email,
      name: session.user.name,
      provider: "session",
      providerAccountId: session.user.id,
    });

    const response = NextResponse.json({ account, authUser: session.user });
    response.cookies.set(BILLING_ACCOUNT_COOKIE, account.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
    return response;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not sync session";
    return errorResponse(message, 500);
  }
}
