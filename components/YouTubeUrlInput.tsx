"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { fetchJson } from "@/lib/apiClient";
import { normalizeUserStreamUrl, parseStreamUrl } from "@/lib/streamPlatform";
import { cn } from "@/lib/cn";
import type { BillingAccountSummary } from "@/services/billingService";
import {
  ClippingModeModal,
  type ClippingEntryMode,
} from "@/components/ClippingModeModal";
import { PlatformBrandIcon } from "@/components/brand/PlatformBrandIcon";
import {
  writeSessionBootstrap,
  type SessionBootstrap,
} from "@/lib/sessionBootstrap";
import { captureClientAttribution } from "@/lib/clientAttribution";

export function StreamUrlInput() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasAccess, setHasAccess] = useState<boolean | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [modeModalOpen, setModeModalOpen] = useState(false);
  const [selectedMode, setSelectedMode] = useState<ClippingEntryMode | null>(null);
  const [agentPrompt, setAgentPrompt] = useState("");
  const [preview, setPreview] = useState<{
    title: string;
    creator: string | null;
    thumbnailUrl: string | null;
    platform: "youtube" | "twitch" | "kick";
  } | null>(null);

  useEffect(() => {
    void fetchJson<{ account: BillingAccountSummary | null }>("/api/auth/me").then(
      ({ data }) => {
        const account = data.account;
        setSignedIn(Boolean(account));
        setHasAccess(
          Boolean(
            account &&
              (account.unlimitedAccess ||
                account.status === "active" ||
                account.status === "trialing")
          )
        );
      }
    );
  }, []);

  async function handleSubmit(e: React.FormEvent) {
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

    setLoading(true);
    try {
      const result = await fetchJson<{
        preview?: typeof preview;
      }>("/api/stream-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: normalized }),
      });
      const nextPreview = result.ok ? result.data.preview ?? null : null;
      setPreview(nextPreview);
      if (nextPreview) {
        posthog.capture("stream_preview_loaded", {
          platform: nextPreview.platform,
        });
      }
    } catch {
      setPreview(null);
    } finally {
      setLoading(false);
      setSelectedMode(null);
      setModeModalOpen(true);
    }
  }

  async function createWithMode(mode: ClippingEntryMode) {
    if (loading) return;
    // Instant UI feedback — don't wait for the network round-trip.
    setSelectedMode(mode);
    setLoading(true);
    setError(null);

    const normalized = normalizeUserStreamUrl(url);

    try {
      let paidAccess = hasAccess;
      let authenticated = signedIn;
      if (paidAccess === null) {
        const me = await fetchJson<{ account: BillingAccountSummary | null }>(
          "/api/auth/me"
        );
        authenticated = Boolean(me.data.account);
        paidAccess = Boolean(
          me.data.account &&
            (me.data.account.unlimitedAccess ||
              me.data.account.status === "active" ||
              me.data.account.status === "trialing")
        );
        setSignedIn(authenticated);
        setHasAccess(paidAccess);
      }
      posthog.capture("workflow_selected", { workflow: mode });
      posthog.capture("stream_url_entered", {
        workflow: mode,
        platform: parseStreamUrl(normalized)?.platform,
      });
      if (!paidAccess) {
        const intentResult = await fetchJson<{ error?: string }>(
          "/api/onboarding/intent",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              workflow: mode,
              streamUrl: normalized,
              requestedAction: mode === "agent" ? agentPrompt : null,
              attribution: captureClientAttribution(),
            }),
          }
        );
        if (!intentResult.ok) {
          throw new Error(intentResult.data.error ?? "Could not save your stream");
        }
        posthog.capture("signup_started", { workflow: mode });
        router.push(authenticated ? "/welcome" : "/login");
        return;
      }

      if (mode === "autopilot") {
        await fetchJson("/api/onboarding/intent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workflow: mode, streamUrl: normalized }),
        });
        router.push("/settings/autopilot?onboarding=1");
        return;
      }

      const { ok, data } = await fetchJson<{
        session?: SessionBootstrap;
        error?: string;
      }>("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          streamUrl: normalized,
          mode,
          requestedAction: mode === "agent" ? agentPrompt : undefined,
        }),
      });

      if (!ok) throw new Error(data.error ?? "Failed to create session");
      if (!data.session?.id) throw new Error("Failed to create session");
      posthog.capture("stream_url_submitted", { mode });
      writeSessionBootstrap({ ...data.session, mode });
      router.push(`/sessions/${data.session.id}`);
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
          <div className="flex min-w-0 items-center bg-[#020302]/92 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] focus-within:ring-2 focus-within:ring-[var(--color-accent)]">
            <span className="flex shrink-0 items-center gap-2 pl-4" aria-hidden="true">
              <PlatformBrandIcon brand="youtube" size="xs" variant="mark" />
              <PlatformBrandIcon brand="twitch" size="xs" variant="mark" />
              <PlatformBrandIcon brand="kick" size="xs" variant="mark" />
            </span>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste a live stream or VOD link"
              required
              className={cn(
                "h-14 min-w-0 flex-1 border-0 bg-transparent",
                "px-4 text-sm text-[var(--color-foreground)] placeholder:text-[var(--color-muted)]",
                "focus:outline-none"
              )}
            />
          </div>
          <button
            type="submit"
            disabled={loading || !url.trim()}
            className={cn(
              "h-14 px-7 text-sm font-semibold whitespace-nowrap text-black",
              "bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]",
              "disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            )}
          >
          {loading ? "Checking stream…" : "Start clipping"}
          </button>
        </div>
        {error && (
          <p className="mt-3 text-sm text-[var(--color-danger)]">{error}</p>
        )}
        {hasAccess === false && (
          <p className="mt-3 text-sm text-[#c1cabd]">
            Paste your stream now. You will choose a plan before Clipper starts processing it.{" "}
            <Link href="#pricing" className="font-semibold text-[var(--color-accent)] hover:underline">
              See plans
            </Link>
          </p>
        )}
      </form>

      <ClippingModeModal
        open={modeModalOpen}
        loading={loading}
        selectedMode={selectedMode}
        agentPrompt={agentPrompt}
        onAgentPromptChange={setAgentPrompt}
        preview={preview}
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
