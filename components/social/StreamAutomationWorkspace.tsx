"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  ExternalLink,
  Loader2,
  Radio,
  Send,
  Sparkles,
} from "lucide-react";
import {
  AccountSettingsPanel,
  AccountSettingsPanels,
  AccountSettingsShell,
} from "@/components/account/AccountSettingsShell";
import { PlatformBrandIcon, type PlatformBrand } from "@/components/brand/PlatformBrandIcon";
import { SocialPlatformIcon } from "@/components/social/SocialPlatformIcon";
import { cn } from "@/lib/cn";
import { parseAutomationSource } from "@/lib/liveAutomation";
import type { SocialPlatform } from "@/lib/social/types";
import { OperationProgress } from "@/components/ui/operation-progress";

interface AutomationView {
  id: string;
  platform: "youtube" | "twitch" | "kick";
  sourceUrl: string;
  displayName: string | null;
  enabled: boolean;
  autoPublishEnabled: boolean;
  clipsPerBroadcast: number;
  destinationAccountIds: string[];
  activeSessionId: string | null;
  lastCheckedAt: string | null;
  nextCheckAt: string | null;
  lastLiveAt: string | null;
  lastCompletedAt: string | null;
  lastError: string | null;
}

interface Destination {
  id: string;
  platform: SocialPlatform;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
}

interface YouTubeSource {
  id: string;
  label: string;
  sourceUrl: string;
}

interface AutomationResponse {
  automation: AutomationView | null;
  destinations: Destination[];
  youtubeSources: YouTubeSource[];
  error?: string;
}

const PLATFORM_LABEL: Record<string, string> = {
  youtube: "YouTube",
  twitch: "Twitch",
  kick: "Kick",
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
  x: "X",
  reddit: "Reddit",
};

function Toggle({
  checked,
  onChange,
  label,
  description,
  icon,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description: string;
  icon: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center gap-4 border-b border-[var(--color-card-border)] py-5 text-left last:border-b-0 disabled:cursor-not-allowed disabled:opacity-45"
    >
      <span className="flex size-10 shrink-0 items-center justify-center border border-[#293526] bg-[#090d09] text-[var(--color-accent)]">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-white">{label}</span>
        <span className="mt-1 block text-sm leading-6 text-white/50">
          {description}
        </span>
      </span>
      <span
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full border transition-colors",
          checked
            ? "border-[var(--color-accent)] bg-[var(--color-accent)]"
            : "border-white/20 bg-white/5"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-4 rounded-full transition-transform",
            checked
              ? "translate-x-[22px] bg-black"
              : "translate-x-1 bg-white/60"
          )}
        />
      </span>
    </button>
  );
}

function formatCheckedAt(value: string | null) {
  if (!value) return "Waiting for first check";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Checked recently";
  return `Last checked ${date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })}`;
}

