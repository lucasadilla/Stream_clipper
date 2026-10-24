"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { SiteLogo } from "@/components/layout/SiteLogo";
import { AccountMenu } from "@/components/AccountMenu";
import { cn } from "@/lib/cn";

const HERO_HASH = "#clip-now";

const NAV_LINKS = [
  { href: "/#clip-now", label: "Clip now", hash: HERO_HASH },
  { href: "/#features", label: "Features", hash: "#features" },
  { href: "/#how-it-works", label: "Workflow", hash: "#how-it-works" },
  { href: "/#pricing", label: "Pricing", hash: "#pricing" },
  { href: "/#sessions", label: "Sessions", hash: "#sessions" },
  { href: "/#faq", label: "FAQ", hash: "#faq" },
] as const;

const PILL_SPRING = { type: "spring" as const, stiffness: 400, damping: 36 };

function getHeaderOffset(): number {
  const header = document.querySelector<HTMLElement>(".site-header");
  return (header?.offsetHeight ?? 120) + 12;
}

function scrollToSection(hash: string, behavior: ScrollBehavior = "smooth") {
  const id = hash.replace(/^#/, "");
  if (!id) return false;

  const element = document.getElementById(id);
  if (!element) return false;

  const top =
    element.getBoundingClientRect().top + window.scrollY - getHeaderOffset();

  if (window.location.hash !== hash) {
    window.history.pushState(null, "", `${window.location.pathname}${hash}`);
  }

  window.scrollTo({ top: Math.max(0, top), behavior });
  return true;
}

function DesktopNav({
  onHome,
  activeHash,
  hoveredHash,
  onHover,
  onHoverEnd,
  onNavigate,
}: {
  onHome: boolean;
  activeHash: string;
  hoveredHash: string | null;
  onHover: (hash: string) => void;
  onHoverEnd: () => void;
  onNavigate: (hash: string, event?: React.MouseEvent) => void;
}) {
  return (
    <LayoutGroup id="site-header-nav">
      <nav
        className="hidden items-center gap-1 rounded-full border border-[#243524] bg-[#0c100c] p-1.5 lg:flex"
        aria-label="Primary navigation"
        onMouseLeave={onHoverEnd}
      >
        {NAV_LINKS.map((link) => {
          const active = onHome && activeHash === link.hash;
          const hovered = hoveredHash === link.hash && !active;

          return (
            <Link
              key={link.href}
              href={link.href}
              onMouseEnter={() => onHover(link.hash)}
              onClick={(event) => onNavigate(link.hash, event)}
              className={cn(
                "relative z-10 rounded-full px-5 py-2.5 text-base font-medium transition-colors duration-200 xl:px-6",
                active
                  ? "text-[#071006]"
                  : "text-white/70 hover:text-white"
              )}
            >
              {hovered ? (
                <motion.span
                  layoutId="navbar-hover-pill"
                  className="absolute inset-0 rounded-full bg-[#1a2218]"
                  transition={PILL_SPRING}
                  aria-hidden
                />
              ) : null}
              {active ? (
                <motion.span
                  layoutId="navbar-active-pill"
                  className="absolute inset-0 rounded-full bg-[var(--color-accent)] shadow-[0_4px_14px_rgba(149,255,0,0.2)]"
                  transition={PILL_SPRING}
                  aria-hidden
                />
              ) : null}
              <span className="relative z-10">{link.label}</span>
            </Link>
          );
        })}
      </nav>
    </LayoutGroup>
  );
}

function MobileNavLinks({
  onHome,
  activeHash,
  onNavigate,
  onClose,
}: {
  onHome: boolean;
  activeHash: string;
  onNavigate: (hash: string, event?: React.MouseEvent) => void;
  onClose: () => void;
}) {
  return (
    <nav aria-label="Mobile navigation" className="flex flex-col gap-1">
      {NAV_LINKS.map((link, index) => {
        const active = onHome && activeHash === link.hash;
        return (
          <motion.div
            key={link.href}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ delay: index * 0.04, duration: 0.2 }}
          >
            <Link
              href={link.href}
              onClick={(event) => {
                onNavigate(link.hash, event);
                onClose();
              }}
              className={cn(
                "relative block overflow-hidden rounded-lg px-4 py-3.5 text-base font-medium",
                active
                  ? "text-[#071006]"
                  : "text-white/85 hover:bg-white/[0.04] hover:text-white"
              )}
            >
              {active ? (
                <motion.span
                  layoutId="navbar-active-pill-mobile"
                  className="absolute inset-0 rounded-lg bg-[var(--color-accent)]"
                  transition={PILL_SPRING}
                  aria-hidden
                />
              ) : null}
              <span className="relative z-10">{link.label}</span>
            </Link>
          </motion.div>
        );
      })}
    </nav>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const onHome = pathname === "/";
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [activeHash, setActiveHash] = useState("");
  const [hoveredHash, setHoveredHash] = useState<string | null>(null);
  const scrollLockRef = useRef(false);
  const scrollUnlockTimerRef = useRef<number | null>(null);

  const lockScrollSpy = useCallback((durationMs = 1200) => {
    scrollLockRef.current = true;
    if (scrollUnlockTimerRef.current !== null) {
      window.clearTimeout(scrollUnlockTimerRef.current);
    }
    scrollUnlockTimerRef.current = window.setTimeout(() => {
      scrollLockRef.current = false;
      scrollUnlockTimerRef.current = null;
    }, durationMs);
  }, []);

  const navigateToSection = useCallback(
    (hash: string, event?: React.MouseEvent) => {
      if (onHome) {
        event?.preventDefault();
        setActiveHash(hash);
        lockScrollSpy();
        scrollToSection(hash);
        return;
      }
      setActiveHash(hash);
    },
    [lockScrollSpy, onHome]
  );

  const navigateToAction = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (!onHome) return;
      event.preventDefault();
      setActiveHash(HERO_HASH);
      lockScrollSpy();
      scrollToSection("#analyze");
    },
    [lockScrollSpy, onHome]
  );

  useEffect(() => {
    return () => {
      if (scrollUnlockTimerRef.current !== null) {
        window.clearTimeout(scrollUnlockTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setMenuOpen(false);
    setHoveredHash(null);
  }, [pathname]);

  useEffect(() => {
    const updateScroll = () => {
      const y = window.scrollY;
      setScrolled(y > 4);
      if (
        onHome &&
        y < 96 &&
        !window.location.hash &&
        !scrollLockRef.current
      ) {
        setActiveHash(HERO_HASH);
      }
    };
    updateScroll();
    window.addEventListener("scroll", updateScroll, { passive: true });
    return () => window.removeEventListener("scroll", updateScroll);
  }, [onHome]);

  useEffect(() => {
    if (!onHome) return;
    if (window.location.hash) return;

    window.scrollTo(0, 0);
    setActiveHash(HERO_HASH);
  }, [onHome, pathname]);

  useEffect(() => {
    if (!onHome) return;

    const hash = window.location.hash;
    if (!hash) return;

    const isNavTarget =
      NAV_LINKS.some((link) => link.hash === hash) || hash === "#analyze";
    if (!isNavTarget) return;

    const frame = window.requestAnimationFrame(() => {
      lockScrollSpy();
      setActiveHash(hash === "#analyze" ? HERO_HASH : hash);
      scrollToSection(hash);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [lockScrollSpy, onHome, pathname]);

  useEffect(() => {
    if (!onHome) return;

    const sections = NAV_LINKS.map((link) =>
      document.getElementById(link.hash.slice(1))
    ).filter((el): el is HTMLElement => Boolean(el));

    if (!sections.length) return;

    const header = document.querySelector<HTMLElement>(".site-header");
    const offset = (header?.offsetHeight ?? 120) + 12;

    const observer = new IntersectionObserver(
      (entries) => {
        if (scrollLockRef.current) return;

        const visible = entries.filter((entry) => entry.isIntersecting);
        if (!visible.length) return;

        const best = visible.reduce((current, entry) =>
          entry.intersectionRatio > current.intersectionRatio ? entry : current
        );

        const id = best.target.id;
        if (id) setActiveHash(`#${id}`);
      },
      {
        rootMargin: `-${offset}px 0px -50% 0px`,
        threshold: [0, 0.1, 0.25, 0.4, 0.6],
      }
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [onHome, pathname]);

  useEffect(() => {
    if (!onHome) {
      setActiveHash("");
      return;
    }

    const syncFromLocation = () => {
      if (scrollLockRef.current) return;
      const hash = window.location.hash;
      if (hash === "#analyze") {
        setActiveHash(HERO_HASH);
        return;
      }
      if (hash && NAV_LINKS.some((link) => link.hash === hash)) {
        setActiveHash(hash);
      }
    };

    syncFromLocation();
    window.addEventListener("hashchange", syncFromLocation);
    return () => window.removeEventListener("hashchange", syncFromLocation);
  }, [onHome, pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  const actionHref = onHome ? "#analyze" : "/#analyze";
  const actionLabel = onHome ? "Open editor" : "New session";

  return (
    <>
      <header
        className={cn(
          "site-header fixed inset-x-0 top-0 z-[200] border-b border-[#21301f] bg-[#020302]",
          scrolled && "shadow-[0_10px_40px_rgba(0,0,0,0.45)]"
        )}
      >
        <div className="site-header-inner mx-auto grid h-[var(--site-header-height)] w-full max-w-[1440px] grid-cols-[1fr_auto] items-center overflow-visible px-4 sm:px-6 lg:grid-cols-[1fr_auto_1fr] lg:px-8">
          <SiteLogo className="min-w-0" />

          <div className="hidden overflow-visible py-1 lg:flex lg:justify-center">
            <DesktopNav
              onHome={onHome}
              activeHash={activeHash}
              hoveredHash={hoveredHash}
              onHover={setHoveredHash}
              onHoverEnd={() => setHoveredHash(null)}
              onNavigate={navigateToSection}
            />
          </div>

          <div className="flex items-center justify-end gap-3">
            <AccountMenu />
            <Link
              href={actionHref}
              onClick={navigateToAction}
              className="site-header-cta hidden h-14 items-center rounded-lg bg-[var(--color-accent)] px-7 text-sm font-semibold text-[#071006] transition-colors hover:bg-[var(--color-accent-hover)] sm:inline-flex"
            >
              {actionLabel}
            </Link>
            <button
              type="button"
              className="inline-flex h-14 w-14 items-center justify-center rounded-lg border border-[#30462d] bg-[#070a07] text-white transition-colors hover:border-[var(--color-accent)]/50 hover:text-[var(--color-accent)] lg:hidden"
              aria-expanded={menuOpen}
              aria-controls="mobile-site-nav"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              onClick={() => setMenuOpen((open) => !open)}
            >
              {menuOpen ? (
                <X className="h-5 w-5" aria-hidden />
              ) : (
                <Menu className="h-5 w-5" aria-hidden />
              )}
            </button>
          </div>
        </div>
      </header>

      <AnimatePresence>
        {menuOpen ? (
          <>
            <motion.button
              type="button"
              key="mobile-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="fixed inset-0 top-[var(--site-header-height)] z-[190] bg-black/60 lg:hidden"
              aria-label="Close menu"
              onClick={() => setMenuOpen(false)}
            />
            <motion.nav
              id="mobile-site-nav"
              key="mobile-nav"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="site-mobile-nav fixed inset-x-0 top-[var(--site-header-height)] z-[195] max-h-[calc(100svh-var(--site-header-height))] overflow-y-auto border-b border-[#30462d] bg-[#020302] shadow-[0_20px_50px_rgba(0,0,0,0.45)] lg:hidden"
              aria-label="Mobile navigation"
            >
              <div className="mx-auto max-w-[1440px] px-4 py-3 sm:px-6">
                <MobileNavLinks
                  onHome={onHome}
                  activeHash={activeHash}
                  onNavigate={navigateToSection}
                  onClose={() => setMenuOpen(false)}
                />
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ delay: 0.1, duration: 0.2 }}
                  className="mt-2"
                >
                  <Link
                    href={actionHref}
                    onClick={(event) => {
                      navigateToAction(event);
                      setMenuOpen(false);
                    }}
                    className="flex h-11 items-center justify-center rounded-lg bg-[var(--color-accent)] text-sm font-semibold text-[#071006] transition-colors hover:bg-[var(--color-accent-hover)]"
                  >
                    {actionLabel}
                  </Link>
                </motion.div>
              </div>
            </motion.nav>
          </>
        ) : null}
      </AnimatePresence>
    </>
  );
}
