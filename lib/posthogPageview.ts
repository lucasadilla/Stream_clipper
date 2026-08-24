/** Build the absolute URL Web Analytics expects on `$pageview`. */
export function buildPosthogPageviewUrl(
  origin: string,
  pathname: string,
  search = ""
): string {
  const normalizedOrigin = origin.replace(/\/$/, "");
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const query = search.replace(/^\?/, "");
  return query ? `${normalizedOrigin}${path}?${query}` : `${normalizedOrigin}${path}`;
}

export type PosthogPageviewClient = {
  __loaded?: boolean;
  capture: (
    event: string,
    properties?: Record<string, unknown>,
    options?: { send_instantly?: boolean }
  ) => void;
};

/**
 * Capture a `$pageview` for Next.js App Router.
 * Returns false when the SDK is not ready so the caller can retry.
 */
export function capturePosthogPageview(
  client: PosthogPageviewClient,
  args: { origin: string; pathname: string | null; search?: string }
): boolean {
  if (!client.__loaded || !args.pathname) return false;
  client.capture(
    "$pageview",
    {
      $current_url: buildPosthogPageviewUrl(
        args.origin,
        args.pathname,
        args.search ?? ""
      ),
    },
    // Land-and-leave visitors close the tab before the default batch flush.
    { send_instantly: true }
  );
  return true;
}
