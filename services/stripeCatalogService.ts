import {
  getStripe,
  STRIPE_DIGITAL_TAX_CODE,
} from "@/lib/stripe";
import {
  CHECKOUT_PLAN_IDS,
  getPricingPlan,
  getStripePriceEnvVar,
  type BillingInterval,
  type CheckoutPlanId,
} from "@/lib/pricing";

export interface ProvisionedPlanPrices {
  planId: CheckoutPlanId;
  productId: string;
  monthlyPriceId: string;
  yearlyPriceId: string;
  envLines: string[];
}

function planDescription(planId: CheckoutPlanId): string {
  const plan = getPricingPlan(planId);
  return `${plan.audience}. ${plan.features.slice(0, 2).join(" · ")}`;
}

async function findProductByPlanId(planId: CheckoutPlanId) {
  const stripe = getStripe();
  const products = await stripe.products.list({ limit: 100, active: true });
  return (
    products.data.find((product) => product.metadata?.plan_id === planId) ??
    null
  );
}

async function ensureYearlyPrice(
  productId: string,
  planId: CheckoutPlanId,
  existingYearlyPriceId?: string
) {
  const stripe = getStripe();
  const plan = getPricingPlan(planId);
  if (!plan.yearlyPrice) {
    throw new Error(`${plan.name} is missing a yearly price`);
  }

  if (existingYearlyPriceId) {
    try {
      const price = await stripe.prices.retrieve(existingYearlyPriceId);
      if (price.active && price.recurring?.interval === "year") {
        return price.id;
      }
    } catch {
      // Create a fresh yearly price below.
    }
  }

  const yearly = await stripe.prices.create({
    product: productId,
    currency: "usd",
    unit_amount: plan.yearlyPrice * 100,
    recurring: { interval: "year" },
    metadata: { plan_id: planId, interval: "yearly" },
  });
  return yearly.id;
}

export async function provisionSubscriptionProduct(
  planId: CheckoutPlanId
): Promise<ProvisionedPlanPrices> {
  const stripe = getStripe();
  const plan = getPricingPlan(planId);
  if (!plan.monthlyPrice || !plan.yearlyPrice) {
    throw new Error(`${plan.name} is not a self-serve subscription plan`);
  }

  let product = await findProductByPlanId(planId);
  let monthlyPriceId: string | undefined;

  if (!product) {
    const created = await stripe.products.create({
      name: `Clipper ${plan.name}`,
      description: planDescription(planId),
      tax_code: STRIPE_DIGITAL_TAX_CODE,
      metadata: { plan_id: planId },
      default_price_data: {
        currency: "usd",
        unit_amount: plan.monthlyPrice * 100,
        recurring: { interval: "month" },
      },
    });
    product = created;
    monthlyPriceId =
      typeof created.default_price === "string"
        ? created.default_price
        : created.default_price?.id;
  } else {
    const productName = `Clipper ${plan.name}`;
    const description = planDescription(planId);
    if (product.name !== productName || product.description !== description) {
      product = await stripe.products.update(product.id, {
        name: productName,
        description,
      });
    }

    const prices = await stripe.prices.list({
      product: product.id,
      active: true,
      limit: 100,
    });
    monthlyPriceId = prices.data.find(
      (price) => price.recurring?.interval === "month"
    )?.id;
    if (!monthlyPriceId) {
      const monthly = await stripe.prices.create({
        product: product.id,
        currency: "usd",
        unit_amount: plan.monthlyPrice * 100,
        recurring: { interval: "month" },
        metadata: { plan_id: planId, interval: "monthly" },
      });
      monthlyPriceId = monthly.id;
      await stripe.products.update(product.id, {
        default_price: monthlyPriceId,
      });
    }
  }

  if (!monthlyPriceId) {
    throw new Error(`Failed to resolve monthly price for ${plan.name}`);
  }

  const yearlyEnv = getStripePriceEnvVar(planId, "yearly");
  const configuredYearly = process.env[yearlyEnv]?.trim();
  const yearlyPriceId = await ensureYearlyPrice(
    product.id,
    planId,
    configuredYearly || undefined
  );

  const monthlyEnv = getStripePriceEnvVar(planId, "monthly");
  const envLines = [
    `${monthlyEnv}=${monthlyPriceId}`,
    `${yearlyEnv}=${yearlyPriceId}`,
  ];

  return {
    planId,
    productId: product.id,
    monthlyPriceId,
    yearlyPriceId,
    envLines,
  };
}

export async function provisionSubscriptionCatalog(): Promise<{
  plans: ProvisionedPlanPrices[];
  envLines: string[];
}> {
  const plans: ProvisionedPlanPrices[] = [];
  for (const planId of CHECKOUT_PLAN_IDS) {
    plans.push(await provisionSubscriptionProduct(planId));
  }

  return {
    plans,
    envLines: plans.flatMap((plan) => plan.envLines),
  };
}

export function formatProvisionEnvBlock(envLines: string[]): string {
  return [
    "# Stripe price IDs (Managed Payments catalog)",
    ...envLines,
    "",
  ].join("\n");
}

export function isPriceConfigured(
  planId: CheckoutPlanId,
  interval: BillingInterval
): boolean {
  const envVar = getStripePriceEnvVar(planId, interval);
  return Boolean(process.env[envVar]?.trim());
}
