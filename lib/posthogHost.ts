/** Public PostHog ingest host. Project tokens are inlined at `next build`. */
export const DEFAULT_POSTHOG_INGEST_HOST = "https://us.i.posthog.com";

export function getPosthogIngestHost(): string {
  const raw = process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim();
  if (!raw) return DEFAULT_POSTHOG_INGEST_HOST;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return DEFAULT_POSTHOG_INGEST_HOST;
    }
    return url.origin;
  } catch {
    return DEFAULT_POSTHOG_INGEST_HOST;
  }
}

export function isPosthogEuHost(host = getPosthogIngestHost()): boolean {
  return host.includes(".eu.") || host.startsWith("https://eu.");
}

export function getPosthogUiHost(host = getPosthogIngestHost()): string {
  return isPosthogEuHost(host) ? "https://eu.posthog.com" : "https://us.posthog.com";
}

export function getPosthogAssetHost(host = getPosthogIngestHost()): string {
  return isPosthogEuHost(host)
    ? "https://eu-assets.i.posthog.com"
    : "https://us-assets.i.posthog.com";
}
