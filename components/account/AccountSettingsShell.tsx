"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export const ACCOUNT_SETTINGS_TABS = [
  { href: "/settings/connected-accounts", label: "Connected accounts" },
  { href: "/settings/publishing", label: "Publishing" },
  { href: "/profile", label: "Profile" },
] as const;

export function AccountSettingsNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Account settings"
      className="mt-5 flex flex-wrap gap-2"
    >
      {ACCOUNT_SETTINGS_TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "inline-flex border px-4 py-2 text-sm font-semibold transition-colors",
              active
                ? "border-[var(--color-accent)]/50 bg-[var(--color-accent)]/10 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/20"
                : "border-[#21301f] text-[#9aa49a] hover:border-[var(--color-accent)] hover:text-white"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function AccountSettingsShell({
  title,
  description,
  message,
  error,
  children,
}: {
  title: string;
  description: string;
  message?: string | null;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <section className="relative isolate min-h-[calc(100svh-var(--site-header-height,7.5rem))] overflow-hidden border-b border-[var(--color-card-border)] bg-[#020302]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(149,255,0,0.08),transparent_42%),radial-gradient(circle_at_bottom_right,rgba(149,255,0,0.05),transparent_36%)]" />

      <div className="relative mx-auto max-w-[900px] px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
        <p className="text-xs font-semibold uppercase text-[var(--color-accent)] sm:text-sm">
          Clipper / account
        </p>
        <h1 className="marketing-display-title mt-4 font-semibold text-white">
          {title}
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-white/74">
          {description}
        </p>

        <AccountSettingsNav />

        {(error || message) && (
          <p
            className={cn(
              "mt-6 text-sm",
              error ? "text-[#ffb84d]" : "text-[var(--color-accent)]"
            )}
          >
            {error ?? message}
          </p>
        )}

        {children}
      </div>
    </section>
  );
}

export function AccountSettingsPanels({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mt-10 grid gap-px overflow-hidden border border-[var(--color-card-border)] bg-[var(--color-card-border)]",
        className
      )}
    >
      {children}
    </div>
  );
}

export function AccountSettingsPanel({
  title,
  children,
  className,
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("bg-[#050805] p-6 sm:p-8", className)}>
      {title ? (
        <p className="text-xs font-semibold uppercase text-[var(--color-accent)]">
          {title}
        </p>
      ) : null}
      <div className={title ? "mt-6" : undefined}>{children}</div>
    </div>
  );
}
