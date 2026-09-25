import { z } from "zod";
import { isCheckoutPlan, type BillingInterval, type CheckoutPlanId } from "@/lib/pricing";
import { normalizeUserStreamUrl, parseStreamUrl } from "@/lib/streamPlatform";

export const ONBOARDING_WORKFLOWS = ["timeline", "agent", "autopilot"] as const;
export type OnboardingWorkflow = (typeof ONBOARDING_WORKFLOWS)[number];

const attributionSchema = z
  .object({
    utmSource: z.string().max(120).optional(),
    utmMedium: z.string().max(120).optional(),
    utmCampaign: z.string().max(160).optional(),
    utmContent: z.string().max(160).optional(),
    marketingContentId: z.string().max(160).optional(),
    firstLandingPage: z.string().max(500).optional(),
    referrer: z.string().max(500).optional(),
  })
  .optional();

export const onboardingIntentInputSchema = z.object({
  workflow: z.enum(ONBOARDING_WORKFLOWS).optional(),
  streamUrl: z.string().max(2_000).optional().nullable(),
  requestedAction: z.string().max(500).optional().nullable(),
  planId: z.string().optional().nullable(),
  interval: z.enum(["monthly", "yearly"]).optional().nullable(),
  attribution: attributionSchema,
});

export interface OnboardingAttribution {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  marketingContentId?: string;
  firstLandingPage?: string;
  referrer?: string;
}

export interface OnboardingIntent {
  version: 1;
  workflow: OnboardingWorkflow;
  streamUrl: string | null;
  requestedAction: string | null;
  planId: CheckoutPlanId | null;
  interval: BillingInterval | null;
  attribution: OnboardingAttribution;
  createdAt: number;
  expiresAt: number;
}

function cleanText(value: string | null | undefined): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function cleanPlanId(value: string | null | undefined): CheckoutPlanId | null {
  return value && isCheckoutPlan(value) ? value : null;
}

export function validateIntentStreamUrl(value: string | null | undefined): string | null {
  const cleaned = cleanText(value);
  if (!cleaned) return null;
  const normalized = normalizeUserStreamUrl(cleaned);
  const parsed = parseStreamUrl(normalized);
  if (!parsed) {
    throw new Error(
      "Use a YouTube, Twitch, or Kick livestream, channel, or VOD URL."
    );
  }
  return parsed.canonicalUrl;
}

export function mergeOnboardingIntent(
  current: OnboardingIntent | null,
  input: z.infer<typeof onboardingIntentInputSchema>,
  now = Date.now()
): OnboardingIntent {
  const parsed = onboardingIntentInputSchema.parse(input);
  const createdAt = current?.createdAt ?? now;
  return {
    version: 1,
    workflow: parsed.workflow ?? current?.workflow ?? "timeline",
    streamUrl:
      parsed.streamUrl !== undefined
        ? validateIntentStreamUrl(parsed.streamUrl)
        : current?.streamUrl ?? null,
    requestedAction:
      parsed.requestedAction !== undefined
        ? cleanText(parsed.requestedAction)
        : current?.requestedAction ?? null,
    planId:
      parsed.planId !== undefined
        ? cleanPlanId(parsed.planId)
        : current?.planId ?? null,
    interval:
      parsed.interval !== undefined
        ? parsed.interval
        : current?.interval ?? null,
    attribution: {
      ...(current?.attribution ?? {}),
      ...(parsed.attribution ?? {}),
    },
    createdAt,
    expiresAt: now + 7 * 24 * 60 * 60 * 1_000,
  };
}

export function isOnboardingIntent(value: unknown, now = Date.now()): value is OnboardingIntent {
  if (!value || typeof value !== "object") return false;
  const intent = value as Partial<OnboardingIntent>;
  return (
    intent.version === 1 &&
    ONBOARDING_WORKFLOWS.includes(intent.workflow as OnboardingWorkflow) &&
    typeof intent.createdAt === "number" &&
    typeof intent.expiresAt === "number" &&
    intent.expiresAt > now
  );
}

export function onboardingDestination(intent: OnboardingIntent | null): string {
  if (intent?.workflow === "autopilot") return "/settings/autopilot";
  return "/#analyze";
}
