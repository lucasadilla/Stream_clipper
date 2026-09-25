import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getBillingAccount,
  getStripeBillingDetails,
  hasAppAccess,
  serializeBillingAccount,
  upsertBillingAccountFromCheckout,
} from "@/services/billingService";
import { ensureBillingAccountForAuthUser } from "@/services/authAccountService";
import {
  BILLING_ACCOUNT_COOKIE,
  getStripe,
  serializeBillingAccountCookie,
} from "@/lib/stripe";
import { readOnboardingIntent } from "@/services/onboardingIntentService";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authSession = await auth();
  if (!authSession?.user?.id) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  let account = await ensureBillingAccountForAuthUser({
    userId: authSession.user.id,
    email: authSession.user.email,
    name: authSession.user.name,
    provider: "session",
    providerAccountId: authSession.user.id,
  });
  const checkoutSessionId = request.nextUrl.searchParams.get("session_id");
  let pending = false;

  if (checkoutSessionId) {
    try {
      const checkout = await getStripe().checkout.sessions.retrieve(
        checkoutSessionId,
        { expand: ["customer", "subscription"] }
      );
      if (checkout.metadata?.billingAccountId !== account.id) {
        return NextResponse.json(
          { error: "This checkout belongs to another account" },
          { status: 403 }
        );
      }
      const settled =
        checkout.status === "complete" &&
        (checkout.payment_status === "paid" ||
          checkout.payment_status === "no_payment_required");
      if (settled) {
        const updated = await upsertBillingAccountFromCheckout(checkout);
        account = serializeBillingAccount(updated);
      } else {
        pending = checkout.status === "open";
      }
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Could not verify checkout",
        },
        { status: 400 }
      );
    }
  } else {
    const fresh = await getBillingAccount(account.id);
    if (fresh) account = serializeBillingAccount(fresh);
  }

  const active = hasAppAccess(account);
  const stripeDetails = active && !checkoutSessionId
    ? await getStripeBillingDetails(account.id)
    : null;
  const response = NextResponse.json({
    billingAccount: account,
    stripeDetails,
    active,
    pending,
    intent: readOnboardingIntent(request),
  });
  response.cookies.set(
    BILLING_ACCOUNT_COOKIE,
    serializeBillingAccountCookie(account.id),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    }
  );
  return response;
}
