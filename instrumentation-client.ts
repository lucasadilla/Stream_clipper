import posthog from "posthog-js";

const projectToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;

// Keep local/test builds usable before analytics credentials are configured.
if (projectToken) {
  posthog.init(projectToken, {
    // Same-origin reverse proxy configured in next.config.ts. This improves
    // delivery through tracking blockers while ui_host keeps links correct.
    api_host: "/ingest",
    ui_host: "https://us.posthog.com",
    defaults: "2026-05-30",
    capture_exceptions: true,
    debug: process.env.NODE_ENV === "development",
  });
}
