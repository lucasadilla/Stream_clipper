import type Stripe from "stripe";

/** Checkout Session params including Managed Payments (preview API). */
export type ManagedPaymentsCheckoutSessionParams =
  Stripe.Checkout.SessionCreateParams & {
    managed_payments?: { enabled: boolean };
  };
