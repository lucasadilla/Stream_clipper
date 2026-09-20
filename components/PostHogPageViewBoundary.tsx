"use client";

import dynamic from "next/dynamic";

const ClientPostHogPageView = dynamic(
  () =>
    import("@/components/PostHogPageView").then(
      (module) => module.PostHogPageView
    ),
  { ssr: false }
);

export function PostHogPageViewBoundary() {
  return <ClientPostHogPageView />;
}
