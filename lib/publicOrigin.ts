import type { NextRequest } from "next/server";

/**
 * Public site origin for Stripe return URLs.
 * Prefer NEXT_PUBLIC_SITE_URL so production never redirects to localhost
 * when the request Host / proxy headers are wrong.
 */
export function resolvePublicOrigin(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
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
