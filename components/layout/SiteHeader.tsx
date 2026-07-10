"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SiteLogo } from "@/components/layout/SiteLogo";
import { AccountMenu } from "@/components/AccountMenu";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { href: "/#features", label: "System" },
  { href: "/#how-it-works", label: "Workflow" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
  { href: "/#sessions", label: "Sessions" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const onHome = pathname === "/";

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--color-card-border)]/80 bg-[var(--color-background)]/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <SiteLogo />

        <nav className="hidden md:flex items-center gap-1">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm text-[var(--color-muted)] hover:text-white px-3 py-2 rounded-lg hover:bg-white/5 transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <AccountMenu />
          {onHome ? (
            <a
              href="#analyze"
              className={cn(
                "text-sm font-medium px-4 py-2 rounded-lg",
                "bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-black transition-colors"
              )}
            >
              Open timeline
            </a>
          ) : (
            <Link
              href="/#analyze"
              className={cn(
                "text-sm font-medium px-4 py-2 rounded-lg",
                "bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-black transition-colors"
              )}
            >
              New session
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
