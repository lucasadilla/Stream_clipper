import Link from "next/link";
import { notFound } from "next/navigation";
import { EditorialNextStep, EditorialPage } from "@/components/EditorialPage";
import styles from "@/components/EditorialPage.module.css";
import { comparisons } from "@/lib/editorialComparisons";
import { editorialMetadata } from "@/lib/editorialContent";

type Props = { params: Promise<{ slug: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return comparisons.map(({ slug }) => ({ slug }));
}

async function getComparison(params: Props["params"]) {
  const { slug } = await params;
  return comparisons.find(entry => entry.slug === slug) ?? notFound();
}

export async function generateMetadata({ params }: Props) {
  return editorialMetadata(await getComparison(params));
}

export default async function ComparisonPage({ params }: Props) {
  const entry = await getComparison(params);
  return (
    <EditorialPage title={entry.title} description={entry.description} category="Tool comparison" parentHref="/compare" parentLabel="All comparisons">
      <section className={styles.section}>
        <h2>Which workflow fits your source?</h2>
        <p>{entry.decision}</p>
        <p>Clipper publishes this comparison using public product documentation. The workflows and plan details below are based on what each provider publishes.</p>
      </section>
      <section className={styles.section}>
        <h2>Features and plans</h2>
        <div className={styles.tableWrap} role="region" aria-label="Feature comparison table" tabIndex={0}>
          <table className={styles.table}>
            <thead><tr><th scope="col">Workflow</th><th scope="col">Clipper</th><th scope="col">{entry.name}</th></tr></thead>
            <tbody>{entry.rows.map(row => (
              <tr key={row.topic}><th scope="row">{row.topic}</th><td>{row.clipper}</td><td>{row.competitor}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <ul aria-label="Product sources">
          <li><Link href="/#pricing">Clipper plans</Link></li>
          {entry.sources.map(source => <li key={source.url}><a href={source.url}>{source.label}</a></li>)}
        </ul>
      </section>
      <section className={styles.section}>
        <h2>What to test with your footage</h2>
        <ol>{entry.trial.map(step => <li key={step}>{step}</li>)}</ol>
      </section>
      <EditorialNextStep contentId={entry.slug} />
      <section className={styles.section}>
        <h2>More comparisons</h2>
        <ul>{comparisons.filter(other => other.slug !== entry.slug).map(other => (
          <li key={other.slug}><Link href={other.path}>Clipper vs. {other.name}</Link></li>
        ))}</ul>
      </section>
    </EditorialPage>
  );
}
