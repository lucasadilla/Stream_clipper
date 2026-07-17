"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import posthog from "posthog-js";
import { fetchJson } from "@/lib/apiClient";
import { normalizeUserStreamUrl, parseStreamUrl } from "@/lib/streamPlatform";
import { cn } from "@/lib/cn";
import type { BillingAccountSummary } from "@/services/billingService";
import type { SessionMode } from "@/lib/sessionMode";
import { ClippingModeModal } from "@/components/ClippingModeModal";

export function StreamUrlInput() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasAccess, setHasAccess] = useState<boolean | null>(null);
  const [modeModalOpen, setModeModalOpen] = useState(false);
  const [selectedMode, setSelectedMode] = useState<SessionMode | null>(null);

  useEffect(() => {
    void fetchJson<{ account: BillingAccountSummary | null }>("/api/auth/me").then(
      ({ data }) => {
        const account = data.account;
        setHasAccess(
          Boolean(
            account &&
              (account.unlimitedAccess ||
                account.betaAccess ||
                account.status === "active" ||
                account.status === "trialing")
          )
        );
      }
    );
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const normalized = normalizeUserStreamUrl(url);
    if (!normalized.trim()) {
      setError("Please enter a stream URL");
      return;
    }

    if (!parseStreamUrl(normalized)) {
      setError(
        "Use a YouTube, Twitch (twitch.tv/channel or /videos/...), or Kick (kick.com/channel) link"
      );
      return;
    }

    if (hasAccess === false) return;
    setSelectedMode(null);
    setModeModalOpen(true);
  }

  async function createWithMode(mode: SessionMode) {
    if (loading) return;
    // Instant UI feedback — don't wait for the network round-trip.
    setSelectedMode(mode);
    setLoading(true);
    setError(null);

    const normalized = normalizeUserStreamUrl(url);

    try {
      const { ok, data } = await fetchJson<{
        session?: { id: string };
        error?: string;
      }>("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ streamUrl: normalized, mode }),
      });

      if (!ok) throw new Error(data.error ?? "Failed to create session");
      if (!data.session?.id) throw new Error("Failed to create session");
      posthog.capture("stream_url_submitted", { mode });
      window.location.assign(`/sessions/${data.session.id}`);
      return;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setModeModalOpen(false);
      setSelectedMode(null);
      setLoading(false);
    }
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="w-full max-w-2xl">
        <div className="grid gap-px overflow-hidden border border-[var(--color-card-border)] bg-[var(--color-card-border)] sm:grid-cols-[1fr_auto]">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="YouTube, Twitch, or Kick live / VOD link"
            required
            className={cn(
              "h-14 min-w-0 border-0 bg-[#020302]/92",
              "px-4 text-sm text-[var(--color-foreground)] placeholder:text-[var(--color-muted)]",
              "shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]",
              "focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            )}
          />
          <button
            type="submit"
            disabled={loading || !url.trim() || hasAccess === false}
            className={cn(
              "h-14 px-7 text-sm font-semibold whitespace-nowrap text-black",
              "bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]",
              "disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            )}
          >
            {loading ? "Starting…" : "Start clipping"}
          </button>
        </div>
        {error && (
          <p className="mt-3 text-sm text-[var(--color-danger)]">{error}</p>
        )}
        {hasAccess === false && (
          <p className="mt-3 text-sm text-[#c1cabd]">
            Creator Beta access is required right now. Enter your access code to unlock beta features.{" "}
            <Link href="/creator-beta" className="font-semibold text-[var(--color-accent)] hover:underline">
              Unlock access
            </Link>
          </p>
        )}
      </form>

      <ClippingModeModal
        open={modeModalOpen}
        loading={loading}
        selectedMode={selectedMode}
        onClose={() => {
          if (!loading) {
            setModeModalOpen(false);
            setSelectedMode(null);
          }
        }}
        onSelect={(mode) => {
          void createWithMode(mode);
        }}
      />
    </>
  );
}
