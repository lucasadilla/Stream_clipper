import Stripe from "stripe";
import { createHmac, timingSafeEqual } from "crypto";

export const BILLING_ACCOUNT_COOKIE = "stream_clipper_billing_account";

function billingCookieSecret(): string {
  const secret =
    process.env.AUTH_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET is required to protect billing sessions");
  }
  return "clipper-local-billing-secret";
}

function billingCookieSignature(accountId: string): string {
  return createHmac("sha256", billingCookieSecret())
    .update(accountId)
    .digest("base64url");
}

export function serializeBillingAccountCookie(accountId: string): string {
  return `${accountId}.${billingCookieSignature(accountId)}`;
}

export function parseBillingAccountCookie(
  value: string | null | undefined
): string | null {
  if (!value) return null;
  const separator = value.lastIndexOf(".");
  if (separator <= 0) return null;
  const accountId = value.slice(0, separator);
  const supplied = value.slice(separator + 1);
  const expected = billingCookieSignature(accountId);
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? accountId : null;
}

/** Required for Stripe Managed Payments (merchant of record). */
export const STRIPE_API_VERSION = "2026-02-25.preview" as const;

/** SaaS / digital subscription — eligible for Managed Payments. */
export const STRIPE_DIGITAL_TAX_CODE = "txcd_10103100";

let stripeClient: Stripe | null = null;

export function getStripe() {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    throw new Error("Set STRIPE_SECRET_KEY in .env to enable billing");
  }

  stripeClient ??= new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
  } as unknown as ConstructorParameters<typeof Stripe>[1]);
  return stripeClient;
}

export function getStripePublishableKey(): string | null {
  return process.env.STRIPE_PUBLISHABLE_KEY?.trim() || null;
}

export function getStripeWebhookSecret() {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    throw new Error("Set STRIPE_WEBHOOK_SECRET in .env to verify Stripe webhooks");
  }
  return secret;
}

export function isManagedPaymentsEnabled(): boolean {
  return process.env.STRIPE_MANAGED_PAYMENTS_ENABLED?.trim() !== "false";
}
