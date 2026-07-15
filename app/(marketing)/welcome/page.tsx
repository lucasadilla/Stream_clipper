"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fetchJson } from "@/lib/apiClient";
import { cn } from "@/lib/cn";
import { BillingPlanButton } from "@/components/BillingPlanButton";
import { PRICING_PLANS } from "@/lib/pricing";
import type { BillingAccountSummary } from "@/services/billingService";

export default function WelcomePage() {
  const router = useRouter();
  const [account, setAccount] = useState<BillingAccountSummary | null>(null);
  const [creatorCode, setCreatorCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [redeeming, setRedeeming] = useState(false);

  async function refreshAccount() {
    const { data } = await fetchJson<{ account: BillingAccountSummary | null }>(
      "/api/auth/me"
    );
    setAccount(data.account);
    return data.account;
  }

  useEffect(() => {
    void refreshAccount()
      .then((next) => {
        if (!next) {
          router.replace("/login");
          return;
        }
        const hasAccess =
          next.unlimitedAccess ||
          next.betaAccess ||
          next.status === "active" ||
          next.status === "trialing";
        if (hasAccess) {
          router.replace("/#analyze");
        }
      })
      .finally(() => setLoading(false));
  }, [router]);

  async function redeemCode(event: React.FormEvent) {
    event.preventDefault();
    setRedeeming(true);
    setError(null);
    setMessage(null);
    try {
      const { ok, data } = await fetchJson<{
        account?: BillingAccountSummary;
        error?: string;
      }>("/api/creator-beta/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: creatorCode,
          email: account?.email,
          termsAccepted: true,
        }),
      });
      if (!ok || !data.account) {
        throw new Error(data.error ?? "Could not redeem code");
      }
      setAccount(data.account);
      setMessage("Creator Program access unlocked.");
      router.push("/#analyze");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not redeem code");
    } finally {
      setRedeeming(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-[var(--color-muted)]">
        Loading account…
      </div>
    );
  }

  if (!account) return null;

  const paidPlans = PRICING_PLANS.filter((plan) =>
    ["creator", "pro", "studio"].includes(plan.id)
  );

  return (
    <section className="relative isolate min-h-[calc(100svh-3.5rem)] border-b border-[var(--color-card-border)] bg-[#020302]">
      <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6 lg:px-8">
        <p className="text-xs font-semibold uppercase text-[var(--color-accent)]">
          Welcome
        </p>
        <h1 className="marketing-display-title mt-3 font-semibold text-white">
          Choose how you access Clipper
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-white/74">
          Signed in as{" "}
          <span className="text-white">{account.email ?? "your account"}</span>.
          Redeem a Creator Program code, or start a subscription.
        </p>

        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          <form
            onSubmit={(e) => void redeemCode(e)}
            className="border border-[var(--color-card-border)] bg-[#050805] p-6"
          >
            <p className="text-xs font-semibold uppercase text-[var(--color-muted)]">
              Creator Program
            </p>
            <h2 className="mt-2 text-xl font-semibold text-white">
              Have an invite code?
            </h2>
            <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">
              Enter the private code minted for you. One code unlocks one seat.
            </p>
            <input
              type="text"
              value={creatorCode}
              onChange={(e) => setCreatorCode(e.target.value)}
              placeholder="SCB-XXXX-XXXX-XXXX"
              className={cn(
                "mt-5 h-12 w-full border border-[var(--color-card-border)] bg-[#020302] px-4 font-mono text-sm uppercase text-white",
                "placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)] focus:outline-none"
              )}
            />
            {error && (
              <p className="mt-3 text-sm text-[var(--color-danger)]">{error}</p>
            )}
            {message && (
              <p className="mt-3 text-sm text-[var(--color-accent)]">{message}</p>
            )}
            <button
              type="submit"
              disabled={redeeming || !creatorCode.trim()}
              className="mt-5 h-11 w-full bg-[var(--color-accent)] text-sm font-semibold text-black hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
            >
              {redeeming ? "Unlocking…" : "Join Creator Program"}
            </button>
          </form>

          <div className="border border-[var(--color-card-border)] bg-[#050805] p-6">
            <p className="text-xs font-semibold uppercase text-[var(--color-muted)]">
              Subscribe
            </p>
            <h2 className="mt-2 text-xl font-semibold text-white">
              Buy a plan
            </h2>
            <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">
              Start a paid subscription to unlock processing hours and exports.
            </p>
            <div className="mt-5 space-y-4">
              {paidPlans.map((plan) => (
                <div
                  key={plan.id}
                  className="border border-[var(--color-card-border)] px-4 py-4"
                >
                  <div className="mb-3 flex items-baseline justify-between gap-3">
                    <p className="text-sm font-semibold text-white">{plan.name}</p>
                    <p className="text-xs text-[var(--color-muted)]">
                      {plan.priceLabel}
                    </p>
                  </div>
                  <BillingPlanButton planId={plan.id} />
                </div>
              ))}
            </div>
            <Link
              href="/#pricing"
              className="mt-4 inline-block text-xs text-[var(--color-accent)] hover:underline"
            >
              Compare all plans
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
