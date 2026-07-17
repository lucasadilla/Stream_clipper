"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { SiteLogo } from "@/components/layout/SiteLogo";
import { cn } from "@/lib/cn";
import type {
  SocialGeneratedContent,
  SocialPlatform,
  SocialPublishSettings,
} from "@/lib/social/types";
import type { PublishingPreferencesView } from "@/lib/social/preferences";

interface AccountRow {
  id: string;
  platform: SocialPlatform;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  isDefault: boolean;
  isActive: boolean;
  capabilityBanner: string | null;
}

interface PublishJobView {
  id: string;
  platform: string;
  status: string;
  editedContent: SocialGeneratedContent | null;
  publishSettings: SocialPublishSettings | null;
  validationWarnings: Array<{ code: string; message: string; severity: string }>;
  platformPostUrl: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  account: {
    id: string;
    displayName: string | null;
    username: string | null;
    avatarUrl: string | null;
  };
}

interface PublishGroupView {
  id: string;
  status: string;
  scheduledFor: string | null;
  jobs: PublishJobView[];
}

interface PlatformBanner {
  platform: SocialPlatform;
  capabilityBanner: string | null;
}

const PUBLISHABLE: SocialPlatform[] = [
  "youtube",
  "tiktok",
  "x",
  "instagram",
  "facebook",
];

const PLATFORM_LABEL: Record<SocialPlatform, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
  x: "X",
  reddit: "Reddit",
};

