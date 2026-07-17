import Link from "next/link";

export function LegalDoc({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
        Legal
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
        {title}
      </h1>
      <p className="mt-2 text-sm text-[var(--color-muted)]">
        Last updated: {updated}
      </p>
      <div className="prose-legal mt-10 space-y-6 text-sm leading-relaxed text-[var(--color-foreground)]/85 [&_h2]:mt-8 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-white [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5 [&_a]:text-[var(--color-accent)] [&_a]:underline-offset-2 hover:[&_a]:underline">
        {children}
      </div>
      <p className="mt-12 text-sm text-[var(--color-muted)]">
        <Link href="/" className="text-[var(--color-accent)] hover:underline">
          ← Back to Clipper
        </Link>
      </p>
    </div>
  );
}
