import type { Metadata } from "next";
import { ShowcaseWorkspace } from "@/components/ShowcaseWorkspace";
export const metadata: Metadata = { title: "Made with Clipper", robots: { index: false, follow: false } };
export default function ShowcaseSettingsPage() { return <ShowcaseWorkspace />; }
