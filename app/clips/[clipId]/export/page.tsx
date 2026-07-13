import type { Metadata } from "next";
import { PlatformExportWorkspace } from "@/components/platform-export/PlatformExportWorkspace";

export const metadata: Metadata = {
  title: "Platform Export Pack",
  description: "Create platform-ready versions, copy, captions, and covers from a finished clip.",
  robots: { index: false, follow: false },
};

export default async function PlatformExportPage({
  params,
}: {
  params: Promise<{ clipId: string }>;
}) {
  const { clipId } = await params;
  return <PlatformExportWorkspace clipId={clipId} />;
}
