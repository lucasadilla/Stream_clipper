"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { SiteLogo } from "@/components/layout/SiteLogo";
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
    <div className="marketing-shell min-h-screen bg-[var(--color-background)] text-white">
      <header className="border-b border-[var(--color-card-border)] bg-[#020302] px-4 py-3">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <SiteLogo />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8f9b89]">
                Settings
              </p>
              <h1 className="text-lg font-bold">Publishing</h1>
            </div>
          </div>
          <div className="flex gap-2">
            <Link
              href="/settings/connected-accounts"
              className="border border-[#21301f] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#9aa49a] hover:border-[var(--color-accent)] hover:text-white"
            >
              Accounts
            </Link>
            <Link
              href="/profile"
              className="border border-[#21301f] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#9aa49a] hover:border-[var(--color-accent)] hover:text-white"
            >
              Profile
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 px-4 py-8">
        <p className="max-w-2xl text-sm leading-6 text-[#9aa49a]">
          Defaults for copy tone, privacy, and destinations. Auto-create only
          builds a review draft — you still confirm before anything posts.
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

        {loading || !prefs ? (
          <p className="text-sm text-[#7d8877]">Loading publishing settings…</p>
        ) : (
          <>
            <section className="border border-[var(--color-card-border)] bg-[#050705] p-5">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-[#8f9b89]">
                Defaults
              </h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="block text-[11px] text-[#7d8877]">
                  Tone
                  <select
                    value={prefs.tone}
                    onChange={(e) =>
                      patch({ tone: e.target.value as SocialContentTone })
                    }
                    className="mt-1 w-full border border-[#21301f] bg-[#070a07] px-2 py-1.5 text-sm text-white"
                  >
                    <option value="natural">Natural</option>
                    <option value="funny">Funny</option>
                    <option value="hype">Hype</option>
                    <option value="informative">Informative</option>
                    <option value="professional">Professional</option>
                    <option value="minimal">Minimal</option>
                  </select>
                </label>
                <label className="block text-[11px] text-[#7d8877]">
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
                    className="mt-1 w-full border border-[#21301f] bg-[#070a07] px-2 py-1.5 text-sm text-white"
                  >
                    <option value="private">Private</option>
                    <option value="unlisted">Unlisted</option>
                    <option value="public">Public</option>
                  </select>
                </label>
                <label className="block text-[11px] text-[#7d8877]">
                  Emoji level
                  <select
                    value={prefs.emojiLevel}
                    onChange={(e) =>
                      patch({ emojiLevel: e.target.value as EmojiLevel })
                    }
                    className="mt-1 w-full border border-[#21301f] bg-[#070a07] px-2 py-1.5 text-sm text-white"
                  >
                    <option value="none">None</option>
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                  </select>
                </label>
                <label className="block text-[11px] text-[#7d8877]">
                  Hashtag level
                  <select
                    value={prefs.hashtagLevel}
                    onChange={(e) =>
                      patch({ hashtagLevel: e.target.value as HashtagLevel })
                    }
                    className="mt-1 w-full border border-[#21301f] bg-[#070a07] px-2 py-1.5 text-sm text-white"
                  >
                    <option value="none">None</option>
                    <option value="minimal">Minimal</option>
                    <option value="normal">Normal</option>
                  </select>
                </label>
                <label className="block text-[11px] text-[#7d8877]">
                  YouTube format default
                  <select
                    value={prefs.youtubeFormat}
                    onChange={(e) =>
                      patch({
                        youtubeFormat: e.target.value as "shorts" | "standard",
                      })
                    }
                    className="mt-1 w-full border border-[#21301f] bg-[#070a07] px-2 py-1.5 text-sm text-white"
                  >
                    <option value="shorts">Shorts</option>
                    <option value="standard">Standard</option>
                  </select>
                </label>
                <label className="block text-[11px] text-[#7d8877]">
                  TikTok mode default
                  <select
                    value={prefs.tiktokMode}
                    onChange={(e) =>
                      patch({
                        tiktokMode: e.target.value as "direct" | "inbox",
                      })
                    }
                    className="mt-1 w-full border border-[#21301f] bg-[#070a07] px-2 py-1.5 text-sm text-white"
                  >
                    <option value="direct">Direct post</option>
                    <option value="inbox">Inbox drafts</option>
                  </select>
                </label>
                <label className="block text-[11px] text-[#7d8877] sm:col-span-2">
                  Default hashtags (comma separated)
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
                    className="mt-1 w-full border border-[#21301f] bg-[#070a07] px-2 py-1.5 text-sm text-white"
                    placeholder="#highlights, #livestream"
                  />
                </label>
              </div>

              <div className="mt-4 space-y-2">
                <label className="flex items-center gap-2 text-[12px] text-[#9aa49a]">
                  <input
                    type="checkbox"
                    checked={prefs.includeSourceUrl}
                    onChange={(e) =>
                      patch({ includeSourceUrl: e.target.checked })
                    }
                    className="accent-[var(--color-accent)]"
                  />
                  Include source URL in copy when available
                </label>
                <label className="flex items-center gap-2 text-[12px] text-[#9aa49a]">
                  <input
                    type="checkbox"
                    checked={prefs.useTranscriptQuotes}
                    onChange={(e) =>
                      patch({ useTranscriptQuotes: e.target.checked })
                    }
                    className="accent-[var(--color-accent)]"
                  />
                  Prefer transcript quotes in captions
                </label>
                <label className="flex items-center gap-2 text-[12px] text-[#9aa49a]">
                  <input
                    type="checkbox"
                    checked={prefs.autoCreateReviewDraft}
                    onChange={(e) =>
                      patch({ autoCreateReviewDraft: e.target.checked })
                    }
                    className="accent-[var(--color-accent)]"
                  />
                  Auto-create a review draft when opening Publish (still
                  requires Confirm)
                </label>
              </div>

              <div className="mt-6">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[#8f9b89]">
                  Default destinations
                </h3>
                {accounts.length === 0 ? (
                  <p className="mt-2 text-[12px] text-[#7d8877]">
                    No connected accounts yet.{" "}
                    <Link
                      href="/settings/connected-accounts"
                      className="text-[var(--color-accent)]"
                    >
                      Connect accounts
                    </Link>
                  </p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {accounts.map((account) => (
                      <label
                        key={account.id}
                        className="flex cursor-pointer items-start gap-2 border border-[#21301f] bg-[#020302] p-2"
                      >
                        <input
                          type="checkbox"
                          className="mt-1 accent-[var(--color-accent)]"
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
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold">
                            {PLATFORM_LABEL[account.platform] || account.platform}{" "}
                            · {account.displayName || "Account"}
                          </span>
                          <span className="block truncate text-[11px] text-[#7d8877]">
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
                className="mt-6 bg-[var(--color-accent)] px-4 py-2 text-[11px] font-bold uppercase text-black disabled:opacity-40"
              >
                {saving ? "Saving…" : "Save preferences"}
              </button>
            </section>

            <section className="border border-[var(--color-card-border)] bg-[#050705] p-5">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-[#8f9b89]">
                Upcoming scheduled
              </h2>
              {scheduled.length === 0 ? (
                <p className="mt-3 text-[12px] text-[#7d8877]">
                  No Clipper-scheduled publishes waiting.
                </p>
              ) : (
                <div className="mt-3 space-y-3">
                  {scheduled.map((row) => (
                    <div
                      key={row.id}
                      className="border border-[#21301f] bg-[#020302] p-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">
                            {row.clipTitle}
                          </p>
                          <p className="text-[11px] text-[#7d8877]">
                            Scheduled for {formatLocal(row.scheduledFor)} (local)
                          </p>
                          <p className="mt-1 text-[11px] text-[#9aa49a]">
                            {row.jobs
                              .map(
                                (job) =>
                                  `${PLATFORM_LABEL[job.platform] || job.platform}: ${
                                    job.account.displayName ||
                                    job.account.username ||
                                    "account"
                                  }`
                              )
                              .join(" · ")}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Link
                            href={`/clips/${row.clipSuggestionId}/publish`}
                            className="border border-[#21301f] px-2 py-1 text-[10px] font-semibold uppercase text-[#9aa49a] hover:border-[var(--color-accent)]"
                          >
                            Open
                          </Link>
                          <button
                            type="button"
                            disabled={busyGroupId === row.id}
                            onClick={() => void cancelSchedule(row.id)}
                            className="border border-red-500/40 px-2 py-1 text-[10px] font-semibold uppercase text-red-200 hover:bg-red-500/10 disabled:opacity-50"
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
            </section>
          </>
        )}
      </main>
    </div>
  );
}
