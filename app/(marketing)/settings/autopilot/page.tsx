import type { Metadata } from "next";
import { StreamAutomationWorkspace } from "@/components/social/StreamAutomationWorkspace";

export const metadata: Metadata = {
  title: "Autopilot",
  robots: { index: false, follow: false },
};

export default function AutopilotSettingsPage() {
  return <StreamAutomationWorkspace />;
}
