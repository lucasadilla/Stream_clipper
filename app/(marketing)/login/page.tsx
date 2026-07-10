"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { fetchJson } from "@/lib/apiClient";
import { cn } from "@/lib/utils";
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
        if (data.account) {
          setAccount(data.account);
          posthog.identify(data.account.id, {
            email: data.account.email,
          });
        }
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
      posthog.identify(data.account.id, {
        email: data.account.email,
      });
      posthog.capture("user_signed_in", {
        unlimited_access: data.account.unlimitedAccess ?? false,
      });
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
    posthog.capture("user_signed_out");
    posthog.reset();
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    setAccount(null);
    router.refresh();
  }

  return (
    <section className="relative isolate min-h-[calc(100svh-3.5rem)] overflow-hidden border-b border-[var(--color-card-border)] bg-[#020302]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(149,255,0,0.08),transparent_42%),radial-gradient(circle_at_bottom_right,rgba(149,255,0,0.05),transparent_36%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-6 overflow-hidden opacity-40">
        <p className="marketing-ghost-title translate-x-[-0.06em] whitespace-nowrap">
          ACCESS
        </p>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-[linear-gradient(0deg,#020302_10%,rgba(2,3,2,0))]" />

      <div className="relative mx-auto grid max-w-[1440px] gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1fr_0.92fr] lg:items-center lg:gap-16 lg:px-8 lg:py-20">
        <div className="max-w-xl">
          <p className="text-xs font-semibold uppercase text-[var(--color-accent)] sm:text-sm">
            Stream Clipper / account
          </p>
          <h1 className="marketing-display-title mt-4 font-semibold text-white">
            Sign in
          </h1>
          <p className="mt-5 text-lg leading-8 text-white/74 sm:text-xl sm:leading-9">
            Allowlisted emails get unlimited access. Beta testers can use an
            invite code. Everyone else can subscribe on the pricing page.
          </p>

          <div className="mt-8 grid gap-px overflow-hidden border border-[var(--color-card-border)] bg-[var(--color-card-border)] sm:grid-cols-2">
            <div className="bg-[#050805]/92 px-4 py-4">
              <span className="mb-3 block h-1 w-10 bg-[var(--color-accent)]" />
              <p className="text-xs font-semibold uppercase text-white/74">
                Team access
              </p>
              <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">
                Your email on the allowlist unlocks the full timeline with no
                export caps.
              </p>
            </div>
            <div className="bg-[#050805]/92 px-4 py-4">
              <span className="mb-3 block h-1 w-10 bg-[var(--color-accent)]" />
              <p className="text-xs font-semibold uppercase text-white/74">
                Invite code
              </p>
              <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">
                Share a code with collaborators so they can sign in the same way.
              </p>
            </div>
          </div>

          <p className="mt-6 text-sm text-[var(--color-muted)]">
            Need a paid plan instead?{" "}
            <Link
              href="/#pricing"
              className="text-[var(--color-accent)] hover:underline"
            >
              View pricing
            </Link>
          </p>
        </div>

        <div className="border border-[var(--color-card-border)] bg-[#050805] p-6 sm:p-8">
          {account ? (
            <div className="space-y-5">
              <div>
                <p className="text-xs font-semibold uppercase text-[var(--color-muted)]">
                  Signed in
                </p>
                <p className="mt-3 text-2xl font-semibold text-white">
                  {account.email}
                </p>
                {account.unlimitedAccess && (
                  <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-accent)]">
                    Unlimited access
                  </p>
                )}
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <Link
                  href="/#analyze"
                  className="inline-flex h-12 items-center justify-center bg-[var(--color-accent)] px-4 text-sm font-semibold text-black transition-colors hover:bg-[var(--color-accent-hover)]"
                >
                  Open timeline
                </Link>
                <button
                  type="button"
                  onClick={() => void handleLogout()}
                  className="inline-flex h-12 items-center justify-center border border-[var(--color-card-border)] px-4 text-sm font-semibold text-white/80 transition-colors hover:border-[var(--color-accent)] hover:text-white"
                >
                  Sign out
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
              <div>
                <p className="text-xs font-semibold uppercase text-[var(--color-muted)]">
                  Credentials
                </p>
                <p className="mt-2 text-sm text-[var(--color-muted)]">
                  Use the email you were approved with.
                </p>
              </div>

              <label className="block space-y-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                  Email
                </span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className={cn(
                    "h-12 w-full border border-[var(--color-card-border)] bg-[#020302]/92 px-4 text-sm text-white",
                    "placeholder:text-[var(--color-muted)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]",
                    "focus:border-[var(--color-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                  )}
                />
              </label>

              <label className="block space-y-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                  Invite code
                </span>
                <input
                  type="text"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="Optional if allowlisted"
                  className={cn(
                    "h-12 w-full border border-[var(--color-card-border)] bg-[#020302]/92 px-4 text-sm text-white",
                    "placeholder:text-[var(--color-muted)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]",
                    "focus:border-[var(--color-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                  )}
                />
              </label>

              {error && (
                <p className="text-sm text-[var(--color-danger)]">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className={cn(
                  "h-12 w-full text-sm font-semibold text-black transition-colors",
                  "bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]",
                  "disabled:cursor-not-allowed disabled:opacity-50"
                )}
              >
                {loading ? "Signing in..." : "Sign in"}
              </button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
