export type PlanId = "creator" | "pro" | "studio" | "business";

export type CheckoutPlanId = Exclude<PlanId, "business">;

export type BillingInterval = "monthly" | "yearly";

export type MaxExportResolution = "1080p" | "custom";

export interface PlanEntitlements {
  plan: PlanId;
  processingHoursLimit: number | null;
  exportsLimit: number | null;
  storageRetentionDays: number | null;
  /** Soft cap on total SourceMedia bytes; null = unlimited. */
  storageLimitBytes: number | null;
  maxResolution: MaxExportResolution;
  watermarkEnabled: boolean;
  priorityQueue: boolean;
  seatLimit: number | null;
  streamStartsLimit: number | null;
  uploadsLimit: number | null;
  maxSourceDurationSeconds: number | null;
  maxClipDurationSeconds: number | null;
}

export interface PricingPlan {
  id: PlanId;
  name: string;
  audience: string;
  monthlyPrice: number | null;
  yearlyPrice: number | null;
  priceLabel: string;
  yearlyLabel: string;
  highlight?: string;
  stripePriceEnvVars?: Partial<Record<BillingInterval, string>>;
  entitlements: PlanEntitlements;
  features: string[];
}

const yearly = (monthly: number) => monthly * 10;

export const PRICING_PLANS: PricingPlan[] = [
  {
    id: "creator",
    name: "Creator",
    audience: "Solo creators",
    monthlyPrice: 19,
    yearlyPrice: yearly(19),
    priceLabel: "$19/mo",
    yearlyLabel: "$190/yr",
    stripePriceEnvVars: {
      monthly: "STRIPE_PRICE_CREATOR_MONTHLY",
      yearly: "STRIPE_PRICE_CREATOR_YEARLY",
    },
    highlight: "Start here",
    entitlements: {
      plan: "creator",
      processingHoursLimit: null,
      exportsLimit: 20,
      storageRetentionDays: null,
      storageLimitBytes: null,
      maxResolution: "1080p",
      watermarkEnabled: false,
      priorityQueue: false,
      seatLimit: 1,
      streamStartsLimit: null,
      uploadsLimit: null,
      maxSourceDurationSeconds: null,
      maxClipDurationSeconds: null,
    },
    features: [
      "20 finished videos per month",
      "One clip counts once across every platform",
      "AI clip suggestions and transcript search",
      "Captions, timeline editing, and face tracking",
      "1080p native and vertical exports",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    audience: "Serious streamers",
    monthlyPrice: 49,
    yearlyPrice: yearly(49),
    priceLabel: "$49/mo",
    yearlyLabel: "$490/yr",
    stripePriceEnvVars: {
      monthly: "STRIPE_PRICE_PRO_MONTHLY",
      yearly: "STRIPE_PRICE_PRO_YEARLY",
    },
    highlight: "Most useful",
    entitlements: {
      plan: "pro",
      processingHoursLimit: null,
      exportsLimit: 100,
      storageRetentionDays: null,
      storageLimitBytes: null,
      maxResolution: "1080p",
      watermarkEnabled: false,
      priorityQueue: false,
      seatLimit: 1,
      streamStartsLimit: null,
      uploadsLimit: null,
      maxSourceDurationSeconds: null,
      maxClipDurationSeconds: null,
    },
    features: [
      "100 finished videos per month",
      "One clip counts once across every platform",
      "AI clip suggestions and transcript search",
      "Captions, timeline editing, and face tracking",
      "1080p native and vertical exports",
    ],
  },
  {
    id: "studio",
    name: "Studio",
    audience: "Editor and creator teams",
    monthlyPrice: 99,
    yearlyPrice: yearly(99),
    priceLabel: "$99/mo",
    yearlyLabel: "$990/yr",
    stripePriceEnvVars: {
      monthly: "STRIPE_PRICE_STUDIO_MONTHLY",
      yearly: "STRIPE_PRICE_STUDIO_YEARLY",
    },
    entitlements: {
      plan: "studio",
      processingHoursLimit: null,
      exportsLimit: 200,
      storageRetentionDays: null,
      storageLimitBytes: null,
      maxResolution: "1080p",
      watermarkEnabled: false,
      priorityQueue: false,
      seatLimit: 1,
      streamStartsLimit: null,
      uploadsLimit: null,
      maxSourceDurationSeconds: null,
      maxClipDurationSeconds: null,
    },
    features: [
      "200 finished videos per month",
      "One clip counts once across every platform",
      "AI clip suggestions and transcript search",
      "Captions, timeline editing, and face tracking",
      "1080p native and vertical exports",
    ],
  },
  {
    id: "business",
    name: "Business",
    audience: "Agencies and media teams",
    monthlyPrice: null,
    yearlyPrice: null,
    priceLabel: "Custom",
    yearlyLabel: "Custom",
    entitlements: {
      plan: "business",
      processingHoursLimit: null,
      exportsLimit: null,
      storageRetentionDays: null,
      storageLimitBytes: null,
      maxResolution: "custom",
      watermarkEnabled: false,
      priorityQueue: true,
      seatLimit: null,
      streamStartsLimit: null,
      uploadsLimit: null,
      maxSourceDurationSeconds: null,
      maxClipDurationSeconds: null,
    },
    features: [
      "Starts around $299/mo",
      "Custom monthly video volume",
      "Dedicated processing capacity",
      "Custom support and workflow options",
    ],
  },
];

export const CREATOR_BETA_PLAN: PricingPlan = {
  id: "creator",
  name: "Creator Beta",
  audience: "Invited creators",
  monthlyPrice: 0,
  yearlyPrice: 0,
  priceLabel: "Free during beta",
  yearlyLabel: "Free during beta",
  entitlements: {
    plan: "creator",
    processingHoursLimit: null,
    exportsLimit: 25,
    storageRetentionDays: null,
    storageLimitBytes: null,
    maxResolution: "1080p",
    watermarkEnabled: false,
    priorityQueue: false,
    seatLimit: 1,
    streamStartsLimit: null,
    uploadsLimit: 10,
    maxSourceDurationSeconds: 3 * 60 * 60,
    maxClipDurationSeconds: 60,
  },
  features: [
    "25 finished videos for 30 days",
    "10 video uploads per month",
    "Source videos up to 3 hours",
    "Rendered clips up to 60 seconds",
  ],
};

export const CHECKOUT_PLAN_IDS: CheckoutPlanId[] = ["creator", "pro", "studio"];

export function getPricingPlan(planId: string | undefined | null): PricingPlan {
  return (
    PRICING_PLANS.find((plan) => plan.id === planId) ??
    PRICING_PLANS.find((plan) => plan.id === "creator")!
  );
}

export function isCheckoutPlan(planId: string): planId is CheckoutPlanId {
  return CHECKOUT_PLAN_IDS.includes(planId as CheckoutPlanId);
}

export function getStripePriceEnvVar(
  planId: CheckoutPlanId,
  interval: BillingInterval
): string {
  const envVar = getPricingPlan(planId).stripePriceEnvVars?.[interval];
  if (!envVar) {
    throw new Error(`Missing Stripe price env var for ${planId} ${interval}`);
  }
  return envVar;
}

export function getPlanIdForStripePriceId(priceId: string): PlanId | null {
  for (const plan of PRICING_PLANS) {
    for (const envVar of Object.values(plan.stripePriceEnvVars ?? {})) {
      if (envVar && process.env[envVar] === priceId) return plan.id;
    }
  }
  return null;
}

export function formatLimit(value: number | null, unit: string): string {
  if (value === null) return "Custom";
  return `${value.toLocaleString()} ${unit}`;
}
