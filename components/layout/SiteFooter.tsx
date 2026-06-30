import Link from "next/link";
import { SiteLogo } from "@/components/layout/SiteLogo";

const FOOTER_LINKS = {
  Product: [
    { href: "/#features", label: "Features" },
    { href: "/#how-it-works", label: "How it works" },
    { href: "/#analyze", label: "Analyze a stream" },
  ],
  Editor: [
    { href: "/#sessions", label: "Recent sessions" },
    { href: "/#features", label: "Timeline editor" },
    { href: "/#features", label: "AI clip finder" },
  ],
};

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-[var(--color-card-border)] bg-[var(--color-card)]/40 mt-auto">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10">
          <div className="sm:col-span-2 lg:col-span-1">
            <SiteLogo />
            <p className="mt-4 text-sm text-[var(--color-muted)] leading-relaxed max-w-xs">
              Turn YouTube livestreams and VODs into clips with AI — edit on a
              timeline, export native or vertical.
            </p>
          </div>

          {Object.entries(FOOTER_LINKS).map(([title, links]) => (
            <div key={title}>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)] mb-3">
                {title}
              </h3>
              <ul className="space-y-2">
                {links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-[var(--color-foreground)]/80 hover:text-[var(--color-accent)] transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)] mb-3">
              Export
            </h3>
            <ul className="space-y-2 text-sm text-[var(--color-foreground)]/80">
              <li>Native — original 16:9 stream</li>
              <li>Vertical — 9:16 Shorts crop</li>
              <li className="text-[var(--color-muted)] text-xs pt-1">
                Rendered locally with FFmpeg
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-[var(--color-card-border)] flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[var(--color-muted)]">
          <p>© {year} Stream Clipper. Built for creators.</p>
          <p>Files stored locally in ./storage on your machine.</p>
        </div>
      </div>
    </footer>
  );
}
