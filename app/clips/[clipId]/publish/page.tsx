import type { Metadata } from "next";
import { SocialPublishWorkspace } from "@/components/social/SocialPublishWorkspace";

export const metadata: Metadata = {
  title: "Publish clip",
  description: "Publish a finished clip to connected social accounts.",
  robots: { index: false, follow: false },
};

export default async function PublishClipPage({
  params,
  searchParams,
}: {
  params: Promise<{ clipId: string }>;
  searchParams: Promise<{ groupId?: string }>;
}) {
  const { clipId } = await params;
  const { groupId } = await searchParams;
  return <SocialPublishWorkspace clipId={clipId} initialGroupId={typeof groupId === "string" ? groupId : undefined} />;
}
