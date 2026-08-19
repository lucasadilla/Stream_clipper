"use client";

import { useEffect, useMemo, useState } from "react";
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

function parseList(value: string, hashtag = false): string[] {
  return value
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => (hashtag ? `#${item.replace(/^#+/, "")}` : item));
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function FieldCount({ value, limit }: { value: string; limit?: number }) {
  if (!limit) return null;
  const over = value.length > limit;
  return (
    <span className={cn("text-[10px]", over ? "font-semibold text-[var(--color-danger)]" : "text-[var(--color-muted)]")}>
      {value.length}/{limit}
    </span>
  );
}

const inputClass =
  "mt-1.5 w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-background)] px-3 py-2 text-xs leading-relaxed text-[var(--color-foreground)] outline-none transition placeholder:text-[var(--color-muted)]/60 focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)]";

export function PlatformCopyEditor({
  platform,
  copy,
  generating = false,
  onChange,
  onReset,
}: PlatformCopyEditorProps) {
  const preset = PLATFORM_PRESETS[platform];
  const [hashtagText, setHashtagText] = useState(copy.hashtags.join(" "));
  const [tagText, setTagText] = useState(copy.tags.join(", "));
  const [copied, setCopied] = useState(false);
  const isYouTube = platform === "youtube_shorts" || platform === "youtube_landscape";
  const isX = platform === "x";

  useEffect(() => {
    const parsed = parseList(hashtagText, true);
    if (!sameList(parsed, copy.hashtags)) setHashtagText(copy.hashtags.join(" "));
  }, [copy.hashtags, hashtagText, platform]);

  useEffect(() => {
    const parsed = parseList(tagText);
    if (!sameList(parsed, copy.tags)) setTagText(copy.tags.join(", "));
  }, [copy.tags, platform, tagText]);

  const packageText = useMemo(
    () =>
      [
        isYouTube ? copy.title : null,
        isX ? copy.postText : isYouTube ? copy.description : copy.caption,
        copy.hashtags.join(" "),
        isYouTube && copy.tags.length ? `Search tags: ${copy.tags.join(", ")}` : null,
        isYouTube && copy.thumbnailText ? `Thumbnail: ${copy.thumbnailText}` : null,
        copy.pinnedComment && `Pinned comment: ${copy.pinnedComment}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    [copy, isX, isYouTube]
  );

  const update = <K extends keyof PlatformCopy>(key: K, value: PlatformCopy[K]) =>
    onChange({ ...copy, [key]: value });

  const copyPackage = async () => {
    try {
      await navigator.clipboard.writeText(packageText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <aside className="w-full rounded-2xl border border-[var(--color-card-border)] bg-[var(--color-card)] p-4 shadow-[0_18px_50px_rgba(0,0,0,0.22)] lg:sticky lg:top-[8.5rem]">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--color-card-border)] pb-3">
        <div className="flex items-start gap-3">
          <PlatformBrandIcon brand={platform} size="xs" />
          <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-accent)]">
            Post package
          </p>
          <h4 className="mt-0.5 text-sm font-semibold">{preset.name} copy</h4>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-muted)]">
            Changes update the preview and follow this clip into export or publishing.
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
              Title <FieldCount value={copy.title ?? ""} limit={preset.titleLimit} />
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
              Post text <FieldCount value={copy.postText ?? ""} limit={preset.postTextLimit} />
            </span>
            <textarea
              value={copy.postText ?? ""}
              onChange={(event) => update("postText", event.target.value)}
              rows={5}
              className={inputClass}
              placeholder="What should the post say?"
            />
          </label>
        ) : !isYouTube ? (
          <label className="block text-[11px] font-medium text-[var(--color-muted)]">
            <span className="flex items-center justify-between gap-2">
              Caption <FieldCount value={copy.caption ?? ""} limit={preset.captionLimit} />
            </span>
            <textarea
              value={copy.caption ?? ""}
              onChange={(event) => update("caption", event.target.value)}
              rows={4}
              className={inputClass}
              placeholder="Add context and a hook"
            />
          </label>
        ) : null}

        {isYouTube && (
          <label className="block text-[11px] font-medium text-[var(--color-muted)]">
            Description
            <textarea
              value={copy.description ?? ""}
              onChange={(event) => update("description", event.target.value)}
              rows={4}
              className={inputClass}
              placeholder="Description shown beneath the video"
            />
          </label>
        )}

        <label className="block text-[11px] font-medium text-[var(--color-muted)]">
          <span className="flex items-center justify-between gap-2">
            Hashtags
            {preset.hashtagRange && (
              <span className={cn("text-[10px]", copy.hashtags.length > (preset.hashtagRange.hardMax ?? preset.hashtagRange.max) ? "text-[var(--color-danger)]" : "text-[var(--color-muted)]")}>
                {copy.hashtags.length}/{preset.hashtagRange.max} recommended
              </span>
            )}
          </span>
          <input
            value={hashtagText}
            onChange={(event) => {
              const value = event.target.value;
              setHashtagText(value);
              update("hashtags", parseList(value, true));
            }}
            className={inputClass}
            placeholder="#livestream #highlights"
          />
        </label>

        {isYouTube && (
          <>
            <label className="block text-[11px] font-medium text-[var(--color-muted)]">
              Search tags
              <input
                value={tagText}
                onChange={(event) => {
                  const value = event.target.value;
                  setTagText(value);
                  update("tags", parseList(value));
                }}
                className={inputClass}
                placeholder="livestream, highlights, creator"
              />
            </label>
            <label className="block text-[11px] font-medium text-[var(--color-muted)]">
              Thumbnail hook
              <input
                value={copy.thumbnailText ?? ""}
                maxLength={80}
                onChange={(event) => update("thumbnailText", event.target.value)}
                className={inputClass}
                placeholder="Short cover text"
              />
            </label>
            <label className="block text-[11px] font-medium text-[var(--color-muted)]">
              Pinned comment
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

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-[var(--color-card-border)] pt-3">
        <span className="flex items-center gap-1.5 text-[10px] text-[var(--color-muted)]">
          {generating ? (
            <LoaderCircle className="h-3 w-3 animate-spin text-[var(--color-accent)]" />
          ) : (
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
          )}
          {generating ? "Optimizing from source + transcript" : "Ready to post"}
        </span>
        <button
          type="button"
          onClick={() => void copyPackage()}
          className="flex items-center gap-1.5 rounded-lg bg-[var(--color-secondary)] px-2.5 py-1.5 text-[10px] font-semibold hover:text-[var(--color-accent)]"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-[var(--color-accent)]" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy package"}
        </button>
      </div>
    </aside>
  );
}
