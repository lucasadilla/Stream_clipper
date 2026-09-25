"use client";

import { useState } from "react";
import { Check, Copy, LoaderCircle, RotateCcw } from "lucide-react";
import { cn } from "@/lib/cn";
import { PLATFORM_PRESETS } from "@/lib/platforms/presets";
import type { PlatformCopy, PlatformKey } from "@/lib/platforms/types";
import { PlatformBrandIcon } from "@/components/brand/PlatformBrandIcon";

interface PlatformCopyEditorProps {
  platform: PlatformKey;
  copy: PlatformCopy;
  generating?: boolean;
  onChange: (copy: PlatformCopy) => void;
  onReset: () => void;
}

function FieldCount({ value, limit }: { value: string; limit?: number }) {
  if (!limit) return null;
  const over = value.length > limit;
  return (
    <span
      className={cn(
        "text-[10px]",
        over ? "font-semibold text-[var(--color-danger)]" : "text-[var(--color-muted)]"
      )}
    >
      {value.length}/{limit}
    </span>
  );
}

function CopyFieldButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const disabled = !value.trim();

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={`Copy ${label}`}
      title={disabled ? `Nothing to copy` : `Copy ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        } catch {
          setCopied(false);
        }
      }}
      className="inline-flex items-center gap-1 rounded-md border border-[var(--color-card-border)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--color-muted)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {copied ? (
        <Check className="h-3 w-3 text-[var(--color-accent)]" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

const inputClass =
  "mt-1.5 w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-background)] px-3 py-2 text-xs leading-relaxed text-[var(--color-foreground)] outline-none transition placeholder:text-[var(--color-muted)]/60 focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)]";

function usesMergedCaption(platform: PlatformKey): boolean {
  return (
    platform === "tiktok" ||
    platform === "instagram_reels" ||
    platform === "instagram_feed" ||
    platform === "facebook_reels" ||
    platform === "facebook_feed"
  );
}

export function PlatformCopyEditor({
  platform,
  copy,
  generating = false,
  onChange,
  onReset,
}: PlatformCopyEditorProps) {
  const preset = PLATFORM_PRESETS[platform];
  const isYouTube = platform === "youtube_shorts" || platform === "youtube_landscape";
  const isX = platform === "x";
  const mergedCaption = usesMergedCaption(platform);

  const update = <K extends keyof PlatformCopy>(key: K, value: PlatformCopy[K]) =>
    onChange({ ...copy, [key]: value });

  return (
    <aside className="w-full rounded-2xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-4 shadow-[0_18px_50px_rgba(0,0,0,0.22)] lg:sticky lg:top-[8.5rem]">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--color-card-border)] pb-3">
        <div className="flex items-start gap-3">
          <PlatformBrandIcon brand={platform} size="xs" />
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-accent)]">
              Post copy
            </p>
            <h4 className="mt-0.5 text-sm font-semibold">{preset.name} copy</h4>
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-muted)]">
              Copy each field separately. Changes follow this clip into export or publishing.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="flex shrink-0 items-center gap-1 rounded-lg border border-[var(--color-card-border)] px-2 py-1.5 text-[10px] font-semibold text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-foreground)]"
        >
          <RotateCcw className="h-3 w-3" /> Reset
        </button>
      </div>

      <div className="mt-4 space-y-3.5">
        {isYouTube && (
          <label className="block text-[11px] font-medium text-[var(--color-muted)]">
            <span className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                Title
                <FieldCount value={copy.title ?? ""} limit={preset.titleLimit} />
              </span>
              <CopyFieldButton value={copy.title ?? ""} label="title" />
            </span>
            <input
              value={copy.title ?? ""}
              maxLength={preset.titleLimit ? preset.titleLimit + 20 : undefined}
              onChange={(event) => update("title", event.target.value)}
              className={inputClass}
              placeholder="Write a searchable title"
            />
          </label>
        )}

        {isX ? (
          <label className="block text-[11px] font-medium text-[var(--color-muted)]">
            <span className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                Post text
                <FieldCount value={copy.postText ?? ""} limit={preset.postTextLimit} />
              </span>
              <CopyFieldButton value={copy.postText ?? ""} label="post text" />
            </span>
            <textarea
              value={copy.postText ?? ""}
              onChange={(event) =>
                onChange({
                  ...copy,
                  postText: event.target.value,
                  hashtags: [],
                })
              }
              rows={5}
              className={inputClass}
              placeholder="What should the post say? Include hashtags here."
            />
          </label>
        ) : null}

        {mergedCaption ? (
          <label className="block text-[11px] font-medium text-[var(--color-muted)]">
            <span className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                Caption
                <FieldCount value={copy.caption ?? ""} limit={preset.captionLimit} />
              </span>
              <CopyFieldButton value={copy.caption ?? ""} label="caption" />
            </span>
            <textarea
              value={copy.caption ?? ""}
              onChange={(event) =>
                onChange({
                  ...copy,
                  caption: event.target.value,
                  hashtags: [],
                })
              }
              rows={5}
              className={inputClass}
              placeholder="Add your caption and hashtags together"
            />
          </label>
        ) : null}

        {isYouTube && (
          <>
            <label className="block text-[11px] font-medium text-[var(--color-muted)]">
              <span className="flex items-center justify-between gap-2">
                Description
                <CopyFieldButton value={copy.description ?? ""} label="description" />
              </span>
              <textarea
                value={copy.description ?? ""}
                onChange={(event) => update("description", event.target.value)}
                rows={4}
                className={inputClass}
                placeholder="Description shown beneath the video"
              />
            </label>
            <label className="block text-[11px] font-medium text-[var(--color-muted)]">
              <span className="flex items-center justify-between gap-2">
                Pinned comment
                <CopyFieldButton value={copy.pinnedComment ?? ""} label="pinned comment" />
              </span>
              <input
                value={copy.pinnedComment ?? ""}
                onChange={(event) => update("pinnedComment", event.target.value)}
                className={inputClass}
                placeholder="Start the conversation"
              />
            </label>
          </>
        )}
      </div>

      <div className="mt-4 flex items-center gap-1.5 border-t border-[var(--color-card-border)] pt-3 text-[10px] text-[var(--color-muted)]">
        {generating ? (
          <LoaderCircle className="h-3 w-3 animate-spin text-[var(--color-accent)]" />
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
        )}
        {generating ? "Optimizing from source + transcript" : "Ready to post"}
      </div>
    </aside>
  );
}
