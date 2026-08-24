import posthog from "posthog-js";
import { getPosthogUiHost } from "@/lib/posthogHost";

const projectToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;

// Keep local/test builds usable before analytics credentials are configured.
// NEXT_PUBLIC_* is inlined at `next build` — Docker must ARG/ENV the token
// before `npm run build` or this branch never runs in production.
if (projectToken) {
  posthog.init(projectToken, {
    // Same-origin reverse proxy configured in next.config.ts. This improves
    // delivery through tracking blockers while ui_host keeps links correct.
    api_host: "/ingest",
    ui_host: getPosthogUiHost(),
    defaults: "2026-05-30",
    // Anonymous pageviews should show up as visitors, not only signed-in users.
    person_profiles: "always",
    capture_exceptions: true,
    debug: process.env.NODE_ENV === "development",
  });
}
