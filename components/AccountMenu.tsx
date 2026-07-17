"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { User } from "lucide-react";
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

const AVATAR_TRIGGER_CLASS =
  "inline-flex shrink-0 overflow-visible rounded-full border-0 bg-transparent p-0 transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]";

/** Border lives on the inner span — button elements reset border in Tailwind preflight. */
const AVATAR_FACE_CLASS =
  "box-border flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#2f3d2c] text-sm font-medium text-white";

function AvatarFace({ children }: { children: ReactNode }) {
  return (
    <span
      className={AVATAR_FACE_CLASS}
      style={{ border: "2px solid #c8dcc2" }}
    >
      {children}
    </span>
  );
}

export function AccountMenu() {
  const router = useRouter();
  const pathname = usePathname();
  const menuRef = useRef<HTMLDivElement>(null);
  const [account, setAccount] = useState<BillingAccountSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchJson<{ account: BillingAccountSummary | null }>("/api/auth/me")
      .then(({ data }) => {
        if (!cancelled) setAccount(data.account);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

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
    return (
      <span
        className="box-border h-10 w-10 shrink-0 animate-pulse rounded-full bg-[#2f3d2c]/60"
        style={{ border: "2px solid #c8dcc2" }}
        aria-label="Loading account"
      />
    );
  }

  if (!account) {
    return (
      <Link href="/login" className={AVATAR_TRIGGER_CLASS} aria-label="Sign in">
        <AvatarFace>
          <User className="h-5 w-5 text-white/90" aria-hidden />
        </AvatarFace>
      </Link>
    );
  }

  const label = account.displayName?.trim() || account.email || "Account";

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={AVATAR_TRIGGER_CLASS}
        aria-label="Open account menu"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <AvatarFace>{accountInitials(label)}</AvatarFace>
      </button>

      {open && (
        <div
          role="menu"
          className="site-account-menu absolute right-0 top-[calc(100%+0.6rem)] z-[210] w-[min(18rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-[#30462d] bg-[#050805] shadow-[0_20px_50px_rgba(0,0,0,0.55)]"
        >
          <div className="border-b border-[#21301f] p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-accent)]">
              {account.unlimitedAccess ? "Comp access" : `${planLabel(account.plan)} plan`}
            </p>
            <p className="mt-2 truncate text-sm font-semibold text-white">
              {label}
            </p>
            {account.displayName && account.email && (
              <p className="mt-1 truncate text-xs text-white/45">{account.email}</p>
            )}
          </div>
          <Link
            role="menuitem"
            href="/profile"
            onClick={() => setOpen(false)}
            className="flex items-center justify-between px-4 py-3 text-sm font-medium text-white/75 transition-colors hover:bg-white/[0.04] hover:text-white"
          >
            Account settings
          </Link>
          <button
            role="menuitem"
            type="button"
            onClick={() => void handleLogout()}
            className="w-full border-t border-[#21301f] px-4 py-3 text-left text-sm font-medium text-white/55 transition-colors hover:bg-white/[0.04] hover:text-white"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
