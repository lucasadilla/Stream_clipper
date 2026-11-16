import Link from "next/link";
import { notFound } from "next/navigation";
import { EditorialNextStep, EditorialPage } from "@/components/EditorialPage";
import styles from "@/components/EditorialPage.module.css";
import { editorialMetadata, guides, interviewCase, youtubeEmbedUrl } from "@/lib/editorialContent";
import { getPublicSiteUrl } from "@/lib/publicOrigin";

type Props = { params: Promise<{ slug: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return guides.map(({ slug }) => ({ slug }));
}

async function loadGuide(params: Props["params"]) {
  const { slug } = await params;
  return guides.find(guide => guide.slug === slug) ?? notFound();
}

export async function generateMetadata({ params }: Props) {
  return editorialMetadata(await loadGuide(params));
}

export default async function GuidePage({ params }: Props) {
  const guide = await loadGuide(params);
  const video = guide.video;
  const embedUrl = video && youtubeEmbedUrl(video.youtubeId);
  const videoSchema = video && {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: video.title,
    description: video.description,
    thumbnailUrl: video.thumbnailUrl,
    uploadDate: video.uploadedAt,
    duration: video.duration,
    embedUrl,
    mainEntityOfPage: new URL(guide.path, getPublicSiteUrl()).href,
  };
  const related = guides.find(entry => entry.slug !== guide.slug);

  return (
    <EditorialPage title={guide.title} description={guide.description} category={guide.topic}>
      {video && (
        <>
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(videoSchema).replace(/</g, "\\u003c") }} />
          <iframe className={styles.video} src={embedUrl} title={video.title}
            allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
          <p><a href={`https://www.youtube.com/watch?v=${encodeURIComponent(video.youtubeId)}`}>Watch on YouTube</a></p>
        </>
      )}
      <section className={styles.section}>
        <h2>Editing steps</h2>
        <ol className={styles.steps}>
          {guide.steps.map(step => (
            <li key={step.title}>
              <h3>{step.timestamp && video ? `${step.timestamp} · ` : ""}{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
      </section>
      <section className={styles.section}>
        <h2>Before you publish</h2>
        <ul>{guide.checklist.map(item => <li key={item}>{item}</li>)}</ul>
      </section>
      <EditorialNextStep contentId={guide.slug} />
      {related && <p>Also read <Link href={related.path}>{related.title}</Link>.</p>}
      {interviewCase.approved && guide.slug === "interview-to-youtube-short" && <p>See the <Link href={interviewCase.path}>original interview and finished Short</Link>.</p>}
    </EditorialPage>
  );
}
