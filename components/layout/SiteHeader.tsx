"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SiteLogo } from "@/components/layout/SiteLogo";
import { AccountMenu } from "@/components/AccountMenu";
import { cn } from "@/lib/cn";

const NAV_LINKS = [
  { href: "/#features", label: "System", index: "01" },
  { href: "/#how-it-works", label: "Workflow", index: "02" },
  { href: "/#pricing", label: "Pricing", index: "03" },
  { href: "/#faq", label: "FAQ", index: "04" },
  { href: "/#sessions", label: "Sessions", index: "05" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const onHome = pathname === "/";
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 12);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);

  const actionHref = onHome ? "#analyze" : "/#analyze";

  return (
    <header
      className={cn(
        "site-header sticky top-0 z-50 border-b border-[#21301f] bg-[#020302]/92 backdrop-blur-xl",
        scrolled && "site-header-scrolled"
      )}
    >
      <div className="mx-auto grid h-16 max-w-[1440px] grid-cols-[1fr_auto] items-stretch px-4 sm:px-6 lg:grid-cols-[1fr_auto_1fr] lg:px-8">
        <div className="flex min-w-0 items-center">
          <SiteLogo />
        </div>

        <nav className="hidden h-full items-stretch border-x border-[#21301f] lg:flex" aria-label="Primary navigation">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="site-nav-link group relative flex min-w-[5.25rem] flex-col justify-center border-r border-[#21301f] px-4 last:border-r-0"
            >
              <span className="text-[9px] font-semibold leading-none text-[#95ff00]/55 transition-colors group-hover:text-[#95ff00]">
                {link.index}
              </span>
              <span className="mt-1.5 text-xs font-semibold text-white/62 transition-colors group-hover:text-white">
                {link.label}
              </span>
            </Link>
          ))}
        </nav>

        <div className="flex items-center justify-end gap-2 sm:gap-3">
          <AccountMenu />
          <Link
            href={actionHref}
            className="site-header-cta hidden h-10 items-center gap-5 bg-[#95ff00] px-4 text-xs font-bold text-[#071006] transition-colors hover:bg-[#b7ff3c] sm:inline-flex"
          >
            <span>{onHome ? "Open editor" : "New session"}</span>
            <span className="text-base leading-none" aria-hidden="true">
              &rarr;
            </span>
          </Link>
          <button
            type="button"
            className="flex h-10 min-w-[3.75rem] items-center justify-center border border-[#30462d] px-3 text-[11px] font-semibold text-white transition-colors hover:border-[#95ff00]/60 hover:bg-white/[0.04] lg:hidden"
            aria-expanded={menuOpen}
            aria-controls="mobile-site-nav"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? "Close" : "Menu"}
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav
          id="mobile-site-nav"
          className="site-mobile-nav absolute inset-x-0 top-full border-b border-[#30462d] bg-[#020302]/98 px-4 pb-4 shadow-[0_24px_50px_rgba(0,0,0,0.5)] backdrop-blur-xl sm:px-6 lg:hidden"
          aria-label="Mobile navigation"
        >
          <div className="mx-auto max-w-[1440px] border-x border-[#21301f]">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className="group grid grid-cols-[3rem_1fr_auto] items-center border-b border-[#21301f] px-4 py-4 text-white"
              >
                <span className="text-[10px] font-semibold text-[#95ff00]/65">
                  {link.index}
                </span>
                <span className="font-[var(--font-display)] text-2xl leading-none">
                  {link.label}
                </span>
                <span className="text-[#95ff00] transition-transform group-hover:translate-x-1" aria-hidden="true">
                  &rarr;
                </span>
              </Link>
            ))}
            <Link
              href={actionHref}
              onClick={() => setMenuOpen(false)}
              className="flex min-h-14 items-center justify-between bg-[#95ff00] px-4 text-sm font-bold text-[#071006] sm:hidden"
            >
              {onHome ? "Open editor" : "New session"}
              <span className="text-lg" aria-hidden="true">
                &rarr;
              </span>
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}
