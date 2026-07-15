"use client";

export default function VerifyRequestPage() {
  return (
    <section className="mx-auto flex min-h-[60vh] max-w-lg flex-col justify-center px-4 py-16">
      <p className="text-xs font-semibold uppercase text-[var(--color-accent)]">
        Check your email
      </p>
      <h1 className="mt-3 text-3xl font-semibold text-white">Magic link sent</h1>
      <p className="mt-4 text-sm leading-6 text-[var(--color-muted)]">
        Open the Clipper sign-in link from your inbox to finish signing in. The
        link expires shortly for security.
      </p>
    </section>
  );
}
