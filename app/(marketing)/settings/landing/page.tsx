import type { Metadata } from "next";
import { LandingFeaturedEditor } from "@/components/LandingFeaturedEditor";
export const metadata: Metadata = { title: "Featured clips", robots: { index: false, follow: false } };
export default function LandingEditorPage() { return <LandingFeaturedEditor />; }
