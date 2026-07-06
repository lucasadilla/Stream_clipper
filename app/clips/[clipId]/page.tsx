import { notFound } from "next/navigation";
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
  const clip = await getClipSharePayload(clipId);
  if (!clip) {
    return { title: "Clip not found — Stream Clipper" };
  }

  const description = clip.reason.slice(0, 160);

  return {
    title: `${clip.title} — Stream Clipper`,
    description,
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
  const clip = await getClipSharePayload(clipId);
  if (!clip) notFound();

  return <ClipShareView clip={clip} />;
}