function statusLabel(status: string) {
  switch (status) {
    case "preparing_media":
      return "Preparing";
    case "uploading":
      return "Uploading";
    case "processing":
      return "Processing";
    case "publishing":
      return "Publishing";
    case "completed":
      return "Published";
    case "failed":
      return "Failed";
    case "scheduled":
      return "Scheduled";
    case "queued":
      return "Queued";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

function settingsForAccount(
  platform: SocialPlatform,
  opts: {
    privacy: "private" | "unlisted" | "public";
    madeForKids: boolean;
    youtubeFormat: "shorts" | "standard";
    facebookFormat: "reel" | "page_video";
    tiktokMode: "direct" | "inbox";
  }
): SocialPublishSettings {
  if (platform === "youtube") {
    return {
      privacy: opts.privacy,
      madeForKids: opts.madeForKids,
      youtubeFormat: opts.youtubeFormat,
      categoryId: "22",
      notifySubscribers: true,
    };
  }
  if (platform === "tiktok") {
    return {
      tiktokMode: opts.tiktokMode,
      privacy: opts.privacy === "public" ? "public" : "private",
      allowComments: true,
      allowDuet: true,
      allowStitch: true,
    };
  }
  if (platform === "facebook") {
    return {
      facebookFormat: opts.facebookFormat,
      privacy: opts.privacy === "private" ? "private" : "public",
    };
  }
  if (platform === "instagram") {
    return { shareToFeed: true };
  }
  return {};
}

export function SocialPublishWorkspace({ clipId }: { clipId: string }) {
  const [clipTitle, setClipTitle] = useState("Clip");
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [banners, setBanners] = useState<PlatformBanner[]>([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [youtubeFormat, setYoutubeFormat] = useState<"shorts" | "standard">(
    "shorts"
  );
  const [facebookFormat, setFacebookFormat] = useState<"reel" | "page_video">(
    "reel"
  );
  const [tiktokMode, setTiktokMode] = useState<"direct" | "inbox">("direct");
  const [privacy, setPrivacy] = useState<"private" | "unlisted" | "public">(
    "private"
  );
  const [madeForKids, setMadeForKids] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<"now" | "schedule">("now");
  const [scheduledFor, setScheduledFor] = useState("");
  const [group, setGroup] = useState<PublishGroupView | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<PublishingPreferencesView | null>(null);
  const [ready, setReady] = useState(false);
  const autoDraftAttempted = useRef(false);

  const publishableAccounts = useMemo(
    () =>
      accounts.filter(
        (a) => a.isActive && PUBLISHABLE.includes(a.platform)
      ),
    [accounts]
  );

  const selectedPlatforms = useMemo(() => {
    const set = new Set<SocialPlatform>();
    for (const id of selectedAccountIds) {
      const account = accounts.find((a) => a.id === id);
      if (account) set.add(account.platform);
    }
    return set;
  }, [accounts, selectedAccountIds]);

  const activeJob =
    group?.jobs.find((j) => j.id === activeJobId) || group?.jobs[0] || null;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [clipRes, accountsRes, prefsRes] = await Promise.all([
          fetch(`/api/clips/${clipId}`),
          fetch("/api/social/accounts"),
          fetch("/api/social/preferences"),
        ]);
        const clipBody = await clipRes.json();
        const accountsBody = await accountsRes.json();
        const prefsBody = await prefsRes.json();
        if (!clipRes.ok)
          throw new Error(clipBody.error || "Could not load clip");
        if (!accountsRes.ok)
          throw new Error(accountsBody.error || "Could not load accounts");
        if (!prefsRes.ok)
          throw new Error(prefsBody.error || "Could not load preferences");
        if (cancelled) return;

        setClipTitle(clipBody.clip?.title || "Clip");
        const preferences = prefsBody.preferences as PublishingPreferencesView;
        setPrefs(preferences);
        setPrivacy(preferences.defaultPrivacy);
        setYoutubeFormat(preferences.youtubeFormat);
        setFacebookFormat(preferences.facebookFormat);
        setTiktokMode(preferences.tiktokMode);

        const platforms = (accountsBody.platforms || []) as Array<{
          platform: SocialPlatform;
          capabilityBanner?: string | null;
          accounts: AccountRow[];
        }>;
        const flat: AccountRow[] = platforms.flatMap((p) => p.accounts || []);
        setAccounts(flat);
        setBanners(
          platforms.map((p) => ({
            platform: p.platform,
            capabilityBanner: p.capabilityBanner || null,
          }))
        );

        const preferred = preferences.defaultAccountIds.filter((id) =>
          flat.some((a) => a.id === id && PUBLISHABLE.includes(a.platform))
        );
        const defaults = flat.filter(
          (a) => a.isDefault && PUBLISHABLE.includes(a.platform)
        );
        const seed =
          preferred.length > 0
            ? preferred
            : defaults.length > 0
              ? defaults.map((a) => a.id)
              : flat
                  .filter((a) => PUBLISHABLE.includes(a.platform))
                  .slice(0, 1)
                  .map((a) => a.id);
        setSelectedAccountIds(seed);
        setReady(true);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load");
          setReady(true);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [clipId]);

  const refreshGroup = useCallback(async (groupId: string) => {
    const response = await fetch(`/api/social/publish-groups/${groupId}`, {
      cache: "no-store",
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Could not refresh status");
    setGroup(body.group);
    return body.group as PublishGroupView;
  }, []);

  useEffect(() => {
    if (!group) return;
    const active = group.jobs.some((j) =>
      [
        "queued",
        "preparing_media",
        "uploading",
        "processing",
        "publishing",
      ].includes(j.status)
    );
    if (!active && group.status !== "publishing") return;
    const timer = window.setInterval(() => {
      void refreshGroup(group.id).catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [group, refreshGroup]);

  const createDraft = useCallback(async () => {
    setCreating(true);
    setError(null);
    try {
      const destinations = selectedAccountIds.map((accountId) => {
        const account = accounts.find((a) => a.id === accountId)!;
        return {
          connectedSocialAccountId: accountId,
          platform: account.platform,
          settings: settingsForAccount(account.platform, {
            privacy,
            madeForKids,
            youtubeFormat,
            facebookFormat,
            tiktokMode,
          }),
        };
      });
      const response = await fetch(
        `/api/social/clips/${clipId}/publish-groups`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ destinations }),
        }
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not create draft");
      setGroup(body.group);
      setActiveJobId(body.group.jobs[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create draft");
    } finally {
      setCreating(false);
    }
  }, [
    accounts,
    clipId,
    facebookFormat,
    madeForKids,
    privacy,
    selectedAccountIds,
    tiktokMode,
    youtubeFormat,
  ]);

  useEffect(() => {
    if (!ready || group || !prefs?.autoCreateReviewDraft) return;
    if (autoDraftAttempted.current) return;
    if (selectedAccountIds.length === 0) return;
    autoDraftAttempted.current = true;
    void createDraft();
  }, [ready, group, prefs, selectedAccountIds, createDraft]);

  async function saveJobPatch(patch: {
    editedContent?: SocialGeneratedContent;
    publishSettings?: SocialPublishSettings;
  }) {
    if (!activeJob) return;
    const response = await fetch(`/api/social/publish-jobs/${activeJob.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Could not save");
    setGroup(body.group);
  }

  async function regenerate() {
    if (!activeJob) return;
    setError(null);
    try {
      const response = await fetch(`/api/social/publish-jobs/${activeJob.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "regenerate" }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Regenerate failed");
      setGroup(body.group);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Regenerate failed");
    }
  }

  async function confirmPublish() {
    if (!group) return;
    setPublishing(true);
    setError(null);
    try {
      const response = await fetch(`/api/social/publish-groups/${group.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          scheduleMode === "schedule"
            ? {
                action: "schedule",
                scheduledFor: new Date(scheduledFor).toISOString(),
              }
            : { action: "publish" }
        ),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Publish failed");
      setGroup(body.group);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Publish failed");
    } finally {
      setPublishing(false);
    }
  }

  async function retryJob(jobId: string) {
    setError(null);
    try {
      const response = await fetch(`/api/social/publish-jobs/${jobId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry" }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Retry failed");
      setGroup(body.group);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retry failed");
    }
  }

  async function cancelSchedule() {
    if (!group) return;
    setPublishing(true);
    setError(null);
    try {
      const response = await fetch(`/api/social/publish-groups/${group.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unschedule" }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not cancel schedule");
      setGroup(body.group);
      setScheduleMode("now");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel schedule");
    } finally {
      setPublishing(false);
    }
  }

  const content = activeJob?.editedContent;
  const warnings = Array.isArray(activeJob?.validationWarnings)
    ? activeJob!.validationWarnings
    : [];
  const activePlatform = (activeJob?.platform || "youtube") as SocialPlatform;

  return (
    <div className="editor-shell min-h-screen bg-[var(--color-background)] text-white">
      <header className="border-b border-[var(--color-card-border)] bg-[#020302] px-4 py-3">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <SiteLogo />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8f9b89]">
                Publish
              </p>
              <h1 className="truncate text-lg font-bold">{clipTitle}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/settings/publishing"
              className="border border-[#21301f] px-3 py-1.5 text-[11px] font-semibold uppercase text-[#9aa49a] hover:border-[var(--color-accent)] hover:text-white"
            >
              Publishing
            </Link>
            <Link
              href="/settings/connected-accounts"
              className="border border-[#21301f] px-3 py-1.5 text-[11px] font-semibold uppercase text-[#9aa49a] hover:border-[var(--color-accent)] hover:text-white"
            >
              Accounts
            </Link>
            <Link
              href={`/clips/${clipId}/export`}
              className="border border-[#21301f] px-3 py-1.5 text-[11px] font-semibold uppercase text-[#9aa49a] hover:border-[var(--color-accent)] hover:text-white"
            >
              Exports
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[280px_1fr]">
        <aside className="space-y-4">
          <section className="border border-[var(--color-card-border)] bg-[#050705] p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-[#8f9b89]">
              Destinations
            </h2>

            {publishableAccounts.length === 0 ? (
              <div className="mt-3 space-y-2 text-[12px] text-[#7d8877]">
                <p>No publishable accounts connected yet.</p>
                <Link
                  href="/settings/connected-accounts"
                  className="inline-flex bg-[var(--color-accent)] px-3 py-2 text-[11px] font-bold text-black"
                >
                  Connect accounts
                </Link>
              </div>
            ) : (
              <div className="mt-3 space-y-4">
                {PUBLISHABLE.map((platform) => {
                  const platformAccounts = publishableAccounts.filter(
                    (a) => a.platform === platform
                  );
                  if (!platformAccounts.length) return null;
                  const banner = banners.find(
                    (b) => b.platform === platform
                  )?.capabilityBanner;
                  return (
                    <div key={platform}>
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[#6f7a6c]">
                        {PLATFORM_LABEL[platform]}
                      </p>
                      {banner && (
                        <p className="mb-2 border border-[#21301f] bg-[#020302] px-2 py-1.5 text-[10px] leading-4 text-[#9aa49a]">
                          {banner}
                        </p>
                      )}
                      <div className="space-y-2">
                        {platformAccounts.map((account) => (
                          <label
                            key={account.id}
                            className="flex cursor-pointer items-start gap-2 border border-[#21301f] bg-[#020302] p-2"
                          >
                            <input
                              type="checkbox"
                              className="mt-1 accent-[var(--color-accent)]"
                              checked={selectedAccountIds.includes(account.id)}
                              onChange={(event) => {
                                setSelectedAccountIds((prev) =>
                                  event.target.checked
                                    ? [...prev, account.id]
                                    : prev.filter((id) => id !== account.id)
                                );
                              }}
                            />
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-semibold">
                                {account.displayName ||
                                  PLATFORM_LABEL[platform]}
                              </span>
                              <span className="block truncate text-[11px] text-[#7d8877]">
                                {account.username || account.id}
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-4 space-y-2">
              {selectedPlatforms.has("youtube") && (
                <>
                  <label className="block text-[11px] text-[#7d8877]">
                    YouTube format
                    <select
                      value={youtubeFormat}
                      onChange={(e) =>
                        setYoutubeFormat(
                          e.target.value as "shorts" | "standard"
                        )
                      }
                      className="mt-1 w-full border border-[#21301f] bg-[#070a07] px-2 py-1.5 text-sm text-white"
                    >
                      <option value="shorts">Shorts (9:16 preferred)</option>
                      <option value="standard">
                        Standard (16:9 preferred)
                      </option>
                    </select>
                  </label>
                  <label className="block text-[11px] text-[#7d8877]">
                    YouTube privacy
                    <select
                      value={privacy}
                      onChange={(e) =>
                        setPrivacy(
                          e.target.value as "private" | "unlisted" | "public"
                        )
                      }
                      className="mt-1 w-full border border-[#21301f] bg-[#070a07] px-2 py-1.5 text-sm text-white"
                    >
                      <option value="private">Private</option>
                      <option value="unlisted">Unlisted</option>
                      <option value="public">Public</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-[11px] text-[#9aa49a]">
                    <input
                      type="checkbox"
                      checked={madeForKids}
                      onChange={(e) => setMadeForKids(e.target.checked)}
                      className="accent-[var(--color-accent)]"
                    />
                    Made for kids
                  </label>
                </>
              )}
              {selectedPlatforms.has("tiktok") && (
                <label className="block text-[11px] text-[#7d8877]">
                  TikTok mode
                  <select
                    value={tiktokMode}
                    onChange={(e) =>
                      setTiktokMode(e.target.value as "direct" | "inbox")
                    }
                    className="mt-1 w-full border border-[#21301f] bg-[#070a07] px-2 py-1.5 text-sm text-white"
                  >
                    <option value="direct">Direct post</option>
                    <option value="inbox">Send to inbox drafts</option>
                  </select>
                </label>
              )}
              {selectedPlatforms.has("facebook") && (
                <label className="block text-[11px] text-[#7d8877]">
                  Facebook format
                  <select
                    value={facebookFormat}
                    onChange={(e) =>
                      setFacebookFormat(
                        e.target.value as "reel" | "page_video"
                      )
                    }
                    className="mt-1 w-full border border-[#21301f] bg-[#070a07] px-2 py-1.5 text-sm text-white"
                  >
                    <option value="reel">Page Reel</option>
                    <option value="page_video">Page video</option>
                  </select>
                </label>
              )}
            </div>

            {!group && (
              <button
                type="button"
                disabled={creating || selectedAccountIds.length === 0}
                onClick={() => void createDraft()}
                className="mt-4 w-full bg-[var(--color-accent)] px-3 py-2 text-[11px] font-bold uppercase text-black disabled:opacity-40"
              >
                {creating ? "Generating…" : "Review before posting"}
              </button>
            )}
          </section>

          {group && (
            <section className="border border-[var(--color-card-border)] bg-[#050705] p-4">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-[#8f9b89]">
                Jobs
              </h2>
              <div className="mt-3 space-y-2">
                {group.jobs.map((job) => (
                  <button
                    key={job.id}
                    type="button"
                    onClick={() => setActiveJobId(job.id)}
                    className={cn(
                      "w-full border px-2 py-2 text-left",
                      activeJobId === job.id
                        ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10"
                        : "border-[#21301f] bg-[#020302]"
                    )}
                  >
                    <span className="block text-sm font-semibold capitalize">
                      {PLATFORM_LABEL[job.platform as SocialPlatform] ||
                        job.platform}
                    </span>
                    <span className="block text-[11px] text-[#7d8877]">
                      {statusLabel(job.status)}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </aside>

        <section className="space-y-4">
          {error && (
            <div className="border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          )}

          {!group && (
            <div className="border border-[var(--color-card-border)] bg-[#050705] p-6 text-sm text-[#9aa49a]">
              Select one or more connected accounts (YouTube, TikTok, X,
              Instagram, Facebook), adjust format options, then generate a
              review draft. Clipper reuses matching platform exports when
              available.
            </div>
          )}

          {group && activeJob && content && (
            <>
              <div className="border border-[var(--color-card-border)] bg-[#050705] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-bold">
                    {PLATFORM_LABEL[activePlatform] || activePlatform} preview
                  </h2>
                  <button
                    type="button"
                    onClick={() => void regenerate()}
                    className="border border-[#21301f] px-2 py-1 text-[10px] font-semibold uppercase text-[#9aa49a] hover:border-[var(--color-accent)]"
                  >
                    Regenerate
                  </button>
                </div>
                {content.reasoningSummary && (
                  <p className="mt-2 text-[11px] text-[#7d8877]">
                    {content.reasoningSummary}
                  </p>
                )}
                <div className="mt-4 grid gap-3">
                  {activePlatform === "youtube" && (
                    <>
                      <label className="block text-[11px] text-[#7d8877]">
                        Title
                        <input
                          value={content.title}
                          onChange={(e) =>
                            void saveJobPatch({
                              editedContent: {
                                ...content,
                                title: e.target.value,
                              },
                            })
                          }
                          className="mt-1 w-full border border-[#21301f] bg-[#070a07] px-2 py-1.5 text-sm text-white"
                        />
                      </label>
                      <label className="block text-[11px] text-[#7d8877]">
                        Description
                        <textarea
                          value={content.description}
                          onChange={(e) =>
                            void saveJobPatch({
                              editedContent: {
                                ...content,
                                description: e.target.value,
                              },
                            })
                          }
                          rows={6}
                          className="mt-1 w-full border border-[#21301f] bg-[#070a07] px-2 py-1.5 text-sm text-white"
                        />
                      </label>
                      <label className="block text-[11px] text-[#7d8877]">
                        Tags (comma separated)
                        <input
                          value={content.tags.join(", ")}
                          onChange={(e) =>
                            void saveJobPatch({
                              editedContent: {
                                ...content,
                                tags: e.target.value
                                  .split(",")
                                  .map((t) => t.trim())
                                  .filter(Boolean),
                              },
                            })
                          }
                          className="mt-1 w-full border border-[#21301f] bg-[#070a07] px-2 py-1.5 text-sm text-white"
                        />
                      </label>
                      <label className="block text-[11px] text-[#7d8877]">
                        Pinned comment suggestion
                        <input
                          value={content.pinnedComment}
                          onChange={(e) =>
                            void saveJobPatch({
                              editedContent: {
                                ...content,
                                pinnedComment: e.target.value,
                              },
                            })
                          }
                          className="mt-1 w-full border border-[#21301f] bg-[#070a07] px-2 py-1.5 text-sm text-white"
                        />
                      </label>
                    </>
                  )}

                  {activePlatform === "x" && (
                    <label className="block text-[11px] text-[#7d8877]">
                      Post text
                      <textarea
                        value={content.postText || content.caption}
                        onChange={(e) =>
                          void saveJobPatch({
                            editedContent: {
                              ...content,
                              postText: e.target.value,
                              caption: e.target.value,
                            },
                          })
                        }
                        rows={4}
                        maxLength={280}
                        className="mt-1 w-full border border-[#21301f] bg-[#070a07] px-2 py-1.5 text-sm text-white"
                      />
                      <span className="mt-1 block text-[10px] text-[#5f6b5c]">
                        {(content.postText || content.caption).length}/280
                      </span>
                    </label>
                  )}

                  {(activePlatform === "tiktok" ||
                    activePlatform === "instagram" ||
                    activePlatform === "facebook") && (
                    <>
                      <label className="block text-[11px] text-[#7d8877]">
                        Caption
                        <textarea
                          value={content.caption || content.postText}
                          onChange={(e) =>
                            void saveJobPatch({
                              editedContent: {
                                ...content,
                                caption: e.target.value,
                                postText: e.target.value,
                              },
                            })
                          }
                          rows={6}
                          className="mt-1 w-full border border-[#21301f] bg-[#070a07] px-2 py-1.5 text-sm text-white"
                        />
                      </label>
                      <label className="block text-[11px] text-[#7d8877]">
                        Hashtags (comma separated)
                        <input
                          value={content.hashtags.join(", ")}
                          onChange={(e) =>
                            void saveJobPatch({
                              editedContent: {
                                ...content,
                                hashtags: e.target.value
                                  .split(",")
                                  .map((t) => t.trim())
                                  .filter(Boolean),
                              },
                            })
                          }
                          className="mt-1 w-full border border-[#21301f] bg-[#070a07] px-2 py-1.5 text-sm text-white"
                        />
                      </label>
                    </>
                  )}
                </div>
              </div>

              {warnings.length > 0 && (
                <div className="border border-[#21301f] bg-[#050705] p-4">
                  <h3 className="text-xs font-semibold uppercase text-[#8f9b89]">
                    Validation
                  </h3>
                  <ul className="mt-2 space-y-1">
                    {warnings.map((warning) => (
                      <li
                        key={`${warning.code}-${warning.message}`}
                        className={cn(
                          "text-[12px]",
                          warning.severity === "error"
                            ? "text-red-300"
                            : "text-[#9aa49a]"
                        )}
                      >
                        {warning.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {![
                "completed",
                "queued",
                "uploading",
                "processing",
                "publishing",
              ].includes(activeJob.status) &&
                group.status !== "scheduled" && (
                <div className="border border-[var(--color-card-border)] bg-[#050705] p-4">
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="text-[11px] text-[#7d8877]">
                      Mode
                      <select
                        value={scheduleMode}
                        onChange={(e) =>
                          setScheduleMode(e.target.value as "now" | "schedule")
                        }
                        className="mt-1 block border border-[#21301f] bg-[#070a07] px-2 py-1.5 text-sm text-white"
                      >
                        <option value="now">Publish now</option>
                        <option value="schedule">Schedule in Clipper</option>
                      </select>
                    </label>
                    {scheduleMode === "schedule" && (
                      <label className="text-[11px] text-[#7d8877]">
                        When (local)
                        <input
                          type="datetime-local"
                          value={scheduledFor}
                          onChange={(e) => setScheduledFor(e.target.value)}
                          className="mt-1 block border border-[#21301f] bg-[#070a07] px-2 py-1.5 text-sm text-white"
                        />
                      </label>
                    )}
                    <button
                      type="button"
                      disabled={publishing}
                      onClick={() => void confirmPublish()}
                      className="bg-[var(--color-accent)] px-4 py-2 text-[11px] font-bold uppercase text-black disabled:opacity-40"
                    >
                      {publishing
                        ? "Starting…"
                        : scheduleMode === "schedule"
                          ? "Schedule"
                          : "Confirm publish"}
                    </button>
                  </div>
                  <p className="mt-2 text-[11px] text-[#7d8877]">
                    Publishing runs in the background. You can leave this page.
                    Manage upcoming schedules in{" "}
                    <Link
                      href="/settings/publishing"
                      className="text-[var(--color-accent)]"
                    >
                      Publishing settings
                    </Link>
                    .
                  </p>
                </div>
              )}

              {group.status === "scheduled" && (
                <div className="border border-[var(--color-card-border)] bg-[#050705] p-4">
                  <p className="text-sm text-[#9aa49a]">
                    Scheduled for{" "}
                    {group.scheduledFor
                      ? new Date(group.scheduledFor).toLocaleString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })
                      : "later"}{" "}
                    (local). Nothing posts until then.
                  </p>
                  <button
                    type="button"
                    disabled={publishing}
                    onClick={() => void cancelSchedule()}
                    className="mt-3 border border-red-500/40 px-3 py-1.5 text-[11px] font-semibold uppercase text-red-200 hover:bg-red-500/10 disabled:opacity-40"
                  >
                    {publishing ? "Cancelling…" : "Cancel schedule"}
                  </button>
                </div>
              )}

              <div className="border border-[var(--color-card-border)] bg-[#050705] p-4">
                <h3 className="text-xs font-semibold uppercase text-[#8f9b89]">
                  Status
                </h3>
                <div className="mt-3 space-y-3">
                  {group.jobs.map((job) => (
                    <div
                      key={job.id}
                      className="border border-[#21301f] bg-[#020302] p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold capitalize">
                            {PLATFORM_LABEL[job.platform as SocialPlatform] ||
                              job.platform}{" "}
                            · {job.account.displayName}
                          </p>
                          <p className="text-[11px] text-[#7d8877]">
                            {statusLabel(job.status)}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          {job.platformPostUrl && (
                            <>
                              <a
                                href={job.platformPostUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="border border-[var(--color-accent)]/50 px-2 py-1 text-[10px] font-semibold uppercase text-[var(--color-accent)]"
                              >
                                Open post
                              </a>
                              <button
                                type="button"
                                onClick={() =>
                                  void navigator.clipboard.writeText(
                                    job.platformPostUrl || ""
                                  )
                                }
                                className="border border-[#21301f] px-2 py-1 text-[10px] font-semibold uppercase text-[#9aa49a]"
                              >
                                Copy link
                              </button>
                            </>
                          )}
                          {job.status === "failed" && (
                            <button
                              type="button"
                              onClick={() => void retryJob(job.id)}
                              className="border border-[#21301f] px-2 py-1 text-[10px] font-semibold uppercase text-[#9aa49a] hover:border-[var(--color-accent)]"
                            >
                              {job.errorCode === "needs_reauth"
                                ? "Reconnect required"
                                : "Retry"}
                            </button>
                          )}
                        </div>
                      </div>
                      {job.errorMessage && (
                        <p className="mt-2 text-[12px] text-red-300">
                          {job.errorMessage}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
