import { NextRequest } from "next/server";
import { getStripe, getStripeWebhookSecret } from "@/lib/stripe";
import {
  hasAppAccess,
  syncBillingAccountFromSubscription,
  upsertBillingAccountFromCheckout,
} from "@/services/billingService";
import { getPostHogClient } from "@/lib/posthog-server";
import { prisma } from "@/lib/db";

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
      case "checkout.session.async_payment_succeeded": {
        const account = await upsertBillingAccountFromCheckout(event.data.object);
        getPostHogClient().capture({
          distinctId: account.id,
          event: "checkout_completed",
          properties: {
            stripe_event_type: event.type,
            plan_id: account.plan,
            workflow: event.data.object.metadata?.workflow,
            utm_source: event.data.object.metadata?.utm_source,
            utm_medium: event.data.object.metadata?.utm_medium,
            utm_campaign: event.data.object.metadata?.utm_campaign,
            utm_content: event.data.object.metadata?.utm_content,
            marketing_content_id:
              event.data.object.metadata?.marketing_content_id,
            $insert_id: `${event.data.object.id}:checkout_completed`,
          },
        });
        if (hasAppAccess(account)) {
          getPostHogClient().capture({
            distinctId: account.id,
            event: "subscription_activated",
            properties: {
              plan_id: account.plan,
              workflow: event.data.object.metadata?.workflow,
              $insert_id: `${event.data.object.id}:subscription_activated`,
            },
          });
        }
        break;
      }
      case "checkout.session.async_payment_failed": {
        console.warn(
          "[stripe/webhook] async checkout payment failed:",
          event.data.object.id
        );
        const accountId = event.data.object.metadata?.billingAccountId;
        if (accountId) {
          getPostHogClient().capture({
            distinctId: accountId,
            event: "subscription_activation_failed",
            properties: { $insert_id: event.id },
          });
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const account = await syncBillingAccountFromSubscription(event.data.object);
        if (event.type === "customer.subscription.deleted") {
          getPostHogClient().capture({
            distinctId: account.id,
            event: "subscription_cancelled",
            properties: {
              plan_id: account.plan,
              $insert_id: event.id,
            },
          });
        }
        break;
      }
      case "invoice.paid": {
        const invoice = event.data.object;
        if (invoice.billing_reason !== "subscription_cycle") break;
        const customerId =
          typeof invoice.customer === "string"
            ? invoice.customer
            : invoice.customer?.id;
        if (!customerId) break;
        const account = await prisma.billingAccount.findUnique({
          where: { stripeCustomerId: customerId },
          select: { id: true, plan: true },
        });
        if (account) {
          getPostHogClient().capture({
            distinctId: account.id,
            event: "subscription_renewed",
            properties: {
              plan_id: account.plan,
              amount_paid: invoice.amount_paid,
              currency: invoice.currency,
              $insert_id: event.id,
            },
          });
        }
        break;
      }
      default:
        break;
    }

    return Response.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook handling failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
