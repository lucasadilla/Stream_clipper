"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Loader2, RotateCcw } from "lucide-react";
import { fetchJson } from "@/lib/apiClient";
import { OperationProgress } from "@/components/ui/operation-progress";

type ActivationState = "confirming" | "resuming" | "failed";

function BillingActivationContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id");
  const [state, setState] = useState<ActivationState>("confirming");
  const [error, setError] = useState<string | null>(null);
  const attempts = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    const run = async () => {
      attempts.current += 1;
      const query = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : "";
      const status = await fetchJson<{
        active?: boolean;
        pending?: boolean;
        error?: string;
        billingAccount?: { id: string; plan: string };
      }>(`/api/billing/status${query}`, { cache: "no-store" });
      if (cancelled) return;

      if (status.ok && status.data.active) {
        setState("resuming");
        const resumed = await fetchJson<{
          destination?: string;
          error?: string;
        }>("/api/onboarding/resume", { method: "POST" });
        if (!resumed.ok || !resumed.data.destination) {
          setError(resumed.data.error ?? "Could not resume your workspace");
          setState("failed");
          return;
        }
        router.replace(resumed.data.destination);
        router.refresh();
        return;
      }

      if (attempts.current < 20 && (status.data.pending || status.ok)) {
        timer = window.setTimeout(run, 1_250);
        return;
      }
      setError(
        status.data.error ??
          "We could not confirm the subscription yet. Your saved stream is still waiting."
      );
      setState("failed");
    };

    void run();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [router, sessionId]);

  return (
    <section className="min-h-[calc(100svh-var(--site-header-height))] bg-[#020302] px-4 py-16 sm:px-6">
      <div className="mx-auto max-w-xl border border-[var(--color-card-border)] bg-[#050805] p-6 shadow-2xl sm:p-9">
        {state === "failed" ? (
          <>
            <span className="flex size-11 items-center justify-center border border-[#6b5224] bg-[#171208] text-[#ffbf55]">
              <RotateCcw className="size-5" aria-hidden />
            </span>
            <h1 className="mt-6 text-3xl font-semibold text-white">
              Your work is still saved.
            </h1>
            <p className="mt-3 text-sm leading-6 text-white/55">{error}</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex h-11 items-center gap-2 bg-[var(--color-accent)] px-5 text-sm font-semibold text-black"
              >
                <Loader2 className="size-4" aria-hidden />
                Check again
              </button>
              <Link
                href="/welcome"
                className="inline-flex h-11 items-center border border-[var(--color-card-border)] px-5 text-sm font-semibold text-white"
              >
                Back to plans
              </Link>
            </div>
          </>
        ) : (
          <>
            <span className="flex size-11 items-center justify-center border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 text-[var(--color-accent)]">
              {state === "resuming" ? (
                <Check className="size-5" aria-hidden />
              ) : (
                <Loader2 className="size-5 animate-spin" aria-hidden />
              )}
            </span>
            <h1 className="mt-6 text-3xl font-semibold text-white">
              {state === "resuming"
                ? "You're all set. Let's create your first clip."
                : "Confirming your subscription..."}
            </h1>
            <p className="mt-3 text-sm leading-6 text-white/55">
              {state === "resuming"
                ? "Restoring the stream and workflow you chose."
                : "Stripe is confirming payment and Clipper is preparing your workspace."}
            </p>
            <OperationProgress
              compact
              title={state === "resuming" ? "Opening Clipper" : "Activating plan"}
              stages={[
                "Verifying payment securely...",
                "Activating your plan...",
                "Restoring your workflow...",
              ]}
              className="mt-8"
            />
          </>
        )}
      </div>
    </section>
  );
}

export default function BillingActivationPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[55vh] items-center justify-center bg-[#020302] px-6">
          <OperationProgress
            title="Confirming your subscription"
            stages={["Checking Stripe...", "Preparing your workspace..."]}
            className="max-w-sm"
          />
        </div>
      }
    >
      <BillingActivationContent />
    </Suspense>
  );
}
