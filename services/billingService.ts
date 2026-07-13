import type Stripe from "stripe";
import { isCreatorBetaEnabled } from "@/lib/creatorBeta";
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
  displayName: string | null;
  plan: PlanId;
  status: string;
  unlimitedAccess: boolean;
  betaAccess: boolean;
  betaGrantedAt: string | null;
  canManageBilling: boolean;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  lastSignedInAt: string | null;
}

export interface StripeBillingDetails {
  paymentMethodBrand: string | null;
  paymentMethodLast4: string | null;
  nextInvoiceAmountCents: number | null;
  nextInvoiceDate: string | null;
  currency: string | null;
}

export function canManageBillingForAccount(account: {
  unlimitedAccess?: boolean;
  betaAccess?: boolean;
  stripeCustomerId: string;
}): boolean {
  if (account.unlimitedAccess) return false;
  if (account.stripeCustomerId.startsWith("beta_")) return false;
  return !account.stripeCustomerId.startsWith("comp_");
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
  betaAccess?: boolean;
} | null | undefined): boolean {
  if (!account) return false;
  if (account.unlimitedAccess) return true;
  if (account.betaAccess && isCreatorBetaEnabled()) return true;
  return isActiveBillingStatus(account.status);
}

export function serializeBillingAccount(account: {
  id: string;
  email: string | null;
  displayName?: string | null;
  plan: string;
  status: string;
  unlimitedAccess?: boolean;
  betaAccess?: boolean;
  betaGrantedAt?: Date | null;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  lastSignedInAt?: Date | null;
}): BillingAccountSummary {
  const unlimitedAccess = account.unlimitedAccess ?? false;
  const betaAccess = account.betaAccess ?? false;
  return {
    id: account.id,
    email: account.email,
    displayName: account.displayName ?? null,
    plan: getPricingPlan(account.plan).id,
    status: account.status,
    unlimitedAccess,
    betaAccess,
    betaGrantedAt: account.betaGrantedAt?.toISOString() ?? null,
    canManageBilling: canManageBillingForAccount({
      unlimitedAccess,
      betaAccess,
      stripeCustomerId: account.stripeCustomerId,
    }),
    stripeCustomerId: account.stripeCustomerId,
    stripeSubscriptionId: account.stripeSubscriptionId,
    currentPeriodEnd: account.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: account.cancelAtPeriodEnd,
    lastSignedInAt: account.lastSignedInAt?.toISOString() ?? null,
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
  if (!canManageBillingForAccount(account)) {
    throw new Error(
      "This account does not use Stripe billing. Comp and unlimited accounts cannot open the customer portal."
    );
  }

  const stripe = getStripe();
  return stripe.billingPortal.sessions.create({
    customer: account.stripeCustomerId,
    return_url: `${params.origin}/profile`,
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
      lastSignedInAt: new Date(),
    },
    update: {
      email: session.customer_details?.email ?? session.customer_email ?? undefined,
      stripeSubscriptionId: subscriptionId,
      plan,
      status,
      currentPeriodEnd,
      cancelAtPeriodEnd,
      lastSignedInAt: new Date(),
    },
  });
}

export async function touchLastSignedIn(accountId: string) {
  return prisma.billingAccount.update({
    where: { id: accountId },
    data: { lastSignedInAt: new Date() },
  });
}

export async function getStripeBillingDetails(
  accountId: string | null | undefined
): Promise<StripeBillingDetails | null> {
  const account = await getBillingAccount(accountId);
  if (!account || !canManageBillingForAccount(account)) return null;

  const stripe = getStripe();
  const empty: StripeBillingDetails = {
    paymentMethodBrand: null,
    paymentMethodLast4: null,
    nextInvoiceAmountCents: null,
    nextInvoiceDate: null,
    currency: null,
  };

  try {
    const customer = await stripe.customers.retrieve(account.stripeCustomerId, {
      expand: ["invoice_settings.default_payment_method"],
    });
    if (customer.deleted) return empty;

    let paymentMethodBrand: string | null = null;
    let paymentMethodLast4: string | null = null;
    const defaultPm = customer.invoice_settings?.default_payment_method;
    if (defaultPm && typeof defaultPm !== "string" && defaultPm.card) {
      paymentMethodBrand = defaultPm.card.brand ?? null;
      paymentMethodLast4 = defaultPm.card.last4 ?? null;
    } else {
      const methods = await stripe.paymentMethods.list({
        customer: account.stripeCustomerId,
        type: "card",
        limit: 1,
      });
      const card = methods.data[0]?.card;
      paymentMethodBrand = card?.brand ?? null;
      paymentMethodLast4 = card?.last4 ?? null;
    }

    let nextInvoiceAmountCents: number | null = null;
    let nextInvoiceDate: string | null = null;
    let currency: string | null = null;
    try {
      const upcoming = await stripe.invoices.createPreview({
        customer: account.stripeCustomerId,
        ...(account.stripeSubscriptionId
          ? { subscription: account.stripeSubscriptionId }
          : {}),
      });
      nextInvoiceAmountCents =
        typeof upcoming.amount_due === "number" ? upcoming.amount_due : null;
      currency = upcoming.currency ?? null;
      if (typeof upcoming.next_payment_attempt === "number") {
        nextInvoiceDate = new Date(
          upcoming.next_payment_attempt * 1000
        ).toISOString();
      } else if (account.currentPeriodEnd) {
        nextInvoiceDate = account.currentPeriodEnd.toISOString();
      }
    } catch {
      if (account.currentPeriodEnd) {
        nextInvoiceDate = account.currentPeriodEnd.toISOString();
      }
    }

    return {
      paymentMethodBrand,
      paymentMethodLast4,
      nextInvoiceAmountCents,
      nextInvoiceDate,
      currency,
    };
  } catch (err) {
    console.warn("[billing] failed to load Stripe details:", err);
    return empty;
  }
}

export async function deleteBillingAccount(
  accountId: string | null | undefined
): Promise<{ deletedSessions: number }> {
  if (!accountId) throw new Error("Sign in to delete your account");

  const account = await getBillingAccount(accountId);
  if (!account) throw new Error("Account not found");

  const sessions = await prisma.streamSession.findMany({
    where: { billingAccountId: accountId },
    select: { id: true },
  });

  const { deleteStreamSession } = await import(
    "@/services/sessionCleanupService"
  );
  for (const session of sessions) {
    try {
      await deleteStreamSession(session.id);
    } catch (err) {
      console.warn(`[billing] failed to delete session ${session.id}:`, err);
    }
  }

  if (canManageBillingForAccount(account)) {
    const stripe = getStripe();
    try {
      if (account.stripeSubscriptionId) {
        await stripe.subscriptions.cancel(account.stripeSubscriptionId);
      }
    } catch (err) {
      console.warn("[billing] failed to cancel Stripe subscription:", err);
    }
  }

  await prisma.billingAccount.delete({ where: { id: accountId } });
  return { deletedSessions: sessions.length };
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
