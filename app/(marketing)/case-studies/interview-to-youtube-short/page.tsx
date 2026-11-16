import Link from "next/link";
import { notFound } from "next/navigation";
import { EditorialNextStep, EditorialPage } from "@/components/EditorialPage";
import styles from "@/components/EditorialPage.module.css";
import { editorialMetadata, guides, interviewCase, youtubeEmbedUrl } from "@/lib/editorialContent";
import { sampleShort } from "@/lib/heroShorts";
import { sampleTimestamp } from "@/lib/sampleTimeline";

export const metadata = editorialMetadata(interviewCase, interviewCase.approved);

export default function InterviewCaseStudy() {
  if (!interviewCase.approved) notFound();
  const short = sampleShort();
  const source = short.source ?? notFound();
  const sourceParams = new URLSearchParams({
    start: String(source.startSeconds),
    end: String(source.endSeconds),
  });

  return (
    <EditorialPage title={interviewCase.title} description={interviewCase.description} category="Case study">
      <div className={styles.sourcePair}>
        <div>
          <iframe className={styles.video} src={`${youtubeEmbedUrl(source.videoId)}?${sourceParams}`}
            title="Original interview excerpt" allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
          <p><a href={`https://www.youtube.com/watch?v=${source.videoId}&t=${source.startSeconds}s`}>Original interview, {sampleTimestamp(source.startSeconds)}–{sampleTimestamp(source.endSeconds)}</a></p>
        </div>
        <div>
          <iframe className={`${styles.video} ${styles.portrait}`} src={youtubeEmbedUrl(short.id)}
            title="Finished vertical Clipper Short" allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
          <p><a href={`https://www.youtube.com/shorts/${short.id}`}>Finished Short on @StreamClipperAdmin</a></p>
        </div>
      </div>
      <section className={styles.section}>
        <h2>What changed in the edit</h2>
        <p>The original excerpt starts earlier to include the lead-in. The published cut concentrates on the interview answer and can be viewed on its own. Compare the opening lines in both players to see how much context each version needs.</p>
        <p>The source uses a landscape frame. The Short uses a 9:16 frame and captions embedded in the video. Watch how the smaller frame directs attention to the speaker, and read along with the captions to see what information survives at phone size.</p>
      </section>
      <section className={styles.section}>
        <h2>Result</h2>
        <p>One finished vertical Short from an interview excerpt. The published Short has its current view count on YouTube.</p>
        <p>Use the <Link href={guides[0].path}>interview editing guide</Link> to apply the same checks to a recording of your own.</p>
      </section>
      <EditorialNextStep contentId="interview-clipping-case-study" />
    </EditorialPage>
  );
}
