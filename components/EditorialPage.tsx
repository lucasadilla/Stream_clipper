import Link from "next/link";
import type { ReactNode } from "react";
import { EditorialAction } from "@/components/EditorialAction";
import styles from "./EditorialPage.module.css";

export function EditorialPage({
  title, description, category, parentHref = "/guides", parentLabel = "Guides & examples", children,
}: {
  title: string;
  description: string;
  category?: string;
  parentHref?: string;
  parentLabel?: string;
  children: ReactNode;
}) {
  return (
    <article className={styles.page}>
      {category && <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        <Link href={parentHref}>{parentLabel}</Link><span aria-hidden="true">/</span><span>{category}</span>
      </nav>}
      <header className={styles.header}>
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      {children}
    </article>
  );
}

export function EditorialNextStep({ contentId }: { contentId: string }) {
  return (
    <aside className={styles.nextStep} aria-label="Try Clipper">
      <div>
        <h2>Try the edit yourself</h2>
        <p>Preview a prepared clip, adjust the cut, and compare it with the original.</p>
      </div>
      <div className={styles.actions}>
        <EditorialAction contentId={contentId} destination="sample" className={styles.primary}>Try the sample</EditorialAction>
        <EditorialAction contentId={contentId} destination="editor" className={styles.secondary}>Start with your video</EditorialAction>
      </div>
    </aside>
  );
}
