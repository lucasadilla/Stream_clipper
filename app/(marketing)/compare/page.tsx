import Link from "next/link";
import { EditorialNextStep, EditorialPage } from "@/components/EditorialPage";
import styles from "@/components/EditorialPage.module.css";
import { comparisonIndex, comparisons } from "@/lib/editorialComparisons";
import { editorialMetadata } from "@/lib/editorialContent";

export const metadata = editorialMetadata(comparisonIndex);

export default function CompareIndex() {
  return (
    <EditorialPage title="Compare clipping tools" description={comparisonIndex.description} category="Comparisons">
      <div className={styles.cards}>
        {comparisons.map(entry => (
          <section className={styles.card} key={entry.slug}>
            <h2><Link href={entry.path}>Clipper vs. {entry.name}</Link></h2>
            <p>{entry.description}</p>
          </section>
        ))}
      </div>
      <EditorialNextStep contentId="compare-index" />
    </EditorialPage>
  );
}
