import type { NextRequest } from "next/server";

const DEFAULT_SITE_URL = "https://streamclipper.stream";

/**
 * Normalize NEXT_PUBLIC_SITE_URL / similar env values.
 * Railway/dashboard pastes often include wrapping quotes, which break `new URL()`.
 */
export function sanitizePublicSiteUrl(
  raw: string | undefined | null,
  fallback = DEFAULT_SITE_URL
): string {
  let value = (raw ?? "").trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }
  // Also strip a single leading/trailing quote left by partial paste.
  value = value.replace(/^["']+|["']+$/g, "").trim().replace(/\/$/, "");

  if (!value) return fallback.replace(/\/$/, "");

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return fallback.replace(/\/$/, "");
    }
    return url.origin;
  } catch {
    return fallback.replace(/\/$/, "");
  }
}

/** Canonical public site origin (no trailing slash). */
export function getPublicSiteUrl(): string {
  return sanitizePublicSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);
}

/**
 * Public site origin for Stripe return URLs.
 * Prefer NEXT_PUBLIC_SITE_URL so production never redirects to localhost
 * when the request Host / proxy headers are wrong.
 */
export function resolvePublicOrigin(request: NextRequest): string {
  const configured = sanitizePublicSiteUrl(
    process.env.NEXT_PUBLIC_SITE_URL,
    ""
  );
  if (configured && /^https?:\/\//i.test(configured)) {
    return configured;
  }

  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
  if (forwardedHost && !/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(forwardedHost)) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  return request.nextUrl.origin;
}
