"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import posthog from "posthog-js";
import { capturePosthogPageview } from "@/lib/posthogPageview";

/**
 * App Router navigations do not fire a full page load, and
 * `capture_pageview: "history_change"` misses the first load for visitors
 * who land and leave. Web Analytics is built on `$pageview`, so those
 * sessions appear in Live (SDK/flags) then vanish from analytics.
 */
export function PostHogPageView() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // useSearchParams suspends while this route is rendered on the server. Wait
  // until after hydration before mounting the tracker so the server and first
  // client trees both contain the same empty Suspense boundary.
  if (!mounted) return null;

  return <PostHogNavigationTracker />;
}

function PostHogNavigationTracker() {
  const pathname = usePathname();
  const search = useSearchParams().toString();

  useEffect(() => {
    if (!pathname) return;

    let cancelled = false;

    const send = () => {
      if (cancelled || typeof window === "undefined") return true;
      return capturePosthogPageview(posthog, {
        origin: window.location.origin,
        pathname,
        search,
      });
    };

    if (send()) return;

    const intervalId = window.setInterval(() => {
      if (send()) window.clearInterval(intervalId);
    }, 50);
    const timeoutId = window.setTimeout(() => window.clearInterval(intervalId), 8000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.clearTimeout(timeoutId);
    };
  }, [pathname, search]);

  return null;
}
