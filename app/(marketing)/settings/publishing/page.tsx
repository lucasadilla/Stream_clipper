import type { Metadata } from "next";
import { PublishingSettingsWorkspace } from "@/components/social/PublishingSettingsWorkspace";

export const metadata: Metadata = {
  title: "Publishing",
  robots: { index: false, follow: false },
};

export default function PublishingSettingsPage() {
  return <PublishingSettingsWorkspace />;
}
