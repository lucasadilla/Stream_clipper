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

const GB = 1024 * 1024 * 1024;

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

export interface UsagePack {
  id: "processing_10h" | "exports_100";
  name: string;
  price: number;
  description: string;
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
      processingHoursLimit: 10,
      exportsLimit: 50,
      storageRetentionDays: 14,
      storageLimitBytes: 5 * GB,
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
      "10 processing hours per month",
      "50 watermark-free exports",
      "1080p native and Shorts exports",
      "Transcript search, captions, timeline editing",
      "14-day storage · 5 GB",
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
      processingHoursLimit: 40,
      exportsLimit: 250,
      storageRetentionDays: 60,
      storageLimitBytes: 25 * GB,
      maxResolution: "1080p",
      watermarkEnabled: false,
      priorityQueue: true,
      seatLimit: 1,
      streamStartsLimit: null,
      uploadsLimit: null,
      maxSourceDurationSeconds: null,
      maxClipDurationSeconds: null,
    },
    features: [
      "40 processing hours per month",
      "250 exports",
      "Faster processing priority",
      "Saved caption styles and templates",
      "60-day storage · 25 GB",
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
      processingHoursLimit: 100,
      exportsLimit: 750,
      storageRetentionDays: 90,
      storageLimitBytes: 100 * GB,
      maxResolution: "1080p",
      watermarkEnabled: false,
      priorityQueue: true,
      seatLimit: 3,
      streamStartsLimit: null,
      uploadsLimit: null,
      maxSourceDurationSeconds: null,
      maxClipDurationSeconds: null,
    },
    features: [
      "100 processing hours per month",
      "750 exports",
      "3 seats",
      "Priority queue and support",
      "90-day storage · 100 GB",
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
      "Custom hours, seats, retention, and support",
      "Dedicated processing capacity",
      "Optional API and bulk workflows later",
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
    "25 rendered clips per month",
    "10 video uploads per month",
    "Source videos up to 3 hours",
    "Rendered clips up to 60 seconds",
  ],
};

export const CHECKOUT_PLAN_IDS: CheckoutPlanId[] = ["creator", "pro", "studio"];

export const USAGE_PACKS: UsagePack[] = [
  {
    id: "processing_10h",
    name: "10 processing hours",
    price: 10,
    description: "Add 10 extra hours of live or VOD analysis.",
  },
  {
    id: "exports_100",
    name: "100 exports",
    price: 10,
    description: "Add 100 extra rendered clips.",
  },
];

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
