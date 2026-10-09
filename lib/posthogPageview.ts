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

let lastCapturedUrl = "";

export function resetPosthogPageviewCaptureForTests() {
  lastCapturedUrl = "";
}

/**
 * Capture a `$pageview` for Next.js App Router.
 * Returns false when the SDK is not ready so the caller can retry.
 * Duplicate URLs are treated as success so React and `loaded` can both try.
 */
export function capturePosthogPageview(
  client: PosthogPageviewClient,
  args: { origin: string; pathname: string | null; search?: string }
): boolean {
  if (!client.__loaded || !args.pathname) return false;
  const url = buildPosthogPageviewUrl(
    args.origin,
    args.pathname,
    args.search ?? ""
  );
  if (url === lastCapturedUrl) return true;
  lastCapturedUrl = url;
  client.capture(
    "$pageview",
    { $current_url: url },
    // Land-and-leave visitors close the tab before the default batch flush.
    { send_instantly: true }
  );
  return true;
}

/** First pageview as soon as the SDK is ready — do not wait for React hydration. */
export function captureVisiblePosthogPageview(
  client: PosthogPageviewClient
): void {
  if (typeof document === "undefined" || typeof window === "undefined") return;

  const send = () => {
    if (document.visibilityState !== "visible") return false;
    return capturePosthogPageview(client, {
      origin: window.location.origin,
      pathname: window.location.pathname,
      search: window.location.search,
    });
  };

  if (send()) return;

  const onVisibility = () => {
    if (send()) document.removeEventListener("visibilitychange", onVisibility);
  };
  document.addEventListener("visibilitychange", onVisibility);
}
