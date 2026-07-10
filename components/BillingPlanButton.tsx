"use client";

import { useState } from "react";
import posthog from "posthog-js";
import { fetchJson } from "@/lib/apiClient";
import type { BillingInterval, PlanId } from "@/lib/pricing";

interface BillingPlanButtonProps {
  planId: PlanId;
}

export function BillingPlanButton({ planId }: BillingPlanButtonProps) {
  const [loading, setLoading] = useState<BillingInterval | "sales" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startCheckout(interval: BillingInterval) {
    setLoading(interval);
    setError(null);
    posthog.capture("checkout_started", { plan_id: planId, interval });
    try {
      const { ok, data } = await fetchJson<{ url?: string; error?: string }>(
        "/api/billing/checkout",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ planId, interval }),
        }
      );
      if (!ok || !data.url) {
        throw new Error(data.error ?? "Failed to start checkout");
      }
      window.location.assign(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed");
    } finally {
      setLoading(null);
    }
  }

  function contactSales() {
    setLoading("sales");
    window.location.href = "mailto:sales@streamclipper.app";
  }

  if (planId === "business") {
    return (
      <div className="mt-auto space-y-2">
        <button
          type="button"
          onClick={contactSales}
          className="inline-flex h-11 w-full items-center justify-center border border-[var(--color-accent)] px-4 text-sm font-semibold text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)] hover:text-black"
        >
          {loading === "sales" ? "Opening..." : "Contact sales"}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-auto space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => void startCheckout("monthly")}
          disabled={loading !== null}
          className="inline-flex h-11 items-center justify-center border border-[var(--color-accent)] px-3 text-sm font-semibold text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)] hover:text-black disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading === "monthly" ? "Opening..." : "Monthly"}
        </button>
        <button
          type="button"
          onClick={() => void startCheckout("yearly")}
          disabled={loading !== null}
          className="inline-flex h-11 items-center justify-center bg-[var(--color-accent)] px-3 text-sm font-semibold text-black transition-colors hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading === "yearly" ? "Opening..." : "Yearly"}
        </button>
      </div>
      {error && <p className="text-xs leading-5 text-[#ff8a8a]">{error}</p>}
    </div>
  );
}
