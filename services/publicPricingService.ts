import { unstable_cache } from "next/cache";
import { getStripe } from "@/lib/stripe";
import {
  PRICING_PLANS,
  getStripePriceEnvVar,
  type CheckoutPlanId,
  type PlanId,
} from "@/lib/pricing";

export interface PublicPricingPlan {
  id: PlanId;
  name: string;
  audience: string;
  priceLabel: string;
  yearlyLabel: string;
  currency: string | null;
  monthlyAvailable: boolean;
  yearlyAvailable: boolean;
  highlight?: string;
  features: string[];
}

function money(amount: number, currency: string, suffix: string): string {
  return `${new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount)}${suffix}`;
}

async function loadPublicPricingPlans(): Promise<PublicPricingPlan[]> {
  return Promise.all(
    PRICING_PLANS.map(async (plan): Promise<PublicPricingPlan> => {
      if (plan.id === "business") {
        return {
          ...plan,
          currency: null,
          monthlyAvailable: false,
          yearlyAvailable: false,
        };
      }
      try {
        const planId = plan.id as CheckoutPlanId;
        const monthlyId = process.env[getStripePriceEnvVar(planId, "monthly")]?.trim();
        const yearlyId = process.env[getStripePriceEnvVar(planId, "yearly")]?.trim();
        if (!monthlyId || !yearlyId) {
          return {
            ...plan,
            currency: "usd",
            monthlyAvailable: Boolean(monthlyId),
            yearlyAvailable: Boolean(yearlyId),
          };
        }
        const [monthly, yearly] = await Promise.all([
          getStripe().prices.retrieve(monthlyId),
          getStripe().prices.retrieve(yearlyId),
        ]);
        const currency = monthly.currency || yearly.currency || "usd";
        const monthlyAvailable =
          monthly.active && monthly.recurring?.interval === "month";
        const yearlyAvailable =
          yearly.active && yearly.recurring?.interval === "year";
        return {
          ...plan,
          currency,
          monthlyAvailable,
          yearlyAvailable,
          priceLabel:
            monthlyAvailable && monthly.unit_amount != null
              ? money(monthly.unit_amount / 100, currency, "/mo")
              : plan.priceLabel,
          yearlyLabel:
            yearlyAvailable && yearly.unit_amount != null
              ? money(yearly.unit_amount / 100, yearly.currency || currency, "/yr")
              : plan.yearlyLabel,
        };
      } catch (error) {
        console.warn(
          `[pricing] could not load Stripe price for ${plan.id}:`,
          error instanceof Error ? error.message : error
        );
        return {
          ...plan,
          currency: "usd",
          monthlyAvailable: true,
          yearlyAvailable: true,
        };
      }
    })
  );
}

export const getPublicPricingPlans = unstable_cache(
  loadPublicPricingPlans,
  ["clipper-public-pricing-v1"],
  { revalidate: 3600 }
);
