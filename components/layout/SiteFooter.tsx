import Link from "next/link";
import { SiteLogo } from "@/components/layout/SiteLogo";

const FOOTER_LINKS = {
  Product: [
    { href: "/#clip-now", label: "Clip now" },
    { href: "/#features", label: "System" },
    { href: "/#how-it-works", label: "Workflow" },
    { href: "/#pricing", label: "Pricing" },
    { href: "/#faq", label: "FAQ" },
    { href: "/#analyze", label: "Start clipping" },
  ],
  Editor: [
    { href: "/#sessions", label: "Active session" },
    { href: "/#features", label: "Timeline editor" },
    { href: "/#features", label: "Transcript search" },
  ],
  Legal: [
    { href: "/terms", label: "Terms of Service" },
    { href: "/privacy", label: "Privacy Policy" },
  ],
};

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-auto border-t border-[var(--color-card-border)] bg-[#020302]">
      <div className="mx-auto max-w-[1440px] px-4 py-12 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-10 lg:flex-row lg:items-start lg:justify-between lg:gap-8">
          <div className="min-w-0 lg:max-w-[220px] lg:flex-1">
            <SiteLogo />
            <p className="mt-4 text-sm leading-relaxed text-[var(--color-muted)]">
              Live streams into searchable timelines, captioned cuts, and native
              or vertical exports.
            </p>
          </div>

          {Object.entries(FOOTER_LINKS).map(([title, links]) => (
            <div key={title} className="min-w-0 lg:flex-1">
              <h3 className="mb-3 text-xs font-semibold uppercase text-[var(--color-muted)]">
                {title}
              </h3>
              <ul className="space-y-2">
                {links.map((link) => (
                  <li key={`${title}-${link.label}`}>
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

          <div className="min-w-0 lg:flex-1">
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
          <p>Copyright {year} Clipper. Built for creators.</p>
          <p>Files stored locally in ./storage on your machine.</p>
        </div>
      </div>
    </footer>
  );
}
