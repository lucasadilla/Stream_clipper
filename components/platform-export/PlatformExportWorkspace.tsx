"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { SiteLogo } from "@/components/layout/SiteLogo";
import {
  PlatformPresetCard,
  type PlatformCardDefinition,
} from "@/components/platform-export/PlatformPresetCard";
import { PlatformExportResult } from "@/components/platform-export/PlatformExportResult";
import type { ClipPayload, ExportPackPayload } from "@/components/platform-export/types";
import type { PlatformKey, XQuoteLayout } from "@/lib/platforms/types";

const PLATFORMS: PlatformCardDefinition[] = [
  { key: "youtube_shorts", short: "YT:S", name: "YouTube Shorts", detail: "Vertical cut, searchable title, description and pinned-comment hook.", outputs: [{ id: "vertical", label: "9:16" }] },
  { key: "youtube_landscape", short: "YT", name: "YouTube Landscape", detail: "Full-width highlight with SEO title, description and upload tags.", outputs: [{ id: "landscape", label: "16:9" }] },
  { key: "tiktok", short: "TT", name: "TikTok", detail: "Fast vertical edit with creator-native caption and focused hashtags.", outputs: [{ id: "vertical", label: "9:16" }] },
  { key: "instagram_reels", short: "IG:R", name: "Instagram Reels", detail: "Interface-safe vertical framing with a hook-first caption.", outputs: [{ id: "vertical", label: "9:16" }] },
  { key: "instagram_feed", short: "IG", name: "Instagram Feed", detail: "Portrait or square feed video with polished contextual copy.", outputs: [{ id: "portrait", label: "4:5" }, { id: "square", label: "1:1" }] },
  { key: "facebook_reels", short: "FB:R", name: "Facebook Reels", detail: "Vertical Reel tuned for broad discovery and conversation.", outputs: [{ id: "vertical", label: "9:16" }] },
  { key: "facebook_feed", short: "FB", name: "Facebook Feed", detail: "Portrait, landscape, or square video with discussion-ready text.", outputs: [{ id: "portrait", label: "4:5" }, { id: "landscape", label: "16:9" }, { id: "square", label: "1:1" }] },
  { key: "x", short: "X", name: "X / Twitter", detail: "Concise post copy with an optional editorial quote-card layout.", outputs: [{ id: "landscape", label: "16:9" }, { id: "vertical", label: "9:16" }] },
];

const DEFAULT_SELECTED: PlatformKey[] = [
  "youtube_shorts",
  "tiktok",
  "instagram_reels",
  "x",
];

