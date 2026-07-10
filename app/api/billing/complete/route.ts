import { NextRequest, NextResponse } from "next/server";
import { BILLING_ACCOUNT_COOKIE, getStripe } from "@/lib/stripe";
import { upsertBillingAccountFromCheckout } from "@/services/billingService";
import { getPostHogClient } from "@/lib/posthog-server";

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("session_id");
  const redirectUrl = new URL("/#pricing", request.nextUrl.origin);

  if (!sessionId) {
    redirectUrl.searchParams.set("billing", "missing_session");
    return NextResponse.redirect(redirectUrl);
  }

  try {
    const session = await getStripe().checkout.sessions.retrieve(sessionId, {
      expand: ["customer", "subscription"],
    });
    const account = await upsertBillingAccountFromCheckout(session);
    getPostHogClient().capture({
      distinctId: account.id,
      event: "subscription_checkout_completed",
    });
    redirectUrl.searchParams.set("billing", "success");

    const response = NextResponse.redirect(redirectUrl);
    response.cookies.set(BILLING_ACCOUNT_COOKIE, account.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
    return response;
  } catch {
    redirectUrl.searchParams.set("billing", "failed");
    return NextResponse.redirect(redirectUrl);
  }
}
