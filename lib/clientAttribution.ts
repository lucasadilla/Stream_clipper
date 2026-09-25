import type { OnboardingAttribution } from "@/lib/onboardingIntent";

const STORAGE_KEY = "clipper_marketing_attribution_v1";

function nonEmpty(value: string | null): string | undefined {
  const cleaned = value?.trim();
  return cleaned || undefined;
}

export function captureClientAttribution(): OnboardingAttribution {
  if (typeof window === "undefined") return {};
  let stored: OnboardingAttribution = {};
  try {
    stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}") as OnboardingAttribution;
  } catch {
    stored = {};
  }

  const query = new URLSearchParams(window.location.search);
  const current: OnboardingAttribution = {
    utmSource: nonEmpty(query.get("utm_source")),
    utmMedium: nonEmpty(query.get("utm_medium")),
    utmCampaign: nonEmpty(query.get("utm_campaign")),
    utmContent: nonEmpty(query.get("utm_content")),
    marketingContentId: nonEmpty(
      query.get("content_id") || query.get("marketing_content_id")
    ),
    firstLandingPage: stored.firstLandingPage || window.location.href,
    referrer: stored.referrer || nonEmpty(document.referrer),
  };
  const merged = Object.fromEntries(
    Object.entries({ ...stored, ...current }).filter(([, value]) => Boolean(value))
  ) as OnboardingAttribution;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // Attribution should never block the product flow.
  }
  return merged;
}
