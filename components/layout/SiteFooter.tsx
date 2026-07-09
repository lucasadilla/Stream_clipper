import Link from "next/link";
import { SiteLogo } from "@/components/layout/SiteLogo";

const FOOTER_LINKS = {
  Product: [
    { href: "/#features", label: "System" },
    { href: "/#how-it-works", label: "Workflow" },
    { href: "/#analyze", label: "Open timeline" },
  ],
  Editor: [
    { href: "/#sessions", label: "Recent sessions" },
    { href: "/#features", label: "Timeline editor" },
    { href: "/#features", label: "Transcript search" },
  ],
};

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-auto border-t border-[var(--color-card-border)] bg-[#020302]">
      <div className="mx-auto max-w-[1440px] px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2 lg:col-span-1">
            <SiteLogo />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-[var(--color-muted)]">
              Live streams into searchable timelines, captioned cuts, and native
              or vertical exports.
            </p>
          </div>

          {Object.entries(FOOTER_LINKS).map(([title, links]) => (
            <div key={title}>
              <h3 className="mb-3 text-xs font-semibold uppercase text-[var(--color-muted)]">
                {title}
              </h3>
              <ul className="space-y-2">
                {links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-[var(--color-foreground)]/80 transition-colors hover:text-[var(--color-accent)]"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div>
            <h3 className="mb-3 text-xs font-semibold uppercase text-[var(--color-muted)]">
              Export
            </h3>
            <ul className="space-y-2 text-sm text-[var(--color-foreground)]/80">
              <li>Native - original 16:9 stream</li>
              <li>Vertical - 9:16 Shorts crop</li>
              <li className="pt-1 text-xs text-[var(--color-muted)]">
                Rendered locally with FFmpeg
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-[var(--color-card-border)] pt-6 text-xs text-[var(--color-muted)] sm:flex-row">
          <p>Copyright {year} Stream Clipper. Built for creators.</p>
          <p>Files stored locally in ./storage on your machine.</p>
        </div>
      </div>
    </footer>
  );
}
