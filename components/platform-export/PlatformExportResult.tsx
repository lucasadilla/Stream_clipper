"use client";

import { useState } from "react";
import type { ExportResultPayload } from "@/components/platform-export/types";

function formatBytes(value: string | null): string {
  const bytes = Number(value ?? 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function copyBlock(item: ExportResultPayload): string {
  return [
    item.title,
    item.caption,
    item.postText,
    item.description,
    item.hashtags.join(" "),
    item.tags.length > 0 ? item.tags.join(", ") : null,
    item.pinnedComment,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function CopyField({ label, value }: { label: string; value: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  async function copy() {
    await navigator.clipboard.writeText(value!);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }
  return (
    <div className="border-t border-[#20271e] py-3 first:border-t-0">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span className="font-mono text-[9px] font-bold uppercase text-[#697363]">{label}</span>
        <button type="button" onClick={() => void copy()} className="text-[10px] font-bold text-[#95ff00] hover:text-white">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="whitespace-pre-wrap text-xs leading-5 text-[#cbd4c6]">{value}</p>
    </div>
  );
}

export function PlatformExportResult({
  item,
  clipId,
  onRegenerate,
  regenerating,
}: {
  item: ExportResultPayload;
  clipId?: string;
  onRegenerate: () => void;
  regenerating: boolean;
}) {
  const [copiedAll, setCopiedAll] = useState(false);
  const ratio = `${item.settings.width} / ${item.settings.height}`;
  const metadata = [
    item.width && item.height ? `${item.width} x ${item.height}` : null,
    item.durationSeconds ? `${Math.round(item.durationSeconds)}s` : null,
    formatBytes(item.fileSizeBytes),
  ].filter(Boolean).join(" / ");

  if (item.status !== "completed") {
    return (
      <article className="border border-[#20271e] bg-[#050705] p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-mono text-[9px] font-bold uppercase text-[#95ff00]">{item.status}</p>
            <h3 className="mt-1 text-base font-bold text-white">{item.presetName}</h3>
          </div>
          <span className="font-mono text-xs text-[#95ff00]">{item.progress}%</span>
        </div>
        <div className="mt-4 h-1 overflow-hidden bg-[#182015]">
          <div className="h-full bg-[#95ff00] transition-all" style={{ width: `${Math.max(3, item.progress)}%` }} />
        </div>
        {item.errorMessage && <p className="mt-3 text-xs text-[#ff756b]">{item.errorMessage}</p>}
      </article>
    );
  }

  return (
    <article className="border border-[#283124] bg-[#050705]">
      <div className="grid lg:grid-cols-[minmax(240px,0.8fr)_minmax(280px,1.2fr)]">
        <div className="flex min-h-80 items-center justify-center border-b border-[#20271e] bg-black p-5 lg:border-b-0 lg:border-r">
          {item.videoUrl && (
            <video
              controls
              preload="metadata"
              poster={item.thumbnailUrl ?? undefined}
              src={item.videoUrl}
              className="max-h-[31rem] max-w-full bg-black object-contain"
              style={{ aspectRatio: ratio }}
            />
          )}
        </div>
        <div className="min-w-0 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#20271e] pb-4">
            <div>
              <p className="font-mono text-[9px] font-bold uppercase text-[#95ff00]">Ready to publish</p>
              <h3 className="mt-1 text-xl font-bold text-white">{item.presetName}</h3>
              <p className="mt-1 font-mono text-[10px] text-[#75806f]">{metadata}</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(copyBlock(item));
                  setCopiedAll(true);
                  window.setTimeout(() => setCopiedAll(false), 1400);
                }}
                className="border border-[#3a4635] px-3 py-2 text-[10px] font-bold text-white hover:border-[#95ff00]"
              >
                {copiedAll ? "Copied" : "Copy all"}
              </button>
              {clipId && (
                <a
                  href={`/clips/${clipId}/publish`}
                  className="border border-[#95ff00]/50 px-3 py-2 text-[10px] font-bold text-[#95ff00] hover:bg-[#95ff00]/10"
                >
                  Publish
                </a>
              )}
              {item.downloadUrl && (
                <a href={item.downloadUrl} className="bg-[#95ff00] px-3 py-2 text-[10px] font-bold text-black hover:bg-[#b2ff48]">
                  Download MP4
                </a>
              )}
            </div>
          </div>

          {item.warnings.length > 0 && (
            <div className="my-4 border-l-2 border-[#e8c64b] bg-[#161408] px-3 py-2">
              {item.warnings.map((warning) => <p key={warning} className="text-[11px] leading-5 text-[#e7d994]">{warning}</p>)}
            </div>
          )}

          <div>
            <CopyField label="Title" value={item.title} />
            <CopyField label="Caption" value={item.caption} />
            <CopyField label="Post text" value={item.postText} />
            <CopyField label="Description" value={item.description} />
            <CopyField label="Hashtags" value={item.hashtags.join(" ") || null} />
            <CopyField label="Tags" value={item.tags.join(", ") || null} />
            <CopyField label="Pinned comment" value={item.pinnedComment} />
          </div>
          <button
            type="button"
            onClick={onRegenerate}
            disabled={regenerating}
            className="mt-4 border border-[#3a4635] px-3 py-2 text-[10px] font-bold text-[#b7c0b2] hover:border-[#95ff00] hover:text-white disabled:opacity-40"
          >
            {regenerating ? "Writing new copy..." : "Regenerate copy"}
          </button>
        </div>
      </div>
    </article>
  );
}
