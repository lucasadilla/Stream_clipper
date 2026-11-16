import type { Metadata } from "next";
import { ClipLibraryWorkspace } from "@/components/ClipLibraryWorkspace";
export const metadata: Metadata = { title: "My Clips", robots: { index: false, follow: false } };
export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ clip?: string }> }) {
  const { clip } = await searchParams;
  return <ClipLibraryWorkspace initialClipId={typeof clip === "string" && /^[a-zA-Z0-9_-]{1,160}$/.test(clip) ? clip : undefined} />;
}
