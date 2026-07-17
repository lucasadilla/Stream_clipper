"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AccountSettingsPanel,
  AccountSettingsPanels,
  AccountSettingsShell,
} from "@/components/account/AccountSettingsShell";
import { SocialPlatformIcon } from "@/components/social/SocialPlatformIcon";
import type {
  EmojiLevel,
  HashtagLevel,
  SocialContentTone,
  SocialPlatform,
} from "@/lib/social/types";
import type { PublishingPreferencesView } from "@/lib/social/preferences";

interface AccountOption {
  id: string;
  platform: SocialPlatform;
  displayName: string | null;
  username: string | null;
}

interface ScheduledRow {
  id: string;
  clipSuggestionId: string;
  clipTitle: string;
  scheduledFor: string;
  jobs: Array<{
    id: string;
    platform: string;
    account: {
      displayName: string | null;
      username: string | null;
    };
  }>;
}

const PLATFORM_LABEL: Record<string, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
  x: "X",
  reddit: "Reddit",
};

function formatLocal(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

const fieldClass =
  "mt-2 w-full rounded-lg border border-[var(--color-card-border)] bg-[#020302] px-4 py-3 text-sm text-white focus:border-[var(--color-accent)] focus:outline-none";

const labelClass =
  "block text-xs font-semibold uppercase text-white/60";

export function PublishingSettingsWorkspace() {
  const [prefs, setPrefs] = useState<PublishingPreferencesView | null>(null);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [scheduled, setScheduled] = useState<ScheduledRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyGroupId, setBusyGroupId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [prefsRes, accountsRes, scheduledRes] = await Promise.all([
        fetch("/api/social/preferences", { cache: "no-store" }),
        fetch("/api/social/accounts", { cache: "no-store" }),
        fetch("/api/social/scheduled", { cache: "no-store" }),
      ]);
      const prefsBody = await prefsRes.json();
      const accountsBody = await accountsRes.json();
      const scheduledBody = await scheduledRes.json();
      if (!prefsRes.ok)
        throw new Error(prefsBody.error || "Could not load preferences");
      if (!accountsRes.ok)
        throw new Error(accountsBody.error || "Could not load accounts");
      if (!scheduledRes.ok)
        throw new Error(scheduledBody.error || "Could not load schedule");

      setPrefs(prefsBody.preferences);
      const flat: AccountOption[] = (accountsBody.platforms || []).flatMap(
        (p: { accounts: AccountOption[] }) => p.accounts || []
      );
      setAccounts(flat);
      setScheduled(scheduledBody.scheduled || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!prefs) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/social/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prefs),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Save failed");
      setPrefs(body.preferences);
      setMessage("Publishing preferences saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function cancelSchedule(groupId: string) {
    setBusyGroupId(groupId);
    setError(null);
    try {
      const response = await fetch("/api/social/scheduled", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unschedule", groupId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not cancel");
      setMessage("Schedule cancelled — draft is back in review.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel");
    } finally {
      setBusyGroupId(null);
    }
  }

  function patch(partial: Partial<PublishingPreferencesView>) {
    setPrefs((prev) => (prev ? { ...prev, ...partial } : prev));
  }

  return (
    <AccountSettingsShell
      title="Publishing"
      description="Set tone, privacy, and default destinations for new publish drafts. Nothing posts until you confirm."
      message={message}
      error={error}
    >
      {loading || !prefs ? (
        <div className="mt-10 border border-[var(--color-card-border)] bg-[#050805] p-8">
          <p className="text-sm text-[var(--color-muted)] animate-pulse">
            Loading publishing settings…
          </p>
        </div>
      ) : (
        <AccountSettingsPanels>
          <AccountSettingsPanel title="Defaults">
            <div className="grid gap-5 sm:grid-cols-2">
              <label className={labelClass}>
                Tone
                <select
                  value={prefs.tone}
                  onChange={(e) =>
                    patch({ tone: e.target.value as SocialContentTone })
                  }
                  className={fieldClass}
                >
                  <option value="natural">Natural</option>
                  <option value="funny">Funny</option>
                  <option value="hype">Hype</option>
                  <option value="informative">Informative</option>
                  <option value="professional">Professional</option>
                  <option value="minimal">Minimal</option>
                </select>
              </label>
              <label className={labelClass}>
                Default privacy
                <select
                  value={prefs.defaultPrivacy}
                  onChange={(e) =>
                    patch({
                      defaultPrivacy: e.target.value as
                        | "private"
                        | "unlisted"
                        | "public",
                    })
                  }
                  className={fieldClass}
                >
                  <option value="private">Private</option>
                  <option value="unlisted">Unlisted</option>
                  <option value="public">Public</option>
                </select>
              </label>
              <label className={labelClass}>
                Emoji level
                <select
                  value={prefs.emojiLevel}
                  onChange={(e) =>
                    patch({ emojiLevel: e.target.value as EmojiLevel })
                  }
                  className={fieldClass}
                >
                  <option value="none">None</option>
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                </select>
              </label>
              <label className={labelClass}>
                Hashtag level
                <select
                  value={prefs.hashtagLevel}
                  onChange={(e) =>
                    patch({ hashtagLevel: e.target.value as HashtagLevel })
                  }
                  className={fieldClass}
                >
                  <option value="none">None</option>
                  <option value="minimal">Minimal</option>
                  <option value="normal">Normal</option>
                </select>
              </label>
              <label className={labelClass}>
                YouTube format
                <select
                  value={prefs.youtubeFormat}
                  onChange={(e) =>
                    patch({
                      youtubeFormat: e.target.value as "shorts" | "standard",
                    })
                  }
                  className={fieldClass}
                >
                  <option value="shorts">Shorts</option>
                  <option value="standard">Standard</option>
                </select>
              </label>
              <label className={labelClass}>
                TikTok mode
                <select
                  value={prefs.tiktokMode}
                  onChange={(e) =>
                    patch({
                      tiktokMode: e.target.value as "direct" | "inbox",
                    })
                  }
                  className={fieldClass}
                >
                  <option value="direct">Direct post</option>
                  <option value="inbox">Inbox drafts</option>
                </select>
              </label>
              <label className={`${labelClass} sm:col-span-2`}>
                Default hashtags
                <input
                  value={prefs.defaultHashtags.join(", ")}
                  onChange={(e) =>
                    patch({
                      defaultHashtags: e.target.value
                        .split(",")
                        .map((t) => {
                          const raw = t.trim();
                          if (!raw) return "";
                          return raw.startsWith("#") ? raw : `#${raw}`;
                        })
                        .filter(Boolean),
                    })
                  }
                  className={fieldClass}
                  placeholder="#highlights, #livestream"
                />
              </label>
            </div>

            <div className="mt-6 space-y-3 border-t border-[var(--color-card-border)] pt-6">
              {(
                [
                  [
                    "includeSourceUrl",
                    "Include source URL in copy when available",
                  ],
                  [
                    "useTranscriptQuotes",
                    "Prefer transcript quotes in captions",
                  ],
                  [
                    "autoCreateReviewDraft",
                    "Auto-create a review draft when opening Publish",
                  ],
                ] as const
              ).map(([key, label]) => (
                <label
                  key={key}
                  className="flex cursor-pointer items-center gap-3 text-sm text-white/75"
                >
                  <input
                    type="checkbox"
                    checked={prefs[key]}
                    onChange={(e) => patch({ [key]: e.target.checked })}
                    className="size-4 accent-[var(--color-accent)]"
                  />
                  {label}
                </label>
              ))}
            </div>

            <div className="mt-8 border-t border-[var(--color-card-border)] pt-8">
              <p className="text-xs font-semibold uppercase text-[var(--color-accent)]">
                Default destinations
              </p>
              {accounts.length === 0 ? (
                <p className="mt-4 text-sm text-[var(--color-muted)]">
                  No connected accounts yet.{" "}
                  <Link
                    href="/settings/connected-accounts"
                    className="text-[var(--color-accent)] hover:underline"
                  >
                    Connect accounts
                  </Link>
                </p>
              ) : (
                <div className="mt-4 space-y-2">
                  {accounts.map((account) => (
                    <label
                      key={account.id}
                      className="flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--color-card-border)] bg-[#020302] px-4 py-3 transition-colors hover:border-[var(--color-accent)]/40"
                    >
                      <input
                        type="checkbox"
                        className="accent-[var(--color-accent)]"
                        checked={prefs.defaultAccountIds.includes(account.id)}
                        onChange={(e) => {
                          patch({
                            defaultAccountIds: e.target.checked
                              ? [...prefs.defaultAccountIds, account.id]
                              : prefs.defaultAccountIds.filter(
                                  (id) => id !== account.id
                                ),
                          });
                        }}
                      />
                      <SocialPlatformIcon
                        platform={account.platform}
                        size="sm"
                        className="rounded-md"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-white">
                          {PLATFORM_LABEL[account.platform] || account.platform}{" "}
                          · {account.displayName || "Account"}
                        </span>
                        <span className="block truncate text-xs text-white/45">
                          {account.username || account.id}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              disabled={saving}
              onClick={() => void save()}
              className="mt-8 rounded-lg bg-[var(--color-accent)] px-5 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save preferences"}
            </button>
          </AccountSettingsPanel>

          <AccountSettingsPanel title="Upcoming scheduled">
            {scheduled.length === 0 ? (
              <p className="text-sm text-[var(--color-muted)]">
                No Clipper-scheduled publishes waiting.
              </p>
            ) : (
              <div className="space-y-3">
                {scheduled.map((row) => (
                  <div
                    key={row.id}
                    className="rounded-lg border border-[var(--color-card-border)] bg-[#020302] p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-white">
                          {row.clipTitle}
                        </p>
                        <p className="mt-1 text-xs text-white/45">
                          {formatLocal(row.scheduledFor)}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {row.jobs.map((job) => (
                            <span
                              key={job.id}
                              className="inline-flex items-center gap-1.5 text-xs text-white/55"
                            >
                              <SocialPlatformIcon
                                platform={
                                  (job.platform as SocialPlatform) || "youtube"
                                }
                                size="sm"
                                className="!h-6 !w-6 rounded-md"
                              />
                              {PLATFORM_LABEL[job.platform] || job.platform}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Link
                          href={`/clips/${row.clipSuggestionId}/publish`}
                          className="rounded-lg border border-[var(--color-card-border)] px-3 py-1.5 text-xs font-medium text-white/70 transition-colors hover:border-[var(--color-accent)] hover:text-white"
                        >
                          Open
                        </Link>
                        <button
                          type="button"
                          disabled={busyGroupId === row.id}
                          onClick={() => void cancelSchedule(row.id)}
                          className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:border-red-500 hover:bg-red-500/10 disabled:opacity-50"
                        >
                          {busyGroupId === row.id
                            ? "Cancelling…"
                            : "Cancel schedule"}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </AccountSettingsPanel>
        </AccountSettingsPanels>
      )}
    </AccountSettingsShell>
  );
}
