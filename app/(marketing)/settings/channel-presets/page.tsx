import type { Metadata } from "next";
import { ChannelPresetsWorkspace } from "@/components/social/ChannelPresetsWorkspace";
export const metadata: Metadata = { title: "Channel presets", robots: { index: false, follow: false } };
export default function Page() { return <ChannelPresetsWorkspace />; }
