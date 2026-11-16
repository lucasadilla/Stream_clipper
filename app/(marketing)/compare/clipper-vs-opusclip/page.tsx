import Link from "next/link";
import { EditorialNextStep, EditorialPage } from "@/components/EditorialPage";
import styles from "@/components/EditorialPage.module.css";
import { comparison, editorialMetadata, guides } from "@/lib/editorialContent";
import { PRICING_PLANS } from "@/lib/pricing";

export const metadata = editorialMetadata(comparison);

const opusPricing = "https://www.opus.pro/pricing";
const creator = PRICING_PLANS.find(plan => plan.id === "creator");

const rows = [
  {
    topic: "Finding moments",
    clipper: "Start from AI clip suggestions or use transcript search to jump to a line and set the cut yourself. Clipper also has a timeline workflow for supported live streams.",
    opus: "OpusClip lists automatic clip generation and Virality Score, with a workflow that starts from an upload or a supported video link.",
  },
  {
    topic: "Captions and framing",
    clipper: "Clipper includes caption editing and face-aware framing, with native and vertical exports.",
    opus: "OpusClip lists animated captions and auto reframe. Its public plan page places multiple aspect ratios and custom fonts on Pro.",
  },
  {
    topic: "Usage limits",
    clipper: `Creator includes ${creator?.entitlements.exportsLimit ?? 20} finished videos per month. A clip counts once across platform versions.`,
    opus: "OpusClip lists 60 monthly credits on Free and 150 on Starter. Check its credit rules against the lengths of the videos you normally process.",
  },
  {
    topic: "Evaluation",
    clipper: "The sample lets you preview a prepared Short and compare the 16:9 source without creating a project.",
    opus: "OpusClip lists a Free plan with automatic captions and reframing, watermarked exports, and no editing. Paid tiers list an editor and watermark removal.",
  },
];

export default function ClipperVersusOpusClip() {
  return (
    <EditorialPage title={comparison.title} description={comparison.description} category="Tool comparison">
      <section className={styles.section}>
        <h2>Which workflow fits your source?</h2>
        <p>Try Clipper’s sample if you usually know the moment you want and need to find it in a transcript, trim it, and check the framing. Consider OpusClip if you want to review a batch of automatic picks or need one of its listed Pro features, such as export to Premiere Pro or DaVinci Resolve.</p>
        <p>Clipper publishes this comparison. The table describes the products’ public documentation as checked on November 16, 2026. Hands-on measurements for the same footage are pending.</p>
      </section>
      <section className={styles.section}>
        <h2>Editing, export, and plans</h2>
        <div className={styles.tableWrap} role="region" aria-label="Feature comparison table" tabIndex={0}>
          <table className={styles.table}>
            <thead><tr><th scope="col">Workflow</th><th scope="col">Clipper</th><th scope="col">OpusClip</th></tr></thead>
            <tbody>{rows.map(row => (
              <tr key={row.topic}><th scope="row">{row.topic}</th><td>{row.clipper}</td><td>{row.opus}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <p>Check current plan details on <Link href="/#pricing">Clipper’s pricing page</Link> and <a href={opusPricing}>OpusClip’s pricing page</a>.</p>
      </section>
      <section className={styles.section}>
        <h2>How to compare the outputs on your footage</h2>
        <ol>
          <li>Import the same original file. Review the first automatic picks for context, complete endings, and duplicate moments.</li>
          <li>Then trim the same moment in both tools. Use the same 9:16 target and export with captions enabled.</li>
          <li>Play both files at phone size. Count caption fixes, check the widest shot and every speaker change, and record editing time and export wait separately.</li>
        </ol>
      </section>
      <EditorialNextStep contentId="clipper-vs-opusclip" />
      <p>Try that process with the <Link href={guides[0].path}>interview-to-Short editing guide</Link>.</p>
    </EditorialPage>
  );
}
