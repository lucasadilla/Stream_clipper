"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SiteLogo } from "@/components/layout/SiteLogo";
import { fetchJson } from "@/lib/apiClient";
import type { BillingAccountSummary } from "@/services/billingService";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [account, setAccount] = useState<BillingAccountSummary | null>(null);

  useEffect(() => {
    void fetchJson<{ account: BillingAccountSummary | null }>("/api/auth/me").then(
      ({ data }) => {
        if (data.account) setAccount(data.account);
      }
    );
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { ok, data } = await fetchJson<{
        account?: BillingAccountSummary;
        error?: string;
      }>("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          inviteCode: inviteCode.trim() || undefined,
        }),
      });
      if (!ok || !data.account) {
        throw new Error(data.error ?? "Login failed");
      }
      setAccount(data.account);
      router.push("/#analyze");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setAccount(null);
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-[var(--color-background)] text-white">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
        <div className="mb-8">
          <SiteLogo />
        </div>

        <h1 className="text-3xl font-semibold">Sign in</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">
          Use your allowlisted email for unlimited access, or enter an invite code
          from the team. Everyone else can subscribe on the{" "}
          <Link href="/#pricing" className="text-[var(--color-accent)] hover:underline">
            pricing page
          </Link>
          .
        </p>

        {account ? (
          <div className="mt-8 rounded-xl border border-[var(--color-card-border)] bg-[#050805] p-5 space-y-4">
            <p className="text-sm text-[var(--color-muted)]">Signed in as</p>
            <p className="font-medium">{account.email}</p>
            {account.unlimitedAccess && (
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-accent)]">
                Unlimited access
              </p>
            )}
            <div className="flex gap-2">
              <Link
                href="/#analyze"
                className="flex-1 rounded-lg bg-[var(--color-accent)] px-4 py-2.5 text-center text-sm font-semibold text-black"
              >
                Open app
              </Link>
              <button
                type="button"
                onClick={() => void handleLogout()}
                className="rounded-lg border border-[#333] px-4 py-2.5 text-sm text-[#ccc] hover:bg-[#111]"
              >
                Sign out
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="mt-8 space-y-4">
            <label className="block space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                Email
              </span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-[#333] bg-[#0a0a0a] px-3 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]"
                placeholder="you@example.com"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                Invite code (optional if allowlisted)
              </span>
              <input
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                className="w-full rounded-lg border border-[#333] bg-[#0a0a0a] px-3 py-2.5 text-sm outline-none focus:border-[var(--color-accent)]"
                placeholder="beta-abc123"
              />
            </label>

            {error && (
              <p className="text-sm text-[#ff8a8a]">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-[var(--color-accent)] px-4 py-2.5 text-sm font-semibold text-black disabled:opacity-50"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
