import type Stripe from "stripe";
import { prisma } from "@/lib/db";
import {
  BILLING_ACCOUNT_COOKIE,
  getStripe,
  isManagedPaymentsEnabled,
} from "@/lib/stripe";
import type { ManagedPaymentsCheckoutSessionParams } from "@/lib/stripeCheckout";
import {
  getPlanIdForStripePriceId,
  getPricingPlan,
  getStripePriceEnvVar,
  isCheckoutPlan,
  type BillingInterval,
  type CheckoutPlanId,
  type PlanId,
} from "@/lib/pricing";

export interface BillingAccountSummary {
  id: string;
  email: string | null;
  plan: PlanId;
  status: string;
  unlimitedAccess: boolean;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export function getBillingAccountIdFromRequest(request: Request): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  const parts = cookie.split(";").map((part) => part.trim());
  const value = parts
    .find((part) => part.startsWith(`${BILLING_ACCOUNT_COOKIE}=`))
    ?.split("=")[1];
  return value ? decodeURIComponent(value) : null;
}

export function isActiveBillingStatus(status: string | null | undefined) {
  return status === "active" || status === "trialing";
}

export function hasAppAccess(account: {
  status: string;
  unlimitedAccess?: boolean;
} | null | undefined): boolean {
  if (!account) return false;
  if (account.unlimitedAccess) return true;
  return isActiveBillingStatus(account.status);
}

export function serializeBillingAccount(account: {
  id: string;
  email: string | null;
  plan: string;
  status: string;
  unlimitedAccess?: boolean;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}): BillingAccountSummary {
  return {
    id: account.id,
    email: account.email,
    plan: getPricingPlan(account.plan).id,
    status: account.status,
    unlimitedAccess: account.unlimitedAccess ?? false,
    stripeCustomerId: account.stripeCustomerId,
    stripeSubscriptionId: account.stripeSubscriptionId,
    currentPeriodEnd: account.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: account.cancelAtPeriodEnd,
  };
}

export async function getBillingAccount(accountId: string | null | undefined) {
  if (!accountId) return null;
  return prisma.billingAccount.findUnique({ where: { id: accountId } });
}

export async function createCheckoutSession(params: {
  planId: string;
  interval: BillingInterval;
  origin: string;
}) {
  if (!isCheckoutPlan(params.planId)) {
    throw new Error("Choose Creator, Pro, or Studio to start checkout");
  }

  const planId = params.planId as CheckoutPlanId;
  const plan = getPricingPlan(planId);
  const priceEnvVar = getStripePriceEnvVar(planId, params.interval);
  const priceId = process.env[priceEnvVar]?.trim();
  if (!priceId) {
    throw new Error(
      `Set ${priceEnvVar} in .env to enable ${plan.name} ${params.interval} checkout`
    );
  }

  const stripe = getStripe();
  const sessionParams: ManagedPaymentsCheckoutSessionParams = {
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    allow_promotion_codes: true,
    success_url: `${params.origin}/api/billing/complete?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${params.origin}/#pricing`,
    client_reference_id: planId,
    metadata: { plan: planId, interval: params.interval },
    subscription_data: { metadata: { plan: planId, interval: params.interval } },
  };

  if (isManagedPaymentsEnabled()) {
    sessionParams.managed_payments = { enabled: true };
  }

  return stripe.checkout.sessions.create(sessionParams);
}

export async function createPortalSession(params: {
  accountId: string | null;
  origin: string;
}) {
  const account = await getBillingAccount(params.accountId);
  if (!account) throw new Error("No billing account found. Choose a plan first.");

  const stripe = getStripe();
  return stripe.billingPortal.sessions.create({
    customer: account.stripeCustomerId,
    return_url: `${params.origin}/#pricing`,
  });
}

function subscriptionPeriodEnd(subscription: Stripe.Subscription): Date | null {
  const periodEnd = subscription.items.data[0]?.current_period_end;
  return typeof periodEnd === "number" ? new Date(periodEnd * 1000) : null;
}

function subscriptionPlan(subscription: Stripe.Subscription): PlanId {
  const metadataPlan = subscription.metadata?.plan;
  if (metadataPlan && getPricingPlan(metadataPlan).id === metadataPlan) {
    return metadataPlan as PlanId;
  }

  const priceId = subscription.items.data[0]?.price.id;
  const pricePlan = priceId ? getPlanIdForStripePriceId(priceId) : null;
  return pricePlan ?? "creator";
}

export async function upsertBillingAccountFromCheckout(
  session: Stripe.Checkout.Session
) {
  const customerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id;
  if (!customerId) throw new Error("Stripe checkout session is missing customer");

  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id ?? null;

  let plan = getPricingPlan(session.metadata?.plan).id;
  let status = "active";
  let currentPeriodEnd: Date | null = null;
  let cancelAtPeriodEnd = false;

  if (subscriptionId) {
    const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
    plan = subscriptionPlan(subscription);
    status = subscription.status;
    currentPeriodEnd = subscriptionPeriodEnd(subscription);
    cancelAtPeriodEnd = subscription.cancel_at_period_end;
  }

  return prisma.billingAccount.upsert({
    where: { stripeCustomerId: customerId },
    create: {
      email: session.customer_details?.email ?? session.customer_email ?? null,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      plan,
      status,
      currentPeriodEnd,
      cancelAtPeriodEnd,
    },
    update: {
      email: session.customer_details?.email ?? session.customer_email ?? undefined,
      stripeSubscriptionId: subscriptionId,
      plan,
      status,
      currentPeriodEnd,
      cancelAtPeriodEnd,
    },
  });
}

export async function syncBillingAccountFromSubscription(
  subscription: Stripe.Subscription
) {
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;

  const plan = subscriptionPlan(subscription);
  return prisma.billingAccount.upsert({
    where: { stripeCustomerId: customerId },
    create: {
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      plan,
      status: subscription.status,
      currentPeriodEnd: subscriptionPeriodEnd(subscription),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    },
    update: {
      stripeSubscriptionId: subscription.id,
      plan,
      status: subscription.status,
      currentPeriodEnd: subscriptionPeriodEnd(subscription),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    },
  });
}
