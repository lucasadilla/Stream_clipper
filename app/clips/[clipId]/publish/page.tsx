import type { Metadata } from "next";
import { SocialPublishWorkspace } from "@/components/social/SocialPublishWorkspace";

export const metadata: Metadata = {
  title: "Publish clip",
  description: "Publish a finished clip to connected social accounts.",
  robots: { index: false, follow: false },
};

export default async function PublishClipPage({
  params,
}: {
  params: Promise<{ clipId: string }>;
}) {
  const { clipId } = await params;
  return <SocialPublishWorkspace clipId={clipId} />;
}
