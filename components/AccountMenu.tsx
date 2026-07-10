"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fetchJson } from "@/lib/apiClient";
import type { BillingAccountSummary } from "@/services/billingService";

export function AccountMenu() {
  const router = useRouter();
  const [account, setAccount] = useState<BillingAccountSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetchJson<{ account: BillingAccountSummary | null }>("/api/auth/me")
      .then(({ data }) => setAccount(data.account))
      .finally(() => setLoading(false));
  }, []);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setAccount(null);
    router.refresh();
  }

  if (loading) {
    return (
      <span className="hidden text-xs text-[var(--color-muted)] sm:inline">
        …
      </span>
    );
  }

  if (!account) {
    return (
      <Link
        href="/login"
        className="text-sm font-medium px-3 py-2 rounded-lg text-[var(--color-muted)] hover:text-white hover:bg-white/5 transition-colors"
      >
        Sign in
      </Link>
    );
  }

  const label = account.displayName?.trim() || account.email || "Account";

  return (
    <div className="hidden items-center gap-2 sm:flex">
      <Link
        href="/profile"
        className="max-w-[10rem] truncate text-xs text-[var(--color-muted)] hover:text-white transition-colors"
        title="Open profile"
      >
        {account.unlimitedAccess ? "∞ " : ""}
        {label}
      </Link>
      <button
        type="button"
        onClick={() => void handleLogout()}
        className="text-xs px-2 py-1 rounded text-[var(--color-muted)] hover:text-white hover:bg-white/5"
      >
        Sign out
      </button>
    </div>
  );
}
