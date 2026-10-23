import type { Metadata } from "next";
import { PublishingHubWorkspace } from "@/components/social/PublishingHubWorkspace";

export const metadata: Metadata = {
  title: "Publishing",
  robots: { index: false, follow: false },
};

export default function PublishingSettingsPage() {
  return <PublishingHubWorkspace />;
}
