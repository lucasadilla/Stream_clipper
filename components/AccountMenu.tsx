"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fetchJson } from "@/lib/apiClient";
import type { BillingAccountSummary } from "@/services/billingService";

function accountInitials(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0]![0] ?? ""}${words[1]![0] ?? ""}`.toUpperCase();
  }
  return label.slice(0, 2).toUpperCase();
}

function planLabel(plan: string): string {
  return `${plan.charAt(0).toUpperCase()}${plan.slice(1)}`;
}

export function AccountMenu() {
  const router = useRouter();
  const menuRef = useRef<HTMLDivElement>(null);
  const [account, setAccount] = useState<BillingAccountSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    void fetchJson<{ account: BillingAccountSummary | null }>("/api/auth/me")
      .then(({ data }) => setAccount(data.account))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!open) return;
    const closeMenu = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (
        event instanceof MouseEvent &&
        menuRef.current?.contains(event.target as Node)
      ) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("mousedown", closeMenu);
    document.addEventListener("keydown", closeMenu);
    return () => {
      document.removeEventListener("mousedown", closeMenu);
      document.removeEventListener("keydown", closeMenu);
    };
  }, [open]);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setOpen(false);
    setAccount(null);
    router.refresh();
  }

  if (loading) {
    return <span className="block h-9 w-9 animate-pulse border border-[#30462d] bg-white/[0.035]" aria-label="Loading account" />;
  }

  if (!account) {
    return (
      <Link
        href="/login"
        className="inline-flex h-10 items-center px-2 text-xs font-semibold text-white/66 transition-colors hover:text-white sm:px-3"
      >
        Sign in
      </Link>
    );
  }

  const label = account.displayName?.trim() || account.email || "Account";

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex h-10 w-10 items-center justify-center border border-[#30462d] bg-[#070a07] text-[10px] font-bold text-[#dfffc1] transition-colors hover:border-[#95ff00]/60 hover:bg-[#0d140b]"
        aria-label="Open account menu"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {accountInitials(label)}
      </button>

      {open && (
        <div
          role="menu"
          className="site-account-menu absolute right-0 top-[calc(100%+0.75rem)] w-[min(18rem,calc(100vw-2rem))] border border-[#30462d] bg-[#050805]/98 shadow-[0_20px_50px_rgba(0,0,0,0.55)] backdrop-blur-xl"
        >
          <div className="border-b border-[#21301f] p-4">
            <p className="text-[9px] font-bold uppercase text-[#95ff00]">
              {account.unlimitedAccess ? "Comp access" : `${planLabel(account.plan)} plan`}
            </p>
            <p className="mt-2 truncate text-sm font-semibold text-white">
              {label}
            </p>
            {account.displayName && account.email && (
              <p className="mt-1 truncate text-xs text-white/42">{account.email}</p>
            )}
          </div>
          <Link
            role="menuitem"
            href="/profile"
            onClick={() => setOpen(false)}
            className="flex items-center justify-between border-b border-[#21301f] px-4 py-3 text-xs font-semibold text-white/72 transition-colors hover:bg-white/[0.04] hover:text-white"
          >
            Account settings
            <span className="text-[#95ff00]" aria-hidden="true">
              &rarr;
            </span>
          </Link>
          <button
            role="menuitem"
            type="button"
            onClick={() => void handleLogout()}
            className="w-full px-4 py-3 text-left text-xs font-semibold text-white/52 transition-colors hover:bg-white/[0.04] hover:text-white"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
