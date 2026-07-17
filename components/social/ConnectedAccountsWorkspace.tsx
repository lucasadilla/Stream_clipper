"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check, ChevronRight, Loader2 } from "lucide-react";
import {
  AccountSettingsPanel,
  AccountSettingsPanels,
  AccountSettingsShell,
} from "@/components/account/AccountSettingsShell";
import { SocialPlatformIcon } from "@/components/social/SocialPlatformIcon";
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

const PLATFORM_NAME: Record<SocialPlatform, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
  x: "X",
  reddit: "Reddit",
};

const PLATFORM_HINT: Partial<Record<SocialPlatform, string>> = {
  tiktok: "Posts may stay private until TikTok approves your app.",
  x: "Requires X API access with media and tweet permissions.",
  instagram: "Professional account linked to a Facebook Page required.",
  facebook: "Publishes to Pages you manage.",
  youtube: "Uploads may stay private until Google verifies your project.",
};

function statusLabel(item: PlatformOverview) {
  if (item.accounts.length > 0) {
    return item.accounts.length === 1
      ? "Connected"
      : `${item.accounts.length} accounts`;
  }
  if (item.capability === "production_ready") return "Ready to connect";
  if (item.capability === "private_test_only") return "Private test mode";
  if (item.capability === "development_only") return "Development mode";
  if (item.capability === "awaiting_review") return "Awaiting review";
  return "Not connected";
}

function PlatformSkeleton() {
  return (
    <div className="animate-pulse border border-[var(--color-card-border)] bg-[#020302] p-4">
      <div className="flex items-center gap-4">
        <div className="h-12 w-12 rounded-lg bg-white/10" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-28 bg-white/10" />
          <div className="h-3 w-48 bg-white/5" />
        </div>
        <div className="h-10 w-24 rounded-lg bg-white/10" />
      </div>
    </div>
  );
}

export function ConnectedAccountsWorkspace() {
  const searchParams = useSearchParams();
  const [platforms, setPlatforms] = useState<PlatformOverview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(searchParams.get("error"));
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

  const visiblePlatforms = platforms.filter(
    (item) => item.canConnect || item.accounts.length > 0
  );

  return (
    <AccountSettingsShell
      title="Connected accounts"
      description="Link the platforms you publish to. OAuth tokens are encrypted and stored on the server — never in the browser."
      message={message}
      error={error}
    >
      <AccountSettingsPanels>
        <AccountSettingsPanel title="Destinations">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 2 }).map((_, i) => (
                <PlatformSkeleton key={i} />
              ))}
            </div>
          ) : visiblePlatforms.length === 0 ? (
            <p className="text-sm text-[var(--color-muted)]">
              No publishing destinations are available on this deployment yet.
            </p>
          ) : (
            <div className="space-y-3">
              {visiblePlatforms.map((item) => {
                const name = PLATFORM_NAME[item.platform];
                const hasAccounts = item.accounts.length > 0;
                const hint = PLATFORM_HINT[item.platform];

                return (
                  <div
                    key={item.platform}
                    className="border border-[var(--color-card-border)] bg-[#020302]"
                  >
                    <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                      <div className="flex min-w-0 items-center gap-4">
                        <SocialPlatformIcon
                          platform={item.platform}
                          size="md"
                          className="rounded-lg"
                        />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-base font-semibold text-white">
                              {name}
                            </h2>
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                                hasAccounts
                                  ? "bg-[var(--color-accent)]/15 text-[var(--color-accent)]"
                                  : "bg-white/5 text-white/50"
                              )}
                            >
                              {hasAccounts ? (
                                <Check className="h-3 w-3" aria-hidden />
                              ) : null}
                              {statusLabel(item)}
                            </span>
                          </div>
                          {hint && item.canConnect ? (
                            <p className="mt-1 text-sm text-white/50">
                              {hint}
                            </p>
                          ) : null}
                        </div>
                      </div>

                      {!hasAccounts && item.canConnect ? (
                        <a
                          href={`/api/social/accounts/${item.platform}/connect`}
                          className="inline-flex h-10 shrink-0 items-center justify-center gap-1 rounded-lg bg-[var(--color-accent)] px-5 text-sm font-semibold text-black transition-colors hover:bg-[var(--color-accent-hover)]"
                        >
                          Connect
                          <ChevronRight className="h-4 w-4" aria-hidden />
                        </a>
                      ) : null}
                    </div>

                    {hasAccounts ? (
                      <div className="border-t border-[var(--color-card-border)]">
                        {item.accounts.map((account) => (
                          <div
                            key={account.id}
                            className="flex flex-col gap-4 border-b border-[var(--color-card-border)] px-4 py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:px-5"
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              {account.avatarUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={account.avatarUrl}
                                  alt=""
                                  className="h-10 w-10 rounded-full object-cover"
                                />
                              ) : (
                                <SocialPlatformIcon
                                  platform={item.platform}
                                  size="sm"
                                  className="rounded-md"
                                />
                              )}
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-white">
                                  {account.displayName || "Connected account"}
                                </p>
                                <p className="truncate text-xs text-white/45">
                                  {account.username ||
                                    account.platformAccountId}
                                </p>
                                {account.isDefault ? (
                                  <p className="mt-0.5 text-[11px] font-medium text-[var(--color-accent)]">
                                    Default account
                                  </p>
                                ) : null}
                                {account.connectionError ? (
                                  <p className="mt-1 text-xs text-red-300">
                                    {account.connectionError}
                                  </p>
                                ) : null}
                              </div>
                            </div>

                            <div className="flex flex-wrap gap-2 sm:justify-end">
                              {!account.isDefault ? (
                                <button
                                  type="button"
                                  disabled={busyId === account.id}
                                  onClick={() => void setDefault(account.id)}
                                  className="inline-flex h-9 items-center rounded-lg border border-[var(--color-card-border)] px-3 text-xs font-medium text-white/70 transition-colors hover:border-white/30 hover:text-white disabled:opacity-50"
                                >
                                  {busyId === account.id ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    "Set default"
                                  )}
                                </button>
                              ) : null}
                              <button
                                type="button"
                                disabled={busyId === account.id}
                                onClick={() => void disconnect(account.id)}
                                className="inline-flex h-9 items-center rounded-lg border border-red-500/40 px-3 text-xs font-medium text-red-400 transition-colors hover:border-red-500 hover:bg-red-500/10 disabled:opacity-50"
                              >
                                Disconnect
                              </button>
                            </div>
                          </div>
                        ))}

                        {item.canConnect ? (
                          <div className="border-t border-[var(--color-card-border)] px-4 py-3 sm:px-5">
                            <a
                              href={`/api/social/accounts/${item.platform}/connect`}
                              className="inline-flex items-center gap-1 text-sm font-medium text-[var(--color-accent)] hover:underline"
                            >
                              {item.platform === "facebook" ||
                              item.platform === "instagram"
                                ? "Add or refresh Pages"
                                : "Connect another account"}
                              <ChevronRight className="h-4 w-4" aria-hidden />
                            </a>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </AccountSettingsPanel>
      </AccountSettingsPanels>
    </AccountSettingsShell>
  );
}
