import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import type { Metadata } from "next";
import { ClipShareView } from "@/components/ClipShareView";
import { getClipSharePayload } from "@/services/clipShareService";

interface ClipPageProps {
  params: Promise<{ clipId: string }>;
}

export async function generateMetadata({
  params,
}: ClipPageProps): Promise<Metadata> {
  const { clipId } = await params;
  if (await prisma.clipLibraryItem.findUnique({ where: { id: clipId }, select: { id: true } })) return { title: "Saved clip", robots: { index: false, follow: false } };
  const clip = await getClipSharePayload(clipId);
  if (!clip) {
    return { title: "Clip not found", robots: { index: false, follow: false } };
  }

  const description = clip.reason.slice(0, 160);

  return {
    title: clip.title,
    description,
    alternates: { canonical: `/clips/${clipId}` },
    openGraph: {
      title: clip.title,
      description,
      type: "video.other",
      ...(clip.stream.thumbnailUrl
        ? { images: [{ url: clip.stream.thumbnailUrl }] }
        : {}),
    },
    twitter: {
      card: clip.stream.thumbnailUrl ? "summary_large_image" : "summary",
      title: clip.title,
      description,
      ...(clip.stream.thumbnailUrl
        ? { images: [clip.stream.thumbnailUrl] }
        : {}),
    },
  };
}

export default async function ClipSharePage({ params }: ClipPageProps) {
  const { clipId } = await params;
  if (await prisma.clipLibraryItem.findUnique({ where: { id: clipId }, select: { id: true } })) redirect(`/library?clip=${encodeURIComponent(clipId)}`);
  const clip = await getClipSharePayload(clipId);
  if (!clip) notFound();

  return <ClipShareView clip={clip} />;
}
