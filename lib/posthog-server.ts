import { PostHog } from "posthog-node";
import { getPosthogIngestHost } from "@/lib/posthogHost";

let posthogClient: PostHog | null = null;

export function getPostHogClient(): PostHog {
  if (!posthogClient) {
    const projectToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
    posthogClient = new PostHog(projectToken || "ph_disabled", {
      host: getPosthogIngestHost(),
      flushAt: 1,
      flushInterval: 0,
      disabled: !projectToken,
    });
  }
  return posthogClient;
}