function Toggle({ checked, label, detail, onChange }: { checked: boolean; label: string; detail: string; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-5 border-t border-[#20271e] py-4 first:border-t-0">
      <span>
        <span className="block text-sm font-bold text-white">{label}</span>
        <span className="mt-1 block text-xs leading-5 text-[#7d8877]">{detail}</span>
      </span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-[#95ff00]" />
    </label>
  );
}

export function PlatformExportWorkspace({ clipId }: { clipId: string }) {
  const [clip, setClip] = useState<ClipPayload | null>(null);
  const [selected, setSelected] = useState<PlatformKey[]>(DEFAULT_SELECTED);
  const [outputOptions, setOutputOptions] = useState<Partial<Record<PlatformKey, string>>>(() => Object.fromEntries(PLATFORMS.map((item) => [item.key, item.outputs[0]!.id])));
  const [includeCaptions, setIncludeCaptions] = useState(true);
  const [burnSubtitles, setBurnSubtitles] = useState(true);
  const [generateCopy, setGenerateCopy] = useState(true);
  const [xQuoteCard, setXQuoteCard] = useState(false);
  const [xQuoteLayout, setXQuoteLayout] = useState<XQuoteLayout>("quote_top");
  const [pack, setPack] = useState<ExportPackPayload | null>(null);
  const [creating, setCreating] = useState(false);
  const [regenerating, setRegenerating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch(`/api/clips/${clipId}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Could not load clip");
        setClip(body.clip);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load clip"));
  }, [clipId]);

  const loadPack = useCallback(async (packId: string) => {
    const response = await fetch(`/api/platform-export-packs/${packId}`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Could not load exports");
    setPack(body.pack);
    return body.pack as ExportPackPayload;
  }, []);

  useEffect(() => {
    if (!pack || (pack.status !== "queued" && pack.status !== "processing")) return;
    const timer = window.setInterval(() => {
      void loadPack(pack.id).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not refresh exports"));
    }, 2000);
    return () => window.clearInterval(timer);
  }, [loadPack, pack]);

  const overallProgress = useMemo(() => {
    if (!pack?.exports.length) return 0;
    return Math.round(pack.exports.reduce((sum, item) => sum + item.progress, 0) / pack.exports.length);
  }, [pack]);

  async function createPack() {
    if (selected.length === 0) return;
    setCreating(true);
    setError(null);
    try {
      const response = await fetch(`/api/clips/${clipId}/platform-exports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selected, platforms: selected, outputOptions, includeCaptions, burnSubtitles, generateCopy, xQuoteCard, xQuoteLayout }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not create exports");
      setPack(body.pack);
      window.setTimeout(() => document.getElementById("export-results")?.scrollIntoView({ behavior: "smooth" }), 100);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create exports");
    } finally {
      setCreating(false);
    }
  }

  async function regenerateCopy(exportId: string) {
    if (!pack) return;
    setRegenerating(exportId);
    setError(null);
    try {
      const response = await fetch(`/api/platform-exports/${exportId}/regenerate-copy`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not regenerate copy");
      await loadPack(pack.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not regenerate copy");
    } finally {
      setRegenerating(null);
    }
  }

  return (
    <div className="editor-shell min-h-screen bg-[#020302] text-white">
      <header className="sticky top-0 z-40 border-b border-[#20271e] bg-[#020302]/95 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1480px] items-center justify-between px-4 sm:px-7">
          <SiteLogo />
          <div className="flex items-center gap-3">
            <span className="hidden font-mono text-[9px] font-bold uppercase text-[#5f695a] sm:block">Platform Export Packs</span>
            <Link href={`/clips/${clipId}`} className="border border-[#34402f] px-3 py-2 text-[10px] font-bold text-[#b4bdae] hover:border-[#95ff00] hover:text-white">Back to clip</Link>
          </div>
        </div>
      </header>

      <main>
        <section className="border-b border-[#20271e]">
          <div className="mx-auto grid max-w-[1480px] gap-8 px-4 py-10 sm:px-7 lg:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)] lg:py-14">
            <div className="flex flex-col justify-between">
              <div>
                <p className="font-mono text-[10px] font-bold uppercase text-[#95ff00]">One clip / every channel</p>
                <h1 className="mt-4 max-w-4xl font-[var(--font-display)] text-5xl leading-[0.9] text-white sm:text-7xl lg:text-[6.8rem]">
                  Package the moment.
                </h1>
                <p className="mt-6 max-w-xl text-sm leading-6 text-[#919b8c] sm:text-base">
                  Render platform-native video, publishing copy, covers, captions, and validation from one finished clip.
                </p>
              </div>
              {clip && (
                <div className="mt-10 border-l-2 border-[#95ff00] pl-4">
                  <p className="text-lg font-bold text-white">{clip.title}</p>
                  <p className="mt-1 font-mono text-[10px] text-[#697363]">{Math.round(clip.durationSeconds)} seconds / {clip.stream.channelTitle ?? clip.stream.title ?? "Stream clip"}</p>
                </div>
              )}
            </div>
            <div className="flex min-h-[300px] items-center justify-center bg-black lg:min-h-[430px]">
              {clip?.videoUrl ? (
                <video controls preload="metadata" src={clip.videoUrl} className="max-h-[500px] w-full bg-black object-contain" />
              ) : (
                <p className="font-mono text-[10px] uppercase text-[#5f695a]">Loading finished clip...</p>
              )}
            </div>
          </div>
        </section>

        <section className="border-b border-[#20271e]">
          <div className="mx-auto max-w-[1480px] px-4 py-10 sm:px-7 lg:py-14">
            <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="font-mono text-[9px] font-bold uppercase text-[#697363]">01 / Destinations</p>
                <h2 className="mt-2 text-3xl font-bold text-white sm:text-4xl">Choose where this clip lives.</h2>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setSelected(PLATFORMS.map((item) => item.key))} className="border border-[#34402f] px-3 py-2 text-[10px] font-bold text-[#aeb8a8] hover:border-[#95ff00]">Select all</button>
                <button type="button" onClick={() => setSelected([])} className="border border-[#34402f] px-3 py-2 text-[10px] font-bold text-[#aeb8a8] hover:border-[#95ff00]">Clear</button>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {PLATFORMS.map((platform) => (
                <PlatformPresetCard
                  key={platform.key}
                  platform={platform}
                  selected={selected.includes(platform.key)}
                  outputId={outputOptions[platform.key] ?? platform.outputs[0]!.id}
                  onToggle={() => setSelected((current) => current.includes(platform.key) ? current.filter((key) => key !== platform.key) : [...current, platform.key])}
                  onOutputChange={(outputId) => setOutputOptions((current) => ({ ...current, [platform.key]: outputId }))}
                />
              ))}
            </div>
          </div>
        </section>

        <section className="border-b border-[#20271e]">
          <div className="mx-auto grid max-w-[1480px] gap-10 px-4 py-10 sm:px-7 lg:grid-cols-[0.75fr_1.25fr] lg:py-14">
            <div>
              <p className="font-mono text-[9px] font-bold uppercase text-[#697363]">02 / Treatment</p>
              <h2 className="mt-2 font-[var(--font-display)] text-5xl leading-none text-white sm:text-6xl">Make each output feel native.</h2>
              <p className="mt-5 max-w-md text-sm leading-6 text-[#818c7c]">The crop, safe zones, encoding, and copy constraints adapt automatically to each destination.</p>
            </div>
            <div className="border-y border-[#20271e]">
              <Toggle checked={includeCaptions} onChange={setIncludeCaptions} label="Include caption package" detail="Generate captions and carry them into the downloadable pack." />
              <Toggle checked={burnSubtitles} onChange={setBurnSubtitles} label="Burn captions into video" detail="Render readable, platform-safe subtitles directly into every video." />
              <Toggle checked={generateCopy} onChange={setGenerateCopy} label="Write platform copy with AI" detail="Generate titles, captions, descriptions, hashtags, tags, and post text." />
              {selected.includes("x") && (
                <div className="border-t border-[#20271e] py-4">
                  <Toggle checked={xQuoteCard} onChange={setXQuoteCard} label="X quote-card treatment" detail="Build a more editorial video layout around the strongest line from the clip." />
                  {xQuoteCard && (
                    <div className="flex flex-wrap gap-2 pb-2">
                      {(["quote_top", "quote_bottom", "overlay"] as XQuoteLayout[]).map((layout) => (
                        <button key={layout} type="button" onClick={() => setXQuoteLayout(layout)} className={`border px-3 py-2 font-mono text-[9px] font-bold uppercase ${xQuoteLayout === layout ? "border-[#95ff00] text-[#95ff00]" : "border-[#34402f] text-[#778171]"}`}>
                          {layout.replace("_", " ")}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="bg-[#95ff00] text-black">
          <div className="mx-auto flex max-w-[1480px] flex-col items-start justify-between gap-7 px-4 py-8 sm:flex-row sm:items-center sm:px-7">
            <div>
              <p className="font-mono text-[10px] font-bold uppercase">{selected.length} output{selected.length === 1 ? "" : "s"} selected</p>
              <p className="mt-1 text-sm font-semibold">Each completed variant counts as one export on your plan.</p>
            </div>
            <button type="button" onClick={() => void createPack()} disabled={creating || selected.length === 0 || !clip?.hasVideo} className="min-w-56 border-2 border-black bg-black px-6 py-4 text-sm font-black text-[#95ff00] hover:bg-[#17200f] disabled:cursor-not-allowed disabled:opacity-40">
              {creating ? "Creating export pack..." : "Generate platform pack"}
            </button>
          </div>
        </section>

        {error && <div className="mx-auto max-w-[1480px] border-x border-b border-[#5c2824] bg-[#170a09] px-4 py-4 text-sm text-[#ff8d84] sm:px-7">{error}</div>}

        {pack && (
          <section id="export-results" className="mx-auto max-w-[1480px] px-4 py-12 sm:px-7 lg:py-16">
            <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
              <div>
                <p className="font-mono text-[9px] font-bold uppercase text-[#95ff00]">03 / Export pack</p>
                <h2 className="mt-2 text-3xl font-bold text-white sm:text-4xl">{pack.status === "completed" ? "Ready for the feed." : "Building every version."}</h2>
                <p className="mt-2 font-mono text-[10px] text-[#697363]">{overallProgress}% complete / {pack.exports.filter((item) => item.status === "completed").length} of {pack.exports.length} ready</p>
              </div>
              {pack.exports.some((item) => item.status === "completed") && (
                <a href={pack.downloadZipUrl} className="bg-[#95ff00] px-5 py-3 text-xs font-black text-black hover:bg-[#b2ff48]">Download complete ZIP</a>
              )}
            </div>
            <div className="mb-8 h-1 overflow-hidden bg-[#182015]"><div className="h-full bg-[#95ff00] transition-all duration-500" style={{ width: `${overallProgress}%` }} /></div>
            <div className="space-y-4">
              {pack.exports.map((item) => <PlatformExportResult key={item.id} item={item} onRegenerate={() => void regenerateCopy(item.id)} regenerating={regenerating === item.id} />)}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
