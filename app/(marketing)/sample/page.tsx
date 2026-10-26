import type { Metadata } from "next";
import { SampleWorkspace } from "@/components/SampleWorkspace";
export const metadata: Metadata = { title: "Try a sample", description: "Try Clipper's prepared sample: preview a real Short, adjust a selection, and compare the original video." };
export default function SamplePage() { return <SampleWorkspace />; }
