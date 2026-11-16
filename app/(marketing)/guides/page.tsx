import Link from "next/link";
import { EditorialNextStep, EditorialPage } from "@/components/EditorialPage";
import styles from "@/components/EditorialPage.module.css";
import { comparisonIndex } from "@/lib/editorialComparisons";
import { editorialMetadata, guides, interviewCase, resources } from "@/lib/editorialContent";

export const metadata = editorialMetadata(resources);

export default function GuidesIndex() {
  const entries = [
    ...guides,
    ...(interviewCase.approved ? [{ ...interviewCase, topic: "Case study" }] : []),
    { ...comparisonIndex, title: "Compare clipping tools", topic: "Comparisons" },
  ];
  return (
    <EditorialPage title="Guides & editing examples" description={resources.description}>
      <div className={styles.cards}>
        {entries.map(entry => (
          <section className={styles.card} key={entry.path}>
            <small>{entry.topic}</small>
            <h2><Link href={entry.path}>{entry.title}</Link></h2>
            <p>{entry.description}</p>
          </section>
        ))}
      </div>
      <EditorialNextStep contentId="guides-index" />
    </EditorialPage>
  );
}