export function StreamAutomationWorkspace() {
  const [automation, setAutomation] = useState<AutomationView | null>(null);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [youtubeSources, setYoutubeSources] = useState<YouTubeSource[]>([]);
  const [sourceUrl, setSourceUrl] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [autoPublishEnabled, setAutoPublishEnabled] = useState(false);
  const [clipsPerBroadcast, setClipsPerBroadcast] = useState(3);
  const [destinationIds, setDestinationIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/stream-automation", {
        cache: "no-store",
      });
      const body = (await response.json()) as AutomationResponse;
      if (!response.ok) throw new Error(body.error || "Could not load Autopilot");
      setAutomation(body.automation);
      setDestinations(body.destinations || []);
      setYoutubeSources(body.youtubeSources || []);
      if (body.automation) {
        setSourceUrl(body.automation.sourceUrl);
        setEnabled(body.automation.enabled);
        setAutoPublishEnabled(body.automation.autoPublishEnabled);
        setClipsPerBroadcast(body.automation.clipsPerBroadcast);
        setDestinationIds(body.automation.destinationAccountIds);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load Autopilot");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const parsedSource = useMemo(
    () => parseAutomationSource(sourceUrl),
    [sourceUrl]
  );
  const sourceBrand = (parsedSource?.platform || automation?.platform || "youtube") as PlatformBrand;

  async function save() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/stream-automation", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceUrl,
          enabled,
          autoPublishEnabled,
          clipsPerBroadcast,
          destinationAccountIds: destinationIds,
        }),
      });
      const body = (await response.json()) as {
        automation?: AutomationView;
        error?: string;
      };
      if (!response.ok || !body.automation) {
        throw new Error(body.error || "Could not save Autopilot");
      }
      setAutomation(body.automation);
      setMessage(
        body.automation.enabled
          ? "Autopilot is on. Clipper will start checking this channel now."
          : "Autopilot settings saved."
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save Autopilot");
    } finally {
      setSaving(false);
    }
  }

  function toggleDestination(id: string) {
    setDestinationIds((current) =>
      current.includes(id)
        ? current.filter((candidate) => candidate !== id)
        : [...current, id]
    );
  }

  return (
    <AccountSettingsShell
      title="Autopilot"
      description="Connect the channel you stream from once. Clipper watches for live broadcasts, finds strong moments, renders them with captions, and can publish them while you stay focused on the stream."
      message={message}
      error={error}
    >
      {loading ? (
        <div className="mt-10 border border-[var(--color-card-border)] bg-[#050805] p-8">
          <OperationProgress
            compact
            title="Loading Autopilot"
            stages={["Checking streaming account…", "Loading posting destinations…"]}
          />
        </div>
      ) : (
        <AccountSettingsPanels>
          <AccountSettingsPanel title="Streaming account">
            <div className="flex items-start gap-4">
              <PlatformBrandIcon brand={sourceBrand} size="md" />
              <div className="min-w-0 flex-1">
                <label className="block text-sm font-semibold text-white" htmlFor="autopilot-source">
                  Channel URL
                </label>
                <p className="mt-1 text-sm leading-6 text-white/50">
                  Use the public channel you own, not a single video or VOD.
                </p>
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <input
                id="autopilot-source"
                value={sourceUrl}
                onChange={(event) => setSourceUrl(event.target.value)}
                placeholder="youtube.com/@you, twitch.tv/you, or kick.com/you"
                className="h-12 min-w-0 flex-1 border border-[var(--color-card-border)] bg-[#020302] px-4 text-sm text-white placeholder:text-white/30 focus:border-[var(--color-accent)] focus:outline-none"
              />
              {parsedSource ? (
                <span className="inline-flex h-12 shrink-0 items-center gap-2 border border-[var(--color-accent)]/35 bg-[var(--color-accent)]/8 px-4 text-sm font-medium text-[var(--color-accent)]">
                  <Check className="size-4" aria-hidden />
                  {PLATFORM_LABEL[parsedSource.platform]}
                </span>
              ) : null}
            </div>

            {youtubeSources.length > 0 ? (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-xs text-white/40">Linked:</span>
                {youtubeSources.map((source) => (
                  <button
                    key={source.id}
                    type="button"
                    onClick={() => setSourceUrl(source.sourceUrl)}
                    className="inline-flex items-center gap-2 border border-[#263224] bg-[#080b08] px-3 py-2 text-xs font-medium text-white/75 transition-colors hover:border-[var(--color-accent)]/55 hover:text-white"
                  >
                    <PlatformBrandIcon brand="youtube" size="xs" />
                    {source.label}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="mt-7 border-t border-[var(--color-card-border)]">
              <Toggle
                checked={enabled}
                onChange={setEnabled}
                label="Monitor this channel"
                description="Checks for a live broadcast in the background and starts a private Agent session automatically."
                icon={<Radio className="size-5" aria-hidden />}
              />
              <Toggle
                checked={autoPublishEnabled}
                onChange={setAutoPublishEnabled}
                disabled={!enabled}
                label="Publish without review"
                description="Authorizes Clipper to post finished clips to only the destinations selected below."
                icon={<Send className="size-5" aria-hidden />}
              />
            </div>
          </AccountSettingsPanel>

          <AccountSettingsPanel title="Output">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-white">Clips per broadcast</p>
                <p className="mt-1 max-w-xl text-sm leading-6 text-white/50">
                  Clipper only publishes moments that clear its quality threshold. Finished videos count toward your monthly plan.
                </p>
              </div>
              <div className="inline-flex h-11 shrink-0 border border-[var(--color-card-border)] bg-[#020302] p-1">
                {[1, 3, 5].map((count) => (
                  <button
                    key={count}
                    type="button"
                    onClick={() => setClipsPerBroadcast(count)}
                    className={cn(
                      "min-w-10 px-3 text-sm font-semibold transition-colors",
                      clipsPerBroadcast === count
                        ? "bg-[var(--color-accent)] text-black"
                        : "text-white/50 hover:text-white"
                    )}
                  >
                    {count}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-7 border-t border-[var(--color-card-border)] pt-7">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-white">Publish destinations</p>
                  <p className="mt-1 text-sm text-white/50">
                    Select every account Autopilot is allowed to post to.
                  </p>
                </div>
                <Link
                  href="/settings/connected-accounts"
                  className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-[var(--color-accent)] hover:underline"
                >
                  Connect
                  <ExternalLink className="size-3.5" aria-hidden />
                </Link>
              </div>

              {destinations.length === 0 ? (
                <div className="mt-5 border border-dashed border-[#33402f] px-5 py-6 text-center">
                  <p className="text-sm font-medium text-white">No publishing accounts connected</p>
                  <p className="mt-1 text-sm text-white/45">
                    Clipper can still create clips, but it needs a destination to post them.
                  </p>
                </div>
              ) : (
                <div className="mt-5 divide-y divide-[var(--color-card-border)] border-y border-[var(--color-card-border)]">
                  {destinations.map((destination) => {
                    const selected = destinationIds.includes(destination.id);
                    return (
                      <button
                        key={destination.id}
                        type="button"
                        onClick={() => toggleDestination(destination.id)}
                        className="flex w-full items-center gap-3 py-3.5 text-left"
                      >
                        <SocialPlatformIcon platform={destination.platform} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-white">
                            {destination.displayName || PLATFORM_LABEL[destination.platform]}
                          </span>
                          <span className="block truncate text-xs text-white/40">
                            {PLATFORM_LABEL[destination.platform]}
                            {destination.username ? ` · ${destination.username}` : ""}
                          </span>
                        </span>
                        <span
                          className={cn(
                            "flex size-5 items-center justify-center border",
                            selected
                              ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-black"
                              : "border-white/20 text-transparent"
                          )}
                        >
                          <Check className="size-3.5" aria-hidden />
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </AccountSettingsPanel>

          <AccountSettingsPanel title="Status">
            <div
              className={cn(
                "flex items-start gap-4 border px-5 py-4",
                automation?.lastError
                  ? "border-[#765a24] bg-[#171208]"
                  : automation?.activeSessionId
                    ? "border-[var(--color-accent)]/40 bg-[var(--color-accent)]/7"
                    : "border-[var(--color-card-border)] bg-[#020302]"
              )}
            >
              <span className="mt-0.5 text-[var(--color-accent)]">
                {automation?.lastError ? (
                  <AlertTriangle className="size-5 text-[#ffbf55]" aria-hidden />
                ) : (
                  <Sparkles className="size-5" aria-hidden />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white">
                  {automation?.lastError
                    ? "Autopilot needs attention"
                    : automation?.activeSessionId
                      ? "Live stream detected. Clipper is working."
                      : enabled
                        ? "Watching for your next stream"
                        : "Autopilot is paused"}
                </p>
                <p className="mt-1 break-words text-sm leading-6 text-white/50">
                  {automation?.lastError || formatCheckedAt(automation?.lastCheckedAt ?? null)}
                </p>
                {automation?.activeSessionId ? (
                  <Link
                    href={`/sessions/${automation.activeSessionId}`}
                    className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--color-accent)] hover:underline"
                  >
                    Open live Agent session
                    <ExternalLink className="size-3.5" aria-hidden />
                  </Link>
                ) : null}
              </div>
            </div>

            <p className="mt-5 text-xs leading-5 text-white/38">
              By enabling publish without review, you authorize Clipper to upload qualifying clips to the selected accounts using your saved publishing settings. Disable either switch at any time to stop future automatic work.
            </p>

            <button
              type="button"
              disabled={saving || !sourceUrl.trim()}
              onClick={() => void save()}
              className="mt-7 inline-flex h-11 items-center justify-center gap-2 bg-[var(--color-accent)] px-6 text-sm font-semibold text-black transition-colors hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {saving ? "Saving…" : "Save Autopilot"}
            </button>
          </AccountSettingsPanel>
        </AccountSettingsPanels>
      )}
    </AccountSettingsShell>
  );
}
