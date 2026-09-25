"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Clapperboard, Radio, Sparkles } from "lucide-react";
import posthog from "posthog-js";
import { BillingPlanButton } from "@/components/BillingPlanButton";
import { OperationProgress } from "@/components/ui/operation-progress";
import { fetchJson } from "@/lib/apiClient";
import type { OnboardingIntent } from "@/lib/onboardingIntent";
import type { BillingAccountSummary } from "@/services/billingService";
import type { PublicPricingPlan } from "@/services/publicPricingService";

const WORKFLOW_COPY = {
  timeline: {
    label: "Timeline",
    detail: "Your stream will open directly in the editor after payment.",
    icon: Clapperboard,
  },
  agent: {
    label: "Agent",
    detail: "Clipper will open your stream and begin preparing AI suggestions.",
    icon: Sparkles,
  },
  autopilot: {
    label: "Autopilot",
    detail: "After payment, you will connect your streaming and publishing accounts.",
    icon: Radio,
  },
} as const;

export default function WelcomePage() {
  const router = useRouter();
  const [account, setAccount] = useState<BillingAccountSummary | null>(null);
  const [intent, setIntent] = useState<OnboardingIntent | null>(null);
  const [plans, setPlans] = useState<PublicPricingPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelled, setCancelled] = useState(false);

  useEffect(() => {
    const checkoutCancelled =
      new URLSearchParams(window.location.search).get("checkout") === "cancelled";
    setCancelled(checkoutCancelled);
    if (checkoutCancelled) posthog.capture("checkout_cancelled");
    void Promise.all([
      fetchJson<{ account: BillingAccountSummary | null; authUser?: unknown }>(
        "/api/auth/me"
      ),
      fetchJson<{ intent: OnboardingIntent | null }>("/api/onboarding/intent"),
      fetchJson<{ plans: PublicPricingPlan[] }>("/api/billing/plans"),
    ])
      .then(([accountResult, intentResult, plansResult]) => {
        const nextAccount = accountResult.data.account;
        if (!nextAccount) {
          router.replace("/login");
          return;
        }
        setAccount(nextAccount);
        setIntent(intentResult.data.intent ?? null);
        setPlans(plansResult.data.plans ?? []);
        const active =
          nextAccount.unlimitedAccess ||
          nextAccount.status === "active" ||
          nextAccount.status === "trialing";
        if (active) {
          router.replace("/billing/activate");
          return;
        }
        posthog.capture("pricing_viewed", {
          workflow: intentResult.data.intent?.workflow ?? "timeline",
        });
        posthog.capture("onboarding_started", {
          workflow: intentResult.data.intent?.workflow ?? "timeline",
        });
      })
      .finally(() => setLoading(false));
  }, [router]);

  if (loading) {
    return (
      <div className="flex min-h-[55vh] items-center justify-center px-6">
        <OperationProgress
          title="Restoring your setup"
          stages={["Checking your account...", "Loading your saved workflow..."]}
          className="max-w-sm"
        />
      </div>
    );
  }
  if (!account) return null;

  const workflow = WORKFLOW_COPY[intent?.workflow ?? "timeline"];
  const WorkflowIcon = workflow.icon;
  const paidPlans = plans.filter((plan) => plan.id !== "business");

  return (
    <section className="min-h-[calc(100svh-var(--site-header-height))] border-b border-[var(--color-card-border)] bg-[#020302]">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid gap-8 lg:grid-cols-[0.72fr_1.28fr] lg:items-start">
          <div className="lg:sticky lg:top-28">
            <p className="text-xs font-semibold uppercase text-[var(--color-accent)]">
              One step from your workspace
            </p>
            <h1 className="marketing-display mt-4 text-5xl leading-[0.94] text-white sm:text-6xl">
              Choose your Clipper plan.
            </h1>
            <p className="mt-5 text-base leading-7 text-white/58">
              Signed in as <span className="text-white">{account.email}</span>.
              Processing begins only after Stripe confirms your subscription.
            </p>

            <div className="mt-8 border border-[#2a3827] bg-[#071007] p-5">
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center border border-[var(--color-accent)]/35 text-[var(--color-accent)]">
                  <WorkflowIcon className="size-4" aria-hidden />
                </span>
                <div>
                  <p className="text-xs font-semibold uppercase text-[var(--color-accent)]">
                    {workflow.label} selected
                  </p>
                  <p className="mt-2 text-sm leading-6 text-white/62">
                    {workflow.detail}
                  </p>
                </div>
              </div>
              {intent?.streamUrl ? (
                <p className="mt-4 truncate border-t border-[#243021] pt-4 text-xs text-white/45">
                  {intent.streamUrl}
                </p>
              ) : null}
              {intent?.requestedAction ? (
                <p className="mt-3 text-sm leading-6 text-white/72">
                  “{intent.requestedAction}”
                </p>
              ) : null}
            </div>

            {cancelled ? (
              <div className="mt-4 border border-[#6b5224] bg-[#171208] px-4 py-3 text-sm text-[#ffd28a]">
                Checkout wasn&apos;t completed. Your stream and plan choice are still saved.
              </div>
            ) : null}
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {paidPlans.map((plan) => (
              <article
                key={plan.id}
                className="flex min-h-[30rem] flex-col border border-[var(--color-card-border)] bg-[#050805] p-5"
              >
                <div>
                  <p className="text-[10px] font-semibold uppercase text-white/40">
                    {plan.audience}
                  </p>
                  <h2 className="marketing-display mt-3 text-4xl text-white">
                    {plan.name}
                  </h2>
                  <p className="mt-5 text-3xl font-semibold text-white">
                    {plan.priceLabel}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-white/42">
                    Renews monthly{plan.currency ? ` in ${plan.currency.toUpperCase()}` : ""}.{" "}
                    {plan.yearlyAvailable
                      ? `Or choose ${plan.yearlyLabel} for annual billing. `
                      : "Annual billing is not currently configured. "}
                    Taxes may apply. No automatic overage charges. Cancel through Billing settings.
                  </p>
                </div>

                <ul className="mt-6 space-y-3 border-t border-[var(--color-card-border)] pt-5">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex gap-2 text-sm leading-5 text-white/66">
                      <Check className="mt-0.5 size-4 shrink-0 text-[var(--color-accent)]" aria-hidden />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                <BillingPlanButton
                  planId={plan.id}
                  monthlyAvailable={plan.monthlyAvailable}
                  yearlyAvailable={plan.yearlyAvailable}
                />
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
