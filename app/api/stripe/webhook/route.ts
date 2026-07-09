import { NextRequest } from "next/server";
import { getStripe, getStripeWebhookSecret } from "@/lib/stripe";
import {
  syncBillingAccountFromSubscription,
  upsertBillingAccountFromCheckout,
} from "@/services/billingService";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const stripe = getStripe();
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return Response.json({ error: "Missing Stripe signature" }, { status: 400 });
  }

  let event;
  try {
    const rawBody = await request.text();
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      getStripeWebhookSecret()
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid Stripe webhook";
    return Response.json({ error: message }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        await upsertBillingAccountFromCheckout(event.data.object);
        break;
      case "checkout.session.async_payment_failed":
        console.warn(
          "[stripe/webhook] async checkout payment failed:",
          event.data.object.id
        );
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await syncBillingAccountFromSubscription(event.data.object);
        break;
      default:
        break;
    }

    return Response.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook handling failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
