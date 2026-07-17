"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { SiteLogo } from "@/components/layout/SiteLogo";
import { cn } from "@/lib/cn";
import type { SocialCapabilityStatus, SocialPlatform } from "@/lib/social/types";

interface AccountCard {
  id: string;
  platform: SocialPlatform;
  platformAccountId: string;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  isActive: boolean;
  isDefault: boolean;
  connectedAt: string;
  health: string;
  connectionError: string | null;
  capabilityBanner: string | null;
}

interface PlatformOverview {
  platform: SocialPlatform;
  capability: SocialCapabilityStatus;
  capabilityLabel: string;
  capabilityBanner: string | null;
  canConnect: boolean;
  accounts: AccountCard[];
}

const PLATFORM_META: Record<
  SocialPlatform,
  { name: string; short: string; color: string }
> = {
  youtube: { name: "YouTube", short: "YT", color: "border-red-500/40" },
  tiktok: { name: "TikTok", short: "TT", color: "border-[#21301f]" },
  instagram: { name: "Instagram", short: "IG", color: "border-pink-500/40" },
  facebook: { name: "Facebook", short: "FB", color: "border-blue-500/40" },
  x: { name: "X", short: "X", color: "border-[#21301f]" },
  reddit: { name: "Reddit", short: "RD", color: "border-orange-500/40" },
};

export function ConnectedAccountsWorkspace() {
  const searchParams = useSearchParams();
  const [platforms, setPlatforms] = useState<PlatformOverview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(
    searchParams.get("error")
  );
  const [message, setMessage] = useState<string | null>(
    searchParams.get("connected")
      ? `Connected ${searchParams.get("connected")} successfully.`
      : null
  );
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/social/accounts", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load accounts");
      setPlatforms(body.platforms || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load accounts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function disconnect(accountId: string) {
    setBusyId(accountId);
    try {
      const response = await fetch(
        `/api/social/accounts?accountId=${encodeURIComponent(accountId)}`,
        { method: "DELETE" }
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Disconnect failed");
      setMessage("Account disconnected.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Disconnect failed");
    } finally {
      setBusyId(null);
    }
  }

  async function setDefault(accountId: string) {
    setBusyId(accountId);
    try {
      const response = await fetch("/api/social/accounts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, action: "set-default" }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Update failed");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="marketing-shell min-h-screen bg-[var(--color-background)] text-white">
      <header className="border-b border-[var(--color-card-border)] bg-[#020302] px-4 py-3">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <SiteLogo />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8f9b89]">
                Settings
              </p>
              <h1 className="text-lg font-bold">Connected Accounts</h1>
            </div>
          </div>
          <div className="flex gap-2">
            <Link
              href="/settings/publishing"
              className="border border-[#21301f] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#9aa49a] hover:border-[var(--color-accent)] hover:text-white"
            >
              Publishing
            </Link>
            <Link
              href="/profile"
              className="border border-[#21301f] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#9aa49a] hover:border-[var(--color-accent)] hover:text-white"
            >
              Back to profile
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
        <p className="max-w-2xl text-sm leading-6 text-[#9aa49a]">
          Connect social destinations once with official OAuth. Clipper stores
          tokens encrypted and never exposes them to the browser. YouTube,
          TikTok, X, Instagram, and Facebook are available when their app
          credentials are set; Instagram and Facebook share one Meta app.
        </p>

        {message && (
          <div className="border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-3 py-2 text-sm text-[var(--color-accent)]">
            {message}
          </div>
        )}
        {error && (
          <div className="border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-[#7d8877]">Loading connected accounts…</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {platforms.map((item) => {
              const meta = PLATFORM_META[item.platform];
              const hasAccounts = item.accounts.length > 0;
              return (
                <section
                  key={item.platform}
                  className={cn(
                    "border bg-[#050705] p-4",
                    meta.color,
                    "border-[var(--color-card-border)]"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-10 w-10 items-center justify-center border border-[#21301f] bg-[#070a07] text-xs font-bold text-[var(--color-accent)]">
                        {meta.short}
                      </span>
                      <div>
                        <h2 className="text-base font-bold">{meta.name}</h2>
                        <p className="text-[11px] text-[#7d8877]">
                          {hasAccounts
                            ? `${item.accounts.length} connected`
                            : "Not connected"}{" "}
                          · {item.capabilityLabel}
                        </p>
                      </div>
                    </div>
                  </div>

                  {item.capabilityBanner && (
                    <p className="mt-3 border border-[#21301f] bg-[#020302] px-2 py-1.5 text-[11px] leading-4 text-[#9aa49a]">
                      {item.capabilityBanner}
                    </p>
                  )}

                  {hasAccounts ? (
                    <div className="mt-4 space-y-4">
                      {item.accounts.map((account) => (
                        <div key={account.id} className="space-y-3 border-t border-[#21301f] pt-3 first:border-t-0 first:pt-0">
                          <div className="flex items-center gap-3">
                            {account.avatarUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={account.avatarUrl}
                                alt=""
                                className="h-9 w-9 rounded-full object-cover"
                              />
                            ) : (
                              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#142114] text-[10px] font-bold">
                                {meta.short}
                              </span>
                            )}
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold">
                                {account.displayName || "Connected account"}
                                {account.isDefault ? (
                                  <span className="ml-2 text-[10px] uppercase text-[var(--color-accent)]">
                                    Default
                                  </span>
                                ) : null}
                              </p>
                              <p className="truncate text-[11px] text-[#7d8877]">
                                {account.username || account.platformAccountId}
                              </p>
                              <p className="text-[10px] text-[#5f6b5c]">
                                Connected{" "}
                                {new Date(account.connectedAt).toLocaleDateString()}{" "}
                                · {account.health}
                              </p>
                            </div>
                          </div>
                          {account.connectionError && (
                            <p className="text-[11px] text-red-300">
                              {account.connectionError}
                            </p>
                          )}
                          <div className="flex flex-wrap gap-2">
                            {!account.isDefault && (
                              <button
                                type="button"
                                disabled={busyId === account.id}
                                onClick={() => void setDefault(account.id)}
                                className="border border-[#21301f] px-2 py-1 text-[10px] font-semibold uppercase text-[#9aa49a] hover:border-[var(--color-accent)] hover:text-white disabled:opacity-50"
                              >
                                Set default
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={busyId === account.id}
                              onClick={() => void disconnect(account.id)}
                              className="border border-red-500/40 px-2 py-1 text-[10px] font-semibold uppercase text-red-200 hover:bg-red-500/10 disabled:opacity-50"
                            >
                              Disconnect
                            </button>
                          </div>
                        </div>
                      ))}
                      {item.canConnect && (
                        <a
                          href={`/api/social/accounts/${item.platform}/connect`}
                          className="inline-flex border border-[#21301f] px-2 py-1 text-[10px] font-semibold uppercase text-[#9aa49a] hover:border-[var(--color-accent)] hover:text-white"
                        >
                          {item.platform === "facebook" ||
                          item.platform === "instagram"
                            ? "Add / refresh Pages"
                            : "Reconnect"}
                        </a>
                      )}
                    </div>
                  ) : (
                    <div className="mt-4">
                      {item.canConnect ? (
                        <a
                          href={`/api/social/accounts/${item.platform}/connect`}
                          className="inline-flex bg-[var(--color-accent)] px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-black hover:bg-[var(--color-accent-hover)]"
                        >
                          Connect {meta.name}
                        </a>
                      ) : (
                        <p className="text-[11px] text-[#7d8877]">
                          Publishing for {meta.name} is not configured yet.
                        </p>
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
